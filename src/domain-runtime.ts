import {
  isClean,
  match as matchPattern,
  MatchKind,
  rawOf,
  unwrap,
  valueOf,
} from "@justinmchase/uffda";
import { evaluateExpression, Scope } from "@justinmchase/uffda/runtime";
import { ExpressionKind } from "@justinmchase/uffda/expression";
import { PatternKind } from "@justinmchase/uffda/pattern";
import {
  type AggregateDefinition,
  type CommandOutcome,
  CommandRuntime,
  MemoryStateStore,
  type PatternExpressionRuntime,
  type StateStore,
} from "./domain.ts";
import type { HostComponentDescriptor } from "./composition.ts";
import { problemResponse } from "./problems.ts";
import type {
  RawAggregateDeclaration,
  RawComponentBinding,
  RawConfigMember,
  RawControllerDeclaration,
  RawControllerRoute,
  RawManagerDeclaration,
  RawSyntaxModule,
  SourceSpan,
  UffdaExpressionNode,
  UffdaPatternNode,
} from "./syntax.ts";

interface DomainManager {
  invoke(operation: string, input: unknown): Promise<unknown>;
}

interface DomainController {
  handle(request: Request): Promise<Response>;
}

interface DeclarativeManager {
  readonly declaration: RawManagerDeclaration;
  readonly context: string;
}

interface DeclarativeController {
  readonly declaration: RawControllerDeclaration;
  readonly context: string;
}

type OperationOutcome = CommandOutcome | {
  readonly kind: "refused";
  readonly reason: string;
};

export interface DomainDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly span?: SourceSpan;
}

function duplicateNames(
  names: readonly string[],
  kind: string,
  span: SourceSpan,
  diagnostics: DomainDiagnostic[],
): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      diagnostics.push({
        code: "DUPLICATE_DOMAIN_MEMBER",
        message: `${kind} ${name} is declared more than once`,
        span,
      });
    }
    seen.add(name);
  }
}

function declarationName(
  declaration: RawSyntaxModule["declarations"][number],
): string | undefined {
  switch (declaration.kind) {
    case "aggregate":
    case "context":
    case "manager":
    case "controller":
      return declaration.name;
    default:
      return undefined;
  }
}

function routePathParameters(path: string): string[] | undefined {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    return undefined;
  }
  const parameters: string[] = [];
  for (const segment of path.slice(1).split("/")) {
    if (!segment.includes("{") && !segment.includes("}")) continue;
    const parameter = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(segment)?.[1];
    if (parameter === undefined) return undefined;
    parameters.push(parameter);
  }
  return parameters;
}

function patternObjectKeys(pattern: unknown): readonly string[] | undefined {
  if (
    typeof pattern !== "object" || pattern === null ||
    Reflect.get(pattern, "kind") !== "over"
  ) {
    return undefined;
  }
  const keys = Reflect.get(pattern, "keys");
  return typeof keys === "object" && keys !== null
    ? Object.keys(keys)
    : undefined;
}

function referencesName(value: unknown, name: string): boolean {
  const visited = new Set<object>();
  const visit = (current: unknown): boolean => {
    if (typeof current !== "object" || current === null) return false;
    if (visited.has(current)) return false;
    visited.add(current);
    if (
      Reflect.get(current, "kind") === "reference" &&
      Reflect.get(current, "name") === name
    ) {
      return true;
    }
    return Reflect.ownKeys(current).some((key) =>
      visit(Reflect.get(current, key))
    );
  };
  return visit(value);
}

function validateExpressionScope(
  expression: unknown,
  bindings: ReadonlySet<string>,
  span: SourceSpan,
  diagnostics: DomainDiagnostic[],
  allowValueReference = false,
): void {
  const expressionKinds = new Set(Object.values(ExpressionKind));
  const reported = new Set<string>();
  const visit = (
    value: unknown,
    scope: ReadonlySet<string>,
    ancestors: ReadonlySet<object>,
  ): void => {
    if (
      typeof value !== "object" || value === null ||
      ancestors.has(value) || !expressionKinds.has(Reflect.get(value, "kind"))
    ) {
      return;
    }
    const kind = Reflect.get(value, "kind");
    if (kind === ExpressionKind.Native) {
      diagnostics.push({
        code: "NATIVE_EXPRESSION_UNSUPPORTED",
        message: "Native expressions are not supported in Coleslaw",
        span,
      });
    }
    if (kind === ExpressionKind.Reference) {
      const name = Reflect.get(value, "name");
      if (
        typeof name === "string" && !scope.has(name) &&
        !coleslawGlobals.has(name) &&
        !(allowValueReference && name === "_")
      ) {
        if (!reported.has(name)) {
          diagnostics.push({
            code: name === "this"
              ? "RESERVED_EXPRESSION_REFERENCE"
              : "UNKNOWN_EXPRESSION_REFERENCE",
            message: name === "this"
              ? "The reserved reference this is not available in Coleslaw expressions"
              : `Expression refers to unknown name ${name}`,
            span,
          });
          reported.add(name);
        }
      }
    }
    const nextAncestors = new Set(ancestors).add(value);
    if (kind === ExpressionKind.Lambda) {
      const pattern = Reflect.get(value, "pattern");
      validatePatternExpressions(pattern, span, diagnostics);
      const nestedBindings = new Set(scope);
      for (const name of patternBindings(pattern)) nestedBindings.add(name);
      nestedBindings.add("_");
      visit(
        Reflect.get(value, "expression"),
        nestedBindings,
        nextAncestors,
      );
      return;
    }
    for (const key of Reflect.ownKeys(value)) {
      const child = Reflect.get(value, key);
      if (Array.isArray(child)) {
        for (const item of child) visit(item, scope, nextAncestors);
      } else {
        visit(child, scope, nextAncestors);
      }
    }
  };
  visit(expression, bindings, new Set());
}

function patternBindings(pattern: unknown): ReadonlySet<string> {
  const bindings = new Set<string>();
  const visit = (value: unknown, ancestors: ReadonlySet<object>): void => {
    if (
      typeof value !== "object" || value === null || ancestors.has(value)
    ) return;
    const nextAncestors = new Set(ancestors).add(value);
    if (
      Reflect.get(value, "kind") === PatternKind.Variable &&
      typeof Reflect.get(value, "name") === "string"
    ) {
      bindings.add(Reflect.get(value, "name"));
    }
    const kind = Reflect.get(value, "kind");
    switch (kind) {
      case PatternKind.And:
      case PatternKind.Or:
      case PatternKind.Then:
        visit(Reflect.get(value, "patterns"), nextAncestors);
        break;
      case PatternKind.Pipeline:
        visit(Reflect.get(value, "steps"), nextAncestors);
        break;
      case PatternKind.Over:
        visit(Reflect.get(value, "keys"), nextAncestors);
        break;
      case PatternKind.Projection:
      case PatternKind.Quantifier:
      case PatternKind.Except:
      case PatternKind.Into:
      case PatternKind.Lookahead:
      case PatternKind.Maybe:
      case PatternKind.Not:
      case PatternKind.Skip:
      case PatternKind.Variable:
        visit(Reflect.get(value, "pattern"), nextAncestors);
        break;
      case PatternKind.Recover:
        visit(Reflect.get(value, "pattern"), nextAncestors);
        visit(Reflect.get(value, "skip"), nextAncestors);
        break;
      case PatternKind.Switch:
        visit(Reflect.get(value, "cases"), nextAncestors);
        visit(Reflect.get(value, "default"), nextAncestors);
        break;
    }
  };
  visit(pattern, new Set());
  return bindings;
}

function validatePatternExpressions(
  pattern: unknown,
  span: SourceSpan,
  diagnostics: DomainDiagnostic[],
): void {
  const bindings = new Set(patternBindings(pattern));
  bindings.add("_");
  const reported = new Set<string>();
  const valueSource = (source: unknown): void => {
    if (
      typeof source !== "object" || source === null ||
      Reflect.get(source, "kind") !== "value.variable"
    ) return;
    const name = Reflect.get(source, "name");
    if (
      typeof name === "string" && !bindings.has(name) &&
      !reported.has(name)
    ) {
      diagnostics.push({
        code: "UNKNOWN_PATTERN_REFERENCE",
        message: `Pattern refers to unknown value $${name}`,
        span,
      });
      reported.add(name);
    }
  };
  const visited = new Set<object>();
  const visit = (value: unknown): void => {
    if (typeof value !== "object" || value === null || visited.has(value)) {
      return;
    }
    visited.add(value);
    switch (Reflect.get(value, "kind")) {
      case PatternKind.And:
      case PatternKind.Or:
      case PatternKind.Then: {
        const children = Reflect.get(value, "patterns");
        if (Array.isArray(children)) children.forEach(visit);
        break;
      }
      case PatternKind.Pipeline: {
        const children = Reflect.get(value, "steps");
        if (Array.isArray(children)) children.forEach(visit);
        break;
      }
      case PatternKind.Over: {
        const keys = Reflect.get(value, "keys");
        if (typeof keys === "object" && keys !== null) {
          Object.values(keys).forEach(visit);
        }
        break;
      }
      case PatternKind.Projection:
        validateExpressionScope(
          Reflect.get(value, "expression"),
          bindings,
          span,
          diagnostics,
          true,
        );
        visit(Reflect.get(value, "pattern"));
        break;
      case PatternKind.Quantifier:
        valueSource(Reflect.get(value, "min"));
        valueSource(Reflect.get(value, "max"));
        visit(Reflect.get(value, "pattern"));
        break;
      case PatternKind.Equal:
        valueSource(Reflect.get(value, "value"));
        break;
      case PatternKind.Includes: {
        const sources = Reflect.get(value, "values");
        if (Array.isArray(sources)) sources.forEach(valueSource);
        break;
      }
      case PatternKind.Between:
        valueSource(Reflect.get(value, "left"));
        valueSource(Reflect.get(value, "right"));
        break;
      case PatternKind.Resolve:
        diagnostics.push({
          code: "UNSUPPORTED_PATTERN_REFERENCE",
          message:
            "Named rule and special pattern references are not supported in this runtime",
          span,
        });
        break;
      case PatternKind.Type: {
        const type = Reflect.get(value, "type");
        if (type === "function" || type === "symbol" || type === "error") {
          diagnostics.push({
            code: "NON_DATA_PATTERN_TYPE",
            message: `The ${type} pattern type is not valid for domain data`,
            span,
          });
        }
        break;
      }
      case PatternKind.Except:
      case PatternKind.Into:
      case PatternKind.Lookahead:
      case PatternKind.Maybe:
      case PatternKind.Not:
      case PatternKind.Skip:
      case PatternKind.Variable:
        visit(Reflect.get(value, "pattern"));
        break;
      case PatternKind.Recover:
        visit(Reflect.get(value, "pattern"));
        visit(Reflect.get(value, "skip"));
        break;
      case PatternKind.Switch: {
        const cases = Reflect.get(value, "cases");
        if (Array.isArray(cases)) {
          for (const candidate of cases) {
            if (typeof candidate === "object" && candidate !== null) {
              const key = Reflect.get(candidate, "key");
              if (typeof key === "object" && key !== null) {
                const values = Reflect.get(key, "values");
                if (Array.isArray(values)) values.forEach(valueSource);
              }
              visit(Reflect.get(candidate, "pattern"));
            }
          }
        }
        visit(Reflect.get(value, "default"));
        break;
      }
    }
  };
  visit(pattern);
}

function validateSettingsPatterns(
  members: readonly RawConfigMember[],
  diagnostics: DomainDiagnostic[],
): void {
  for (const member of members) {
    if (member.kind === "group") {
      validateSettingsPatterns(member.settings, diagnostics);
    } else {
      validatePatternExpressions(member.pattern, member.span, diagnostics);
    }
  }
}

export function validateDeclarativeDomain(
  syntax: RawSyntaxModule,
): readonly DomainDiagnostic[] {
  const diagnostics: DomainDiagnostic[] = [];
  const declarations = new Map(
    syntax.declarations.flatMap((declaration) => {
      const name = declarationName(declaration);
      return name === undefined ? [] : [[name, declaration] as const];
    }),
  );
  const contexts = new Map<string, string>();
  const contextDeclarations = syntax.declarations.filter(
    (declaration) => declaration.kind === "context",
  );
  for (const declaration of syntax.declarations) {
    if (declaration.kind === "config") {
      validateSettingsPatterns(declaration.settings, diagnostics);
    } else if (declaration.kind === "program") {
      for (const selection of declaration.selections) {
        for (const expression of selection.arguments) {
          validateExpressionScope(
            expression,
            new Set([declaration.configBinding]),
            selection.span,
            diagnostics,
          );
        }
      }
    } else if (declaration.kind === "mode") {
      const bindingNames = new Set(
        declaration.sections.flatMap((section) =>
          section.bindings.map((binding) => binding.name)
        ),
      );
      for (const section of declaration.sections) {
        for (const binding of section.bindings) {
          for (const expression of binding.arguments) {
            const bindings = new Set(bindingNames);
            const program = syntax.declarations.find((candidate) =>
              candidate.kind === "program"
            );
            if (program?.kind === "program") {
              bindings.add(program.configBinding);
            }
            validateExpressionScope(
              expression,
              bindings,
              binding.span,
              diagnostics,
            );
          }
        }
      }
    }
  }
  for (const context of contextDeclarations) {
    if (context.kind !== "context") continue;
    duplicateNames(
      context.members.map((member) => member.name),
      "Context member",
      context.span,
      diagnostics,
    );
    for (const member of context.members) {
      const declaration = declarations.get(member.name);
      if (declaration === undefined) {
        diagnostics.push({
          code: "UNKNOWN_CONTEXT_MEMBER",
          message:
            `Context ${context.name} lists unknown member ${member.name}`,
          span: member.span,
        });
      } else if (
        member.exported &&
        (declaration.kind === "aggregate" || declaration.kind === "manager")
      ) {
        diagnostics.push({
          code: "PRIVATE_DOMAIN_MEMBER",
          message:
            `Context ${context.name} must not export ${declaration.kind} ${member.name}`,
          span: member.span,
        });
      }
      const owner = contexts.get(member.name);
      if (owner !== undefined) {
        diagnostics.push({
          code: "DUPLICATE_CONTEXT_OWNERSHIP",
          message:
            `${member.name} is owned by both ${owner} and ${context.name}`,
          span: member.span,
        });
      } else {
        contexts.set(member.name, context.name);
      }
    }
    for (const declaration of syntax.declarations) {
      if (
        declaration.kind === "aggregate" || declaration.kind === "manager" ||
        declaration.kind === "controller"
      ) {
        if (!contexts.has(declaration.name)) {
          diagnostics.push({
            code: "UNOWNED_DOMAIN_MEMBER",
            message:
              `${declaration.kind} ${declaration.name} must belong to a context`,
            span: declaration.span,
          });
        }
      }
    }
    const declaredDomain = new Map(
      syntax.declarations.flatMap((declaration) => {
        const name = declarationName(declaration);
        return name === undefined ? [] : [[name, declaration] as const];
      }),
    );
    for (
      const exported of syntax.declarations.filter((declaration) =>
        declaration.kind === "export"
      )
    ) {
      const declaration = declaredDomain.get(exported.name);
      if (
        declaration?.kind === "aggregate" || declaration?.kind === "manager"
      ) {
        diagnostics.push({
          code: "PRIVATE_DOMAIN_MEMBER",
          message:
            `A context must not export ${declaration.kind} ${declaration.name}`,
          span: exported.span,
        });
      }
    }
  }

  const aggregates = new Map<string, RawAggregateDeclaration>();
  for (
    const declaration of syntax.declarations.filter((candidate) =>
      candidate.kind === "aggregate"
    )
  ) {
    if (declaration.kind !== "aggregate") continue;
    aggregates.set(declaration.name, declaration);
    duplicateNames(
      declaration.fields.map((field) => field.name),
      "Aggregate field",
      declaration.span,
      diagnostics,
    );
    duplicateNames(
      declaration.commands.map((command) => command.name),
      "Aggregate command",
      declaration.span,
      diagnostics,
    );
    duplicateNames(
      declaration.events.map((event) => event.name),
      "Aggregate event",
      declaration.span,
      diagnostics,
    );
    duplicateNames(
      declaration.states.map((state) => state.name),
      "Aggregate state",
      declaration.span,
      diagnostics,
    );
    for (const field of declaration.fields) {
      validatePatternExpressions(field.pattern, field.span, diagnostics);
      validateExpressionScope(
        field.initial,
        new Set(),
        field.span,
        diagnostics,
      );
    }
    for (const shape of [...declaration.commands, ...declaration.events]) {
      validatePatternExpressions(shape.pattern, shape.span, diagnostics);
    }
    for (const invariant of declaration.invariants) {
      validatePatternExpressions(invariant, declaration.span, diagnostics);
    }
    for (const state of declaration.states) {
      for (const handler of state.commands) {
        if (handler.guard !== undefined) {
          validatePatternExpressions(
            handler.guard,
            handler.span,
            diagnostics,
          );
        }
        if (handler.decision.kind === "reject") {
          validateExpressionScope(
            handler.decision.reason,
            new Set(["input", "state"]),
            handler.span,
            diagnostics,
          );
        } else {
          for (const event of handler.decision.events) {
            validateExpressionScope(
              event.payload,
              new Set(["input", "state"]),
              event.span,
              diagnostics,
            );
          }
        }
      }
      for (const handler of state.events) {
        for (const assignment of handler.set) {
          validateExpressionScope(
            assignment.expression,
            new Set(["input", "state"]),
            assignment.span,
            diagnostics,
          );
        }
      }
    }
    try {
      new CommandRuntime(
        new Map([[
          declaration.name,
          aggregateDefinition(declaration),
        ]]),
        createDomainExpressionRuntime(),
        new MemoryStateStore(),
      );
    } catch (error) {
      diagnostics.push({
        code: "INVALID_AGGREGATE",
        message: error instanceof Error ? error.message : String(error),
        span: declaration.span,
      });
    }
  }

  const managers = new Map<string, RawManagerDeclaration>();
  for (
    const declaration of syntax.declarations.filter((candidate) =>
      candidate.kind === "manager"
    )
  ) {
    if (declaration.kind !== "manager") continue;
    managers.set(declaration.name, declaration);
    duplicateNames(
      declaration.operations.map((operation) => operation.name),
      `Manager ${declaration.name} operation`,
      declaration.span,
      diagnostics,
    );
    for (const operation of declaration.operations) {
      validatePatternExpressions(
        operation.input,
        operation.span,
        diagnostics,
      );
      validatePatternExpressions(
        operation.result,
        operation.span,
        diagnostics,
      );
      validateExpressionScope(
        operation.identity,
        new Set(["input"]),
        operation.span,
        diagnostics,
      );
      validateExpressionScope(
        operation.payload,
        new Set(["input"]),
        operation.span,
        diagnostics,
      );
      const aggregate = aggregates.get(operation.aggregate);
      if (aggregate === undefined) {
        diagnostics.push({
          code: "UNKNOWN_MANAGER_AGGREGATE",
          message:
            `Manager ${declaration.name}.${operation.name} refers to unknown aggregate ${operation.aggregate}`,
          span: operation.span,
        });
        continue;
      }
      if (
        (contexts.get(declaration.name) ?? "") !==
          (contexts.get(aggregate.name) ?? "")
      ) {
        diagnostics.push({
          code: "CROSS_CONTEXT_AGGREGATE_ACCESS",
          message:
            `Manager ${declaration.name} cannot send commands to aggregate ${aggregate.name} outside its context`,
          span: operation.span,
        });
      }
      if (
        !aggregate.commands.some((command) =>
          command.name === operation.command
        )
      ) {
        diagnostics.push({
          code: "UNKNOWN_AGGREGATE_COMMAND",
          message:
            `Manager ${declaration.name}.${operation.name} sends undeclared command ${aggregate.name}.${operation.command}`,
          span: operation.span,
        });
      }
    }
  }

  for (
    const declaration of syntax.declarations.filter((candidate) =>
      candidate.kind === "controller"
    )
  ) {
    if (declaration.kind !== "controller") continue;
    for (const route of declaration.routes) {
      for (const shape of route.requestShapes) {
        validatePatternExpressions(
          shape.pattern,
          shape.span,
          diagnostics,
        );
      }
      validateExpressionScope(
        route.input,
        new Set(["request"]),
        route.span,
        diagnostics,
      );
      if (!route.public) {
        diagnostics.push({
          code: "ROUTE_ACCESS_REQUIRED",
          message:
            `Route ${route.method} ${route.path} must declare public access; authentication is not supported in this runtime`,
          span: route.span,
        });
      }
      if (route.public && referencesName(route.input, "principal")) {
        diagnostics.push({
          code: "PUBLIC_ROUTE_PRINCIPAL",
          message: "A public route must not refer to principal",
          span: route.span,
        });
      }
      const shapeKinds = new Set<string>();
      for (const shape of route.requestShapes) {
        if (shapeKinds.has(shape.kind)) {
          diagnostics.push({
            code: "DUPLICATE_REQUEST_SHAPE",
            message:
              `Route ${route.method} ${route.path} declares ${shape.kind} more than once`,
            span: shape.span,
          });
        }
        shapeKinds.add(shape.kind);
        if (
          shape.kind === "headers" &&
          Reflect.get(shape.pattern, "kind") !== "over"
        ) {
          diagnostics.push({
            code: "INVALID_HEADER_SHAPE",
            message:
              "Headers must be declared as a named object shape in this runtime",
            span: shape.span,
          });
        }
      }
      const pathParameters = routePathParameters(route.path);
      if (pathParameters === undefined) {
        diagnostics.push({
          code: "INVALID_ROUTE_PATH",
          message:
            `Route path ${route.path} must be an absolute path with whole-segment named parameters`,
          span: route.span,
        });
      } else if (
        new Set(pathParameters).size !== pathParameters.length
      ) {
        diagnostics.push({
          code: "INVALID_ROUTE_PATH",
          message: `Route path ${route.path} has duplicate parameters`,
          span: route.span,
        });
      }
      const pathShape = route.requestShapes.find((shape) =>
        shape.kind === "path"
      );
      if (
        pathParameters !== undefined && pathParameters.length > 0 &&
        pathShape === undefined
      ) {
        diagnostics.push({
          code: "MISSING_PATH_SHAPE",
          message:
            `Route ${route.method} ${route.path} must declare a path shape`,
          span: route.span,
        });
      }
      if (pathShape !== undefined && pathParameters !== undefined) {
        const shapeKeys = patternObjectKeys(pathShape.pattern);
        if (
          shapeKeys === undefined ||
          shapeKeys.length !== pathParameters.length ||
          pathParameters.some((name) => !shapeKeys.includes(name))
        ) {
          diagnostics.push({
            code: "PATH_SHAPE_MISMATCH",
            message:
              `Path shape keys for ${route.method} ${route.path} must exactly match its named parameters`,
            span: pathShape.span,
          });
        }
      }
      const [managerName, operationName, ...extra] = route.operation.segments;
      const manager = managerName === undefined
        ? undefined
        : managers.get(managerName);
      if (
        manager === undefined || operationName === undefined ||
        extra.length > 0 ||
        !manager.operations.some((operation) =>
          operation.name === operationName
        )
      ) {
        diagnostics.push({
          code: "UNKNOWN_CONTROLLER_OPERATION",
          message:
            `Controller ${declaration.name} route refers to unknown operation ${
              route.operation.segments.join(".")
            }`,
          span: route.span,
        });
        continue;
      }
      if (
        (contexts.get(declaration.name) ?? "") !==
          (contexts.get(manager.name) ?? "")
      ) {
        diagnostics.push({
          code: "CROSS_CONTEXT_MANAGER_ACCESS",
          message:
            `Controller ${declaration.name} cannot invoke manager ${manager.name} outside its context`,
          span: route.span,
        });
      }
    }
  }
  const exportedNames = new Set(
    syntax.declarations.flatMap((declaration) =>
      declaration.kind === "export" ? [declaration.name] : []
    ),
  );
  const contextsByName = new Map(
    contextDeclarations.flatMap((declaration) =>
      declaration.kind === "context"
        ? [[declaration.name, declaration] as const]
        : []
    ),
  );
  const contextMembers = new Map<string, {
    readonly context: string;
    readonly exported: boolean;
  }>();
  for (const declaration of contextDeclarations) {
    if (declaration.kind !== "context") continue;
    for (const member of declaration.members) {
      contextMembers.set(member.name, {
        context: declaration.name,
        exported: member.exported,
      });
    }
  }
  const modeComponent = (
    binding: RawComponentBinding,
  ) => {
    const [contextName, memberName, ...extra] = binding.component.segments;
    if (memberName !== undefined && extra.length === 0) {
      const context = contextsByName.get(contextName);
      if (
        context !== undefined &&
        context.members.some((member) => member.name === memberName)
      ) {
        return {
          declaration: declarations.get(memberName),
          contextName,
          memberName,
        };
      }
    }
    return {
      declaration: declarations.get(binding.component.segments.join(".")),
      contextName: undefined,
      memberName: undefined,
    };
  };
  for (
    const mode of syntax.declarations.filter((candidate) =>
      candidate.kind === "mode"
    )
  ) {
    if (mode.kind !== "mode") continue;
    const members = mode.sections.flatMap((section) => section.bindings);
    for (const binding of members) {
      const resolved = modeComponent(binding);
      const component = resolved.declaration;
      if (component?.kind !== "controller") continue;
      const ownerName = contexts.get(component.name);
      const owner = ownerName === undefined
        ? undefined
        : contextsByName.get(ownerName);
      if (
        owner !== undefined &&
        (
          resolved.contextName !== owner.name ||
          resolved.memberName !== component.name ||
          !exportedNames.has(owner.name) ||
          contextMembers.get(component.name)?.exported !== true
        )
      ) {
        diagnostics.push({
          code: "CONTROLLER_NOT_EXPORTED_BY_CONTEXT",
          message:
            `Mode ${mode.name} must reach controller ${component.name} through its exported context`,
          span: binding.span,
        });
      }
    }
    const rootContexts = new Set(
      members.flatMap((binding) => {
        const component = modeComponent(binding).declaration;
        return component?.kind === "controller"
          ? [contexts.get(component.name) ?? ""]
          : [];
      }),
    );
    for (const binding of members) {
      const component = modeComponent(binding).declaration;
      if (
        component?.kind === "manager" &&
        (
          contexts.has(component.name) ||
          !rootContexts.has(contexts.get(component.name) ?? "")
        )
      ) {
        diagnostics.push({
          code: "CROSS_CONTEXT_MANAGER_ACCESS",
          message:
            `Mode ${mode.name} cannot compose context-owned manager ${component.name} directly`,
          span: binding.span,
        });
      }
    }
  }
  return diagnostics;
}

function aggregateDefinition(
  declaration: RawAggregateDeclaration,
): AggregateDefinition<UffdaPatternNode, UffdaExpressionNode> {
  return {
    name: declaration.name,
    identityField: declaration.identityField,
    fields: Object.fromEntries(declaration.fields.map((field) => [
      field.name,
      { pattern: field.pattern, initial: field.initial },
    ])),
    commands: Object.fromEntries(declaration.commands.map((command) => [
      command.name,
      command.pattern,
    ])),
    events: Object.fromEntries(declaration.events.map((event) => [
      event.name,
      event.pattern,
    ])),
    invariants: declaration.invariants,
    start: declaration.start,
    states: Object.fromEntries(declaration.states.map((state) => [
      state.name,
      {
        commands: state.commands.map((handler) => ({
          command: handler.command,
          guard: handler.guard,
          decision: handler.decision,
        })),
        events: state.events.map((handler) => ({
          event: handler.event,
          set: Object.fromEntries(handler.set.map((assignment) => [
            assignment.field,
            assignment.expression,
          ])),
          move: handler.move,
        })),
      },
    ])),
  };
}

function dataEqual(
  left: unknown,
  right: unknown,
  leftAncestors = new Set<object>(),
  rightAncestors = new Set<object>(),
): boolean {
  const a = rawOf(left);
  const b = rawOf(right);
  if (a === null || a === undefined || typeof a !== "object") {
    if (b === null || b === undefined || typeof b !== "object") {
      return typeof a === typeof b &&
        (typeof a === "number" && typeof b === "number"
          ? a === b || (Number.isNaN(a) && Number.isNaN(b))
          : a === b);
    }
    return false;
  }
  if (b === null || typeof b !== "object") return false;
  if (leftAncestors.has(a) || rightAncestors.has(b)) return false;

  const leftPath = new Set(leftAncestors).add(a);
  const rightPath = new Set(rightAncestors).add(b);
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date &&
      Object.is(a.getTime(), b.getTime());
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
      a.every((item, index) => dataEqual(item, b[index], leftPath, rightPath));
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) {
      return false;
    }
    for (const [key, value] of a) {
      if (
        key !== null &&
        (typeof key === "object" || typeof key === "function" ||
          typeof key === "symbol")
      ) return false;
      let found = false;
      for (const [candidate, candidateValue] of b) {
        if (
          dataEqual(key, candidate) &&
          dataEqual(value, candidateValue, leftPath, rightPath)
        ) {
          found = true;
          break;
        }
      }
      if (!found) return false;
    }
    return true;
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) {
      return false;
    }
    for (const value of a) {
      if (
        value !== null &&
        (typeof value === "object" || typeof value === "function" ||
          typeof value === "symbol")
      ) return false;
      if (![...b].some((candidate) => dataEqual(value, candidate))) {
        return false;
      }
    }
    return true;
  }
  const aPrototype = Object.getPrototypeOf(a);
  const bPrototype = Object.getPrototypeOf(b);
  if (
    (aPrototype !== Object.prototype && aPrototype !== null) ||
    (bPrototype !== Object.prototype && bPrototype !== null)
  ) return false;
  const aKeys = Reflect.ownKeys(a);
  const bKeys = Reflect.ownKeys(b);
  if (
    aKeys.length !== bKeys.length ||
    aKeys.some((key) => typeof key !== "string") ||
    bKeys.some((key) => typeof key !== "string")
  ) return false;
  return aKeys.every((key) => {
    if (typeof key !== "string" || !Object.hasOwn(b, key)) return false;
    const aDescriptor = Object.getOwnPropertyDescriptor(a, key);
    const bDescriptor = Object.getOwnPropertyDescriptor(b, key);
    return aDescriptor !== undefined && bDescriptor !== undefined &&
      "value" in aDescriptor && "value" in bDescriptor &&
      dataEqual(aDescriptor.value, bDescriptor.value, leftPath, rightPath);
  });
}

const coleslawGlobals = new Map<string, unknown>([
  ["add", (left: unknown, right: unknown) => {
    const a = rawOf(left);
    const b = rawOf(right);
    if (typeof a !== "number" || typeof b !== "number") {
      throw new TypeError("add expects two numbers");
    }
    return a + b;
  }],
  [
    "coalesce",
    (...values: unknown[]) =>
      values.map(rawOf).find((value) => value !== null && value !== undefined),
  ],
  ["deep", (left: unknown, right: unknown) => dataEqual(left, right)],
  ["eq", (left: unknown, right: unknown) => rawOf(left) === rawOf(right)],
]);

function domainScope(input: unknown): Scope {
  return Scope.From(input).withOptions({
    globals: coleslawGlobals,
    specials: new Map(),
  });
}

export function createDomainExpressionRuntime(): PatternExpressionRuntime<
  UffdaPatternNode,
  UffdaExpressionNode
> {
  return {
    async match(pattern, input) {
      const result = await matchPattern(pattern, domainScope(input));
      if (
        isClean(result) && result.kind === MatchKind.Ok &&
        await closedObjectsMatch(pattern, input)
      ) {
        return { matched: true, value: unwrap(valueOf(result)) };
      }
      return { matched: false, value: input };
    },
    async evaluate(expression, variables) {
      return await evaluateExpression(expression, {
        input: variables.input,
        variables,
        scope: domainScope(variables.input),
      });
    },
  };
}

function declarationContexts(
  syntax: RawSyntaxModule,
): ReadonlyMap<string, string> {
  const contexts = new Map<string, string>();
  for (
    const declaration of syntax.declarations.filter((candidate) =>
      candidate.kind === "context"
    )
  ) {
    if (declaration.kind !== "context") continue;
    for (const member of declaration.members) {
      contexts.set(member.name, declaration.name);
    }
  }
  return contexts;
}

function contextKind(context: string, aggregate: string): string {
  return context.length === 0 ? aggregate : `${context}.${aggregate}`;
}

function pathMatches(
  template: string,
  pathname: string,
): Readonly<Record<string, string>> | undefined {
  if (!template.startsWith("/") || !pathname.startsWith("/")) {
    return undefined;
  }
  const expected = template.slice(1).split("/");
  const actual = pathname.slice(1).split("/");
  if (expected.length !== actual.length) return undefined;
  const values: Record<string, string> = Object.create(null);
  for (let index = 0; index < expected.length; index++) {
    const part = expected[index];
    const value = actual[index];
    if (part.startsWith("{") && part.endsWith("}")) {
      const name = part.slice(1, -1);
      try {
        values[name] = decodeURIComponent(value);
      } catch {
        return undefined;
      }
    } else if (part !== value) {
      return undefined;
    }
  }
  return values;
}

function queryValues(searchParams: URLSearchParams): Record<string, unknown> {
  const values: Record<string, unknown> = Object.create(null);
  for (const [name, value] of searchParams) {
    const existing = values[name];
    if (existing === undefined) {
      values[name] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      values[name] = [existing, value];
    }
  }
  return values;
}

function requestShape(
  route: RawControllerRoute,
  kind: "path" | "query" | "headers" | "body",
) {
  return route.requestShapes.find((shape) => shape.kind === kind);
}

async function closedObjectsMatch(
  pattern: unknown,
  value: unknown,
): Promise<boolean> {
  if (typeof pattern !== "object" || pattern === null) return true;
  const kind = Reflect.get(pattern, "kind");
  if (kind === "or") {
    const patterns: unknown = Reflect.get(pattern, "patterns");
    if (!Array.isArray(patterns)) return false;
    for (const candidate of patterns) {
      const matched = await matchPattern(candidate, domainScope(value));
      if (
        isClean(matched) && matched.kind === MatchKind.Ok &&
        await closedObjectsMatch(candidate, value)
      ) {
        return true;
      }
    }
    return false;
  }
  if (kind === "and") {
    const patterns: unknown = Reflect.get(pattern, "patterns");
    return Array.isArray(patterns) &&
      (await Promise.all(
        patterns.map((candidate) => closedObjectsMatch(candidate, value)),
      )).every(Boolean);
  }
  if (kind !== "over" || typeof value !== "object" || value === null) {
    return true;
  }
  const keys: unknown = Reflect.get(pattern, "keys");
  if (typeof keys !== "object" || keys === null) return false;
  const allowed = new Set(Object.keys(keys));
  const entries: readonly [string, unknown][] = value instanceof Map
    ? [...value].flatMap(([name, item]) =>
      typeof name === "string" ? [[name, item] as const] : []
    )
    : Object.keys(value).map((name) => [name, Reflect.get(value, name)]);
  if (
    (value instanceof Map && entries.length !== value.size) ||
    entries.some(([name]) => !allowed.has(name))
  ) {
    return false;
  }
  for (const [name, item] of entries) {
    if (
      !await closedObjectsMatch(
        Reflect.get(keys, name),
        item,
      )
    ) {
      return false;
    }
  }
  return true;
}

async function matchRequestShape(
  pattern: UffdaPatternNode,
  value: unknown,
): Promise<{ matched: boolean; value: unknown }> {
  const result = await createDomainExpressionRuntime().match(pattern, value);
  if (!result.matched) {
    return { matched: false, value };
  }
  return result;
}

function declaredHeaderValues(
  request: Request,
  shape: RawControllerRoute["requestShapes"][number] | undefined,
): Record<string, string> {
  if (shape === undefined) return {};
  const keys: unknown = Reflect.get(shape.pattern, "keys");
  if (
    Reflect.get(shape.pattern, "kind") !== "over" ||
    typeof keys !== "object" || keys === null
  ) {
    return {};
  }
  const values: Record<string, string> = Object.create(null);
  for (const name of Object.keys(keys)) {
    const value = request.headers.get(name);
    if (value !== null) values[name] = value;
  }
  return values;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function managerDescriptor(
  manager: DeclarativeManager,
  commandRuntime: () => CommandRuntime<UffdaPatternNode, UffdaExpressionNode>,
  definitions: ReadonlyMap<string, RawAggregateDeclaration>,
): HostComponentDescriptor<DomainManager> {
  return {
    kind: "manager",
    parameters: [],
    create() {
      return {
        value: {
          async invoke(operationName, input) {
            const operation = manager.declaration.operations.find((candidate) =>
              candidate.name === operationName
            );
            if (operation === undefined) {
              return {
                kind: "failed",
                error: `Unknown manager operation ${operationName}`,
                mayHaveCommitted: false,
              } satisfies CommandOutcome;
            }
            let commandStarted = false;
            let mayHaveCommitted = false;
            try {
              const runtime = createDomainExpressionRuntime();
              const matched = await runtime.match(operation.input, input);
              if (!matched.matched) {
                return {
                  kind: "refused",
                  reason: `Input does not match operation ${operationName}`,
                } satisfies OperationOutcome;
              }
              const aggregate = definitions.get(operation.aggregate);
              if (aggregate === undefined) {
                return {
                  kind: "failed",
                  error: `Unknown aggregate ${operation.aggregate}`,
                  mayHaveCommitted: false,
                } satisfies CommandOutcome;
              }
              const identity = await runtime.evaluate(operation.identity, {
                input: matched.value,
              });
              if (typeof identity !== "string" || identity.length === 0) {
                return {
                  kind: "failed",
                  error:
                    "Aggregate identity expression must produce a non-empty string",
                  mayHaveCommitted: false,
                } satisfies CommandOutcome;
              }
              const payload = await runtime.evaluate(operation.payload, {
                input: matched.value,
              });
              commandStarted = true;
              const result = await commandRuntime().handle(
                contextKind(manager.context, aggregate.name),
                identity,
                operation.command,
                payload,
              );
              mayHaveCommitted = result.kind === "accepted" ||
                (result.kind === "failed" && result.mayHaveCommitted);
              const output = await runtime.match(operation.result, result);
              if (!output.matched) {
                return {
                  kind: "failed",
                  error: `Result does not match operation ${operationName}`,
                  mayHaveCommitted,
                } satisfies CommandOutcome;
              }
              return result;
            } catch (error) {
              return {
                kind: "failed",
                error: error instanceof Error ? error.message : String(error),
                mayHaveCommitted: mayHaveCommitted || commandStarted,
              } satisfies CommandOutcome;
            }
          },
        },
      };
    },
  };
}

function controllerDescriptor(
  controller: DeclarativeController,
  managersByName: ReadonlyMap<string, DeclarativeManager>,
  managerDescriptors: ReadonlyMap<
    string,
    HostComponentDescriptor<DomainManager>
  >,
): HostComponentDescriptor<DomainController> {
  const managerNames = new Set(
    controller.declaration.routes.map((route) => route.operation.segments[0]),
  );
  return {
    kind: "controller",
    parameters: [],
    async create() {
      const managers = new Map<string, DomainManager>();
      for (const name of managerNames) {
        const managerDeclaration = managersByName.get(name);
        const managerDescriptor = managerDescriptors.get(name);
        if (
          managerDeclaration === undefined ||
          managerDeclaration.context !== controller.context ||
          managerDescriptor === undefined
        ) {
          throw new Error(
            `Controller ${controller.declaration.name} cannot use manager ${name} outside its context`,
          );
        }
        managers.set(name, (await managerDescriptor.create([])).value);
      }
      return {
        value: {
          async handle(request) {
            const url = new URL(request.url);
            let pathMatched = false;
            const allowedMethods = new Set<string>();
            for (const route of controller.declaration.routes) {
              const path = pathMatches(route.path, url.pathname);
              if (path === undefined) continue;
              const pathShape = requestShape(route, "path");
              const pathResult = pathShape === undefined
                ? { matched: true, value: path }
                : await matchRequestShape(pathShape.pattern, path);
              if (!pathResult.matched) continue;
              pathMatched = true;
              allowedMethods.add(route.method);
              if (request.method.toUpperCase() !== route.method.toUpperCase()) {
                continue;
              }
              const queryShape = requestShape(route, "query");
              const headersShape = requestShape(route, "headers");
              const bodyShape = requestShape(route, "body");

              const rawQuery = queryValues(url.searchParams);
              if (
                queryShape === undefined && Object.keys(rawQuery).length > 0
              ) {
                return problemResponse(
                  400,
                  "Bad Request",
                  "Route does not declare query parameters",
                );
              }
              const queryResult = queryShape === undefined
                ? { matched: true, value: rawQuery }
                : await matchRequestShape(
                  queryShape.pattern,
                  rawQuery,
                );
              if (!queryResult.matched) {
                return problemResponse(
                  400,
                  "Bad Request",
                  "Query parameters do not match the declared shape",
                );
              }

              const rawHeaders = declaredHeaderValues(request, headersShape);
              const headersResult = headersShape === undefined
                ? { matched: true, value: {} }
                : await matchRequestShape(
                  headersShape.pattern,
                  rawHeaders,
                );
              if (!headersResult.matched) {
                return problemResponse(
                  400,
                  "Bad Request",
                  "Headers do not match the declared shape",
                );
              }

              let rawBody: unknown = undefined;
              if (request.body !== null) {
                if (
                  request.headers.get("content-type")?.split(";")[0]
                    .trim().toLowerCase() !== "application/json"
                ) {
                  return problemResponse(
                    415,
                    "Unsupported Media Type",
                    "Request body must use application/json",
                  );
                }
                if (bodyShape === undefined) {
                  return problemResponse(
                    400,
                    "Bad Request",
                    "Route does not declare a request body",
                  );
                }
                try {
                  rawBody = await request.json();
                } catch {
                  return problemResponse(
                    400,
                    "Bad Request",
                    "Request body is not valid JSON",
                  );
                }
              }
              const bodyResult = bodyShape === undefined
                ? { matched: true, value: rawBody }
                : await matchRequestShape(
                  bodyShape.pattern,
                  rawBody,
                );
              if (!bodyResult.matched) {
                return problemResponse(
                  400,
                  "Bad Request",
                  "Request body does not match the declared shape",
                );
              }
              const operationManager = route.operation.segments[0];
              const operationName = route.operation.segments[1];
              const manager = managers.get(operationManager);
              if (manager === undefined || operationName === undefined) {
                console.error(
                  `Controller ${controller.declaration.name} route ${route.method} ${route.path} refers to an unavailable manager operation ${
                    route.operation.segments.join(".")
                  }`,
                );
                return problemResponse(
                  500,
                  "Internal Server Error",
                  "Internal server error",
                );
              }
              const input = await createDomainExpressionRuntime().evaluate(
                route.input,
                {
                  request: {
                    path: pathResult.value,
                    query: queryResult.value,
                    headers: headersResult.value,
                    body: bodyResult.value,
                  },
                },
              );
              const outcome = await manager.invoke(
                operationName,
                input,
              ) as OperationOutcome;
              if (outcome.kind === "failed") {
                console.error(
                  `Controller ${controller.declaration.name} route ${route.method} ${route.path} failed: ${outcome.error}`,
                );
                return problemResponse(
                  500,
                  "Internal Server Error",
                  "Internal server error",
                  { mayHaveCommitted: outcome.mayHaveCommitted },
                );
              }
              switch (outcome.kind) {
                case "accepted":
                  return jsonResponse(200, outcome);
                case "refused":
                  return problemResponse(400, "Bad Request", outcome.reason);
                case "rejected":
                  return problemResponse(
                    422,
                    "Unprocessable Content",
                    undefined,
                    { reason: outcome.reason },
                  );
                case "conflicted":
                  return problemResponse(409, "Conflict");
              }
            }
            if (pathMatched) {
              return problemResponse(
                405,
                "Method Not Allowed",
                undefined,
                {},
                { allow: [...allowedMethods].join(", ") },
              );
            }
            return problemResponse(404, "Not Found");
          },
        },
      };
    },
  };
}

export function createDeclarativeHostComponents(
  syntax: RawSyntaxModule,
  options: { readonly stateStore?: StateStore } = {},
): ReadonlyMap<string, HostComponentDescriptor> {
  const contexts = declarationContexts(syntax);
  const aggregates = new Map(
    syntax.declarations.flatMap((declaration) =>
      declaration.kind === "aggregate"
        ? [[declaration.name, declaration] as const]
        : []
    ),
  );
  const managerDeclarations = new Map<string, DeclarativeManager>(
    syntax.declarations.flatMap((declaration) =>
      declaration.kind === "manager"
        ? [
          [declaration.name, {
            declaration,
            context: contexts.get(declaration.name) ?? "",
          }] as const,
        ]
        : []
    ),
  );
  const runtimeDefinitions = new Map(
    [...aggregates.values()].map((aggregate) => [
      contextKind(contexts.get(aggregate.name) ?? "", aggregate.name),
      aggregateDefinition(aggregate),
    ]),
  );
  let runtime:
    | CommandRuntime<UffdaPatternNode, UffdaExpressionNode>
    | undefined;
  const commandRuntime = () =>
    runtime ??= new CommandRuntime(
      runtimeDefinitions,
      createDomainExpressionRuntime(),
      options.stateStore ?? new MemoryStateStore(),
    );

  const descriptors = new Map<string, HostComponentDescriptor>();
  const managerDescriptors = new Map<
    string,
    HostComponentDescriptor<DomainManager>
  >();
  for (const manager of managerDeclarations.values()) {
    const descriptor = managerDescriptor(
      manager,
      commandRuntime,
      aggregates,
    );
    managerDescriptors.set(manager.declaration.name, descriptor);
    descriptors.set(
      manager.declaration.name,
      descriptor,
    );
  }
  for (const declaration of syntax.declarations) {
    if (declaration.kind !== "controller") continue;
    const controller = {
      declaration,
      context: contexts.get(declaration.name) ?? "",
    };
    const descriptor = controllerDescriptor(
      controller,
      managerDeclarations,
      managerDescriptors,
    );
    if (controller.context.length === 0) {
      descriptors.set(declaration.name, descriptor);
      continue;
    }
    const context = syntax.declarations.find((candidate) =>
      candidate.kind === "context" &&
      candidate.name === controller.context
    );
    if (
      context?.kind === "context" &&
      context.members.some((member) =>
        member.name === declaration.name && member.exported
      )
    ) {
      descriptors.set(
        `${controller.context}.${declaration.name}`,
        descriptor,
      );
    }
  }
  return descriptors;
}
