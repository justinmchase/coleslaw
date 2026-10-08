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
import type {
  ComponentResource,
  HostComponentDescriptor,
} from "./composition.ts";
import { problemResponse } from "./problems.ts";
import type {
  RawAggregateDeclaration,
  RawComponentBinding,
  RawConfigMember,
  RawContextMember,
  RawControllerDeclaration,
  RawControllerRoute,
  RawManagerDeclaration,
  RawSyntaxModule,
  SourceSpan,
  UffdaExpressionNode,
  UffdaPatternNode,
} from "./syntax.ts";
import {
  expandShapeReferences,
  type ShapeDefinition,
  shapeDefinitionsFromDeclarations,
} from "./shapes.ts";

interface DomainManager {
  invoke(operation: string, input: unknown): Promise<unknown>;
}

interface DomainController {
  handle(request: Request): Promise<Response>;
}

interface AggregateCapability {
  readonly context: string;
  readonly declaration: string;
  readonly identity: string;
}

const aggregateCapabilityTokens = new WeakSet<object>();

function aggregateCapability(
  context: string,
  declaration: string,
): AggregateCapability {
  const capability = Object.freeze({
    context,
    declaration,
    identity: contextKind(context, declaration),
  });
  aggregateCapabilityTokens.add(capability);
  return capability;
}

function isAggregateCapability(
  value: unknown,
  identity: string,
): value is AggregateCapability {
  return typeof value === "object" && value !== null &&
    aggregateCapabilityTokens.has(value) &&
    Reflect.get(value, "identity") === identity;
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
  shapes: ReadonlyMap<string, ShapeDefinition> = new Map(),
): void {
  const expanded = expandShapeReferences(pattern as UffdaPatternNode, shapes);
  if (!expanded.ok) {
    diagnostics.push({
      code: "INVALID_NAMED_SHAPE",
      message: expanded.message,
      span,
    });
    return;
  }
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
  visit(expanded.pattern);
}

function validateSettingsPatterns(
  members: readonly RawConfigMember[],
  diagnostics: DomainDiagnostic[],
  shapes: ReadonlyMap<string, ShapeDefinition> = new Map(),
): void {
  for (const member of members) {
    if (member.kind === "group") {
      validateSettingsPatterns(member.settings, diagnostics, shapes);
    } else {
      validatePatternExpressions(member.pattern, member.span, diagnostics);
    }
  }
}

export function validateDeclarativeDomain(
  syntax: RawSyntaxModule,
  importedShapes: ReadonlyMap<string, ShapeDefinition> = new Map(),
  importedDeclarations: ReadonlyMap<
    string,
    RawSyntaxModule["declarations"][number]
  > = new Map(),
): readonly DomainDiagnostic[] {
  const diagnostics: DomainDiagnostic[] = [];
  const shapes = new Map(shapeDefinitionsFromDeclarations(syntax.declarations));
  for (const [name, shape] of importedShapes) {
    if (!shapes.has(name)) shapes.set(name, shape);
  }
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
  const contextBindings = new Map<
    string,
    Map<string, RawContextMember>
  >();
  const isDomainDeclaration = (
    declaration: RawSyntaxModule["declarations"][number],
  ): declaration is
    | RawAggregateDeclaration
    | RawManagerDeclaration
    | RawControllerDeclaration =>
    declaration.kind === "aggregate" || declaration.kind === "manager" ||
    declaration.kind === "controller";
  for (const declaration of syntax.declarations) {
    if (declaration.kind === "config") {
      validateSettingsPatterns(declaration.settings, diagnostics, shapes);
    } else if (declaration.kind === "shape") {
      validatePatternExpressions(
        declaration.pattern,
        declaration.span,
        diagnostics,
        shapes,
      );
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
      for (const parameter of declaration.parameters) {
        validatePatternExpressions(
          parameter.pattern,
          parameter.span,
          diagnostics,
          shapes,
        );
      }
      const bindingNames = new Set(
        declaration.sections.flatMap((section) =>
          section.bindings.map((binding) => binding.name)
        ),
      );
      for (const section of declaration.sections) {
        for (const binding of section.bindings) {
          for (const expression of binding.arguments) {
            const bindings = new Set(bindingNames);
            for (const parameter of declaration.parameters) {
              bindings.add(parameter.name);
            }
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
      "Context binding",
      context.span,
      diagnostics,
    );
    const bindings = new Map<string, typeof context.members[number]>();
    contextBindings.set(context.name, bindings);
    for (const member of context.members) {
      if (!bindings.has(member.name)) bindings.set(member.name, member);
      const declaration = declarations.get(member.declaration);
      if (declaration === undefined) {
        const imported = importedDeclarations.get(member.declaration);
        if (
          imported?.kind === "aggregate" || imported?.kind === "manager" ||
          imported?.kind === "controller"
        ) {
          diagnostics.push({
            code: "UNSUPPORTED_IMPORTED_CONTEXT_BINDING",
            message:
              `Context ${context.name} cannot bind imported ${imported.kind} ${member.declaration}; imported domain declarations are not supported as context bindings`,
            span: member.span,
          });
          continue;
        }
        diagnostics.push({
          code: "UNKNOWN_CONTEXT_MEMBER",
          message:
            `Context ${context.name} binding ${member.name} refers to unknown declaration ${member.declaration}`,
          span: member.span,
        });
        continue;
      }
      if (!isDomainDeclaration(declaration)) {
        diagnostics.push({
          code: "INVALID_CONTEXT_BINDING",
          message:
            `Context ${context.name} binding ${member.name} must compose an aggregate, manager, or controller`,
          span: member.span,
        });
        continue;
      }
      if (member.exported && declaration.kind !== "controller") {
        diagnostics.push({
          code: "PRIVATE_DOMAIN_MEMBER",
          message:
            `Context ${context.name} must not export ${declaration.kind} binding ${member.name}`,
          span: member.span,
        });
      }
      const owner = contexts.get(declaration.name);
      if (owner !== undefined && owner !== context.name) {
        diagnostics.push({
          code: "DUPLICATE_CONTEXT_OWNERSHIP",
          message:
            `${declaration.name} is owned by both ${owner} and ${context.name}`,
          span: member.span,
        });
      } else if (owner === undefined) {
        contexts.set(declaration.name, context.name);
      }
    }
  }
  for (const declaration of syntax.declarations) {
    if (isDomainDeclaration(declaration) && !contexts.has(declaration.name)) {
      diagnostics.push({
        code: "UNOWNED_DOMAIN_MEMBER",
        message:
          `${declaration.kind} ${declaration.name} must belong to a context`,
        span: declaration.span,
      });
    }
  }
  for (const context of contextDeclarations) {
    if (context.kind !== "context") continue;
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
      validatePatternExpressions(
        field.pattern,
        field.span,
        diagnostics,
        shapes,
      );
      validateExpressionScope(
        field.initial,
        new Set(),
        field.span,
        diagnostics,
      );
    }
    for (const shape of [...declaration.commands, ...declaration.events]) {
      validatePatternExpressions(
        shape.pattern,
        shape.span,
        diagnostics,
        shapes,
      );
    }
    for (const invariant of declaration.invariants) {
      validatePatternExpressions(
        invariant,
        declaration.span,
        diagnostics,
        shapes,
      );
    }
    for (const state of declaration.states) {
      for (const handler of state.commands) {
        if (handler.guard !== undefined) {
          validatePatternExpressions(
            handler.guard,
            handler.span,
            diagnostics,
            shapes,
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
          aggregateDefinition(declaration, shapes),
        ]]),
        createDomainExpressionRuntime(shapes),
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
      declaration.parameters.map((parameter) => parameter.name),
      `Manager ${declaration.name} parameter`,
      declaration.span,
      diagnostics,
    );
    const managerParameters = new Map(
      declaration.parameters.map((parameter) =>
        [
          parameter.name,
          parameter,
        ] as const
      ),
    );
    for (const parameter of declaration.parameters) {
      const aggregate = aggregates.get(parameter.type);
      if (aggregate === undefined) {
        diagnostics.push({
          code: "INVALID_MANAGER_PARAMETER",
          message:
            `Manager ${declaration.name} parameter ${parameter.name} must bind an aggregate declaration`,
          span: parameter.span,
        });
      } else if (
        contexts.get(aggregate.name) !== contexts.get(declaration.name)
      ) {
        diagnostics.push({
          code: "CROSS_CONTEXT_AGGREGATE_ACCESS",
          message:
            `Manager ${declaration.name} cannot bind aggregate ${aggregate.name} outside its context`,
          span: parameter.span,
        });
      }
    }
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
        shapes,
      );
      validatePatternExpressions(
        operation.result,
        operation.span,
        diagnostics,
        shapes,
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
      const parameter = managerParameters.get(
        operation.aggregateParameter,
      );
      const aggregate = parameter === undefined
        ? undefined
        : aggregates.get(parameter.type);
      if (aggregate === undefined) {
        diagnostics.push({
          code: "UNKNOWN_MANAGER_AGGREGATE",
          message:
            `Manager ${declaration.name}.${operation.name} refers to unbound aggregate capability ${operation.aggregateParameter}`,
          span: operation.span,
        });
        continue;
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
    duplicateNames(
      declaration.parameters.map((parameter) => parameter.name),
      `Controller ${declaration.name} parameter`,
      declaration.span,
      diagnostics,
    );
    const controllerParameters = new Map(
      declaration.parameters.map((parameter) =>
        [
          parameter.name,
          parameter,
        ] as const
      ),
    );
    for (const parameter of declaration.parameters) {
      const manager = managers.get(parameter.type);
      if (manager === undefined) {
        diagnostics.push({
          code: "INVALID_CONTROLLER_PARAMETER",
          message:
            `Controller ${declaration.name} parameter ${parameter.name} must bind a manager declaration`,
          span: parameter.span,
        });
      } else if (
        contexts.get(manager.name) !== contexts.get(declaration.name)
      ) {
        diagnostics.push({
          code: "CROSS_CONTEXT_MANAGER_ACCESS",
          message:
            `Controller ${declaration.name} cannot bind manager ${manager.name} outside its context`,
          span: parameter.span,
        });
      }
    }
    for (const route of declaration.routes) {
      for (const shape of route.requestShapes) {
        validatePatternExpressions(
          shape.pattern,
          shape.span,
          diagnostics,
          shapes,
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
      const managerParameter = managerName === undefined
        ? undefined
        : controllerParameters.get(managerName);
      const manager = managerParameter === undefined
        ? undefined
        : managers.get(managerParameter.type);
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
  for (const context of contextDeclarations) {
    if (context.kind !== "context") continue;
    const bindings = contextBindings.get(context.name) ?? new Map();
    const edges = new Map<string, string[]>();
    for (const member of context.members) {
      const declaration = declarations.get(member.declaration);
      const parameters = declaration?.kind === "manager" ||
          declaration?.kind === "controller"
        ? declaration.parameters
        : [];
      edges.set(member.name, []);
      if (declaration === undefined || !isDomainDeclaration(declaration)) {
        continue;
      }
      if (contexts.get(declaration.name) !== context.name) {
        diagnostics.push({
          code: "CROSS_CONTEXT_BINDING",
          message:
            `Context ${context.name} cannot compose ${declaration.name} outside its context`,
          span: member.span,
        });
      }
      if (member.arguments.length !== parameters.length) {
        diagnostics.push({
          code: "INVALID_CONTEXT_ARGUMENT_COUNT",
          message:
            `Context binding ${member.name} expects ${parameters.length} dependencies but received ${member.arguments.length}`,
          span: member.span,
        });
      }
      for (let index = 0; index < parameters.length; index++) {
        const parameter = parameters[index];
        const argument = member.arguments[index];
        if (parameter === undefined || argument === undefined) continue;
        const dependency = bindings.get(argument);
        if (dependency === undefined) {
          diagnostics.push({
            code: "UNKNOWN_CONTEXT_BINDING",
            message:
              `Context binding ${member.name} refers to unknown binding ${argument}`,
            span: member.span,
          });
          continue;
        }
        edges.get(member.name)?.push(argument);
        if (dependency.declaration !== parameter.type) {
          diagnostics.push({
            code: "INVALID_CONTEXT_ARGUMENT_TYPE",
            message:
              `Context binding ${member.name}.${parameter.name} requires ${parameter.type}, not ${dependency.declaration}`,
            span: member.span,
          });
        }
      }
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visitBinding = (name: string): void => {
      if (visiting.has(name)) {
        diagnostics.push({
          code: "CONTEXT_DEPENDENCY_CYCLE",
          message: `Context ${context.name} has a dependency cycle at ${name}`,
          span: bindings.get(name)?.span,
        });
        return;
      }
      if (visited.has(name)) return;
      visiting.add(name);
      for (const dependency of edges.get(name) ?? []) {
        visitBinding(dependency);
      }
      visiting.delete(name);
      visited.add(name);
    };
    for (const name of bindings.keys()) visitBinding(name);
    const contextExported = syntax.declarations.some((candidate) =>
      candidate.kind === "export" && candidate.name === context.name
    );
    if (!contextExported && context.members.some((member) => member.exported)) {
      diagnostics.push({
        code: "PRIVATE_CONTEXT_EXPORT",
        message:
          `Context ${context.name} must be exported before its bindings can be exported`,
        span: context.span,
      });
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
        const contextBinding = context.members.find((member) =>
          member.name === memberName
        );
        return {
          declaration: contextBinding === undefined
            ? undefined
            : declarations.get(contextBinding.declaration),
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
      if (
        component?.kind !== "aggregate" && component?.kind !== "manager" &&
        component?.kind !== "controller"
      ) continue;
      const ownerName = contexts.get(component.name);
      const owner = ownerName === undefined
        ? undefined
        : contextsByName.get(ownerName);
      if (
        owner !== undefined &&
        (
          resolved.contextName !== owner.name ||
          !exportedNames.has(owner.name) ||
          contextMembers.get(resolved.memberName ?? "")?.exported !== true ||
          component.kind !== "controller"
        )
      ) {
        diagnostics.push({
          code: "CONTROLLER_NOT_EXPORTED_BY_CONTEXT",
          message:
            `Mode ${mode.name} must reach controller ${component.name} through an exported binding of its context`,
          span: binding.span,
        });
      }
    }
    for (const binding of members) {
      const component = modeComponent(binding).declaration;
      if (
        (component?.kind === "manager" || component?.kind === "aggregate") &&
        contexts.has(component.name)
      ) {
        diagnostics.push({
          code: "CROSS_CONTEXT_MANAGER_ACCESS",
          message:
            `Mode ${mode.name} cannot compose context-owned ${component.kind} ${component.name} directly`,
          span: binding.span,
        });
      }
    }
  }
  return diagnostics;
}

function aggregateDefinition(
  declaration: RawAggregateDeclaration,
  shapes: ReadonlyMap<string, ShapeDefinition> = new Map(),
): AggregateDefinition<UffdaPatternNode, UffdaExpressionNode> {
  const expand = (pattern: UffdaPatternNode): UffdaPatternNode => {
    const result = expandShapeReferences(pattern, shapes);
    if (!result.ok) throw new Error(result.message);
    return result.pattern;
  };
  return {
    name: declaration.name,
    identityField: declaration.identityField,
    fields: Object.fromEntries(declaration.fields.map((field) => [
      field.name,
      { pattern: expand(field.pattern), initial: field.initial },
    ])),
    commands: Object.fromEntries(declaration.commands.map((command) => [
      command.name,
      expand(command.pattern),
    ])),
    events: Object.fromEntries(declaration.events.map((event) => [
      event.name,
      expand(event.pattern),
    ])),
    invariants: declaration.invariants.map(expand),
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

export function createDomainExpressionRuntime(
  shapes: ReadonlyMap<string, ShapeDefinition> = new Map(),
): PatternExpressionRuntime<
  UffdaPatternNode,
  UffdaExpressionNode
> {
  return {
    async match(pattern, input) {
      const expanded = expandShapeReferences(pattern, shapes);
      if (!expanded.ok) return { matched: false, value: input };
      const result = await matchPattern(expanded.pattern, domainScope(input));
      if (
        isClean(result) && result.kind === MatchKind.Ok &&
        await closedObjectsMatch(expanded.pattern, input)
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
      contexts.set(member.declaration, declaration.name);
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
  shapes: ReadonlyMap<string, ShapeDefinition> = new Map(),
): Promise<{ matched: boolean; value: unknown }> {
  const result = await createDomainExpressionRuntime(shapes).match(
    pattern,
    value,
  );
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
  shapes: ReadonlyMap<string, ShapeDefinition>,
): HostComponentDescriptor<DomainManager> {
  const expectedCapabilities = manager.declaration.parameters.map(
    (parameter) => contextKind(manager.context, parameter.type),
  );
  return {
    kind: "manager",
    identity: contextKind(manager.context, manager.declaration.name),
    parameters: manager.declaration.parameters.map((parameter, index) => ({
      name: parameter.name,
      type: {
        kind: "component" as const,
        category: "aggregate" as const,
        identity: expectedCapabilities[index],
      },
    })),
    create(arguments_) {
      const aggregateCapabilities = new Map<string, AggregateCapability>();
      for (
        let index = 0;
        index < manager.declaration.parameters.length;
        index++
      ) {
        const parameter = manager.declaration.parameters[index];
        const identity = expectedCapabilities[index];
        const capability = arguments_[index];
        if (
          parameter === undefined || identity === undefined ||
          !isAggregateCapability(capability, identity)
        ) {
          throw new Error(
            `Manager ${manager.declaration.name} requires its declared aggregate capability ${
              parameter?.type ?? ""
            }`,
          );
        }
        aggregateCapabilities.set(parameter.name, capability);
      }
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
              const runtime = createDomainExpressionRuntime(shapes);
              const matched = await runtime.match(operation.input, input);
              if (!matched.matched) {
                return {
                  kind: "refused",
                  reason: `Input does not match operation ${operationName}`,
                } satisfies OperationOutcome;
              }
              const capability = aggregateCapabilities.get(
                operation.aggregateParameter,
              );
              const aggregate = capability === undefined
                ? undefined
                : definitions.get(capability.declaration);
              if (aggregate === undefined || capability === undefined) {
                return {
                  kind: "failed",
                  error:
                    `Unknown aggregate capability ${operation.aggregateParameter}`,
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
                capability.identity,
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
  shapes: ReadonlyMap<string, ShapeDefinition>,
): HostComponentDescriptor<DomainController> {
  return {
    kind: "controller",
    identity: contextKind(controller.context, controller.declaration.name),
    parameters: controller.declaration.parameters.map((parameter) => ({
      name: parameter.name,
      type: {
        kind: "component" as const,
        category: "manager" as const,
        identity: contextKind(controller.context, parameter.type),
      },
    })),
    create(arguments_) {
      const managers = new Map<string, DomainManager>();
      for (
        let index = 0;
        index < controller.declaration.parameters.length;
        index++
      ) {
        const parameter = controller.declaration.parameters[index];
        const candidate = arguments_[index];
        if (
          parameter === undefined || typeof candidate !== "object" ||
          candidate === null ||
          typeof Reflect.get(candidate, "invoke") !== "function"
        ) {
          throw new Error(
            `Controller ${controller.declaration.name} requires manager dependency ${
              parameter?.name ?? ""
            }`,
          );
        }
        managers.set(parameter.name, candidate as DomainManager);
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
                : await matchRequestShape(pathShape.pattern, path, shapes);
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
                  shapes,
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
                  shapes,
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
                  shapes,
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
              const input = await createDomainExpressionRuntime(shapes)
                .evaluate(
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
  options: {
    readonly stateStore?: StateStore;
    readonly shapes?: ReadonlyMap<string, ShapeDefinition>;
  } = {},
): ReadonlyMap<string, HostComponentDescriptor> {
  const shapes = new Map(shapeDefinitionsFromDeclarations(syntax.declarations));
  for (const [name, shape] of options.shapes ?? []) {
    if (!shapes.has(name)) shapes.set(name, shape);
  }
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
      aggregateDefinition(aggregate, shapes),
    ]),
  );
  let runtime:
    | CommandRuntime<UffdaPatternNode, UffdaExpressionNode>
    | undefined;
  const commandRuntime = () =>
    runtime ??= new CommandRuntime(
      runtimeDefinitions,
      createDomainExpressionRuntime(shapes),
      options.stateStore ?? new MemoryStateStore(),
    );

  const descriptors = new Map<string, HostComponentDescriptor>();
  const declarations = new Map(
    syntax.declarations.flatMap((declaration) => {
      const name = declarationName(declaration);
      return name === undefined ? [] : [[name, declaration] as const];
    }),
  );
  const componentDescriptors = new Map<string, HostComponentDescriptor>();
  for (const aggregate of aggregates.values()) {
    const owner = contexts.get(aggregate.name) ?? "";
    const identity = contextKind(owner, aggregate.name);
    componentDescriptors.set(aggregate.name, {
      kind: "aggregate",
      identity,
      parameters: [],
      create: () => ({ value: aggregateCapability(owner, aggregate.name) }),
    });
  }
  for (const manager of managerDeclarations.values()) {
    const descriptor = managerDescriptor(
      manager,
      commandRuntime,
      aggregates,
      shapes,
    );
    componentDescriptors.set(manager.declaration.name, descriptor);
  }
  for (const declaration of syntax.declarations) {
    if (declaration.kind !== "controller") continue;
    const controller = {
      declaration,
      context: contexts.get(declaration.name) ?? "",
    };
    componentDescriptors.set(
      declaration.name,
      controllerDescriptor(controller, shapes),
    );
  }
  for (const context of syntax.declarations) {
    if (context.kind !== "context") continue;
    const members = new Map(
      context.members.map((member) => [member.name, member] as const),
    );
    const dependencies = new Map<string, Promise<ComponentResource>>();
    const constructedDependencies: ComponentResource[] = [];
    let activeRoots = 0;
    const constructDependency = (name: string) => {
      const existing = dependencies.get(name);
      if (existing !== undefined) return existing;
      const memberBinding = members.get(name);
      if (memberBinding === undefined) {
        return Promise.reject(
          new Error(`Context ${context.name} has no binding ${name}`),
        );
      }
      const pending = Promise.resolve().then(async () => {
        const descriptor = componentDescriptors.get(
          memberBinding.declaration,
        );
        if (descriptor === undefined) {
          throw new Error(
            `Context binding ${name} has no component descriptor`,
          );
        }
        const arguments_: unknown[] = [];
        for (const argument of memberBinding.arguments) {
          const dependency = await constructDependency(argument);
          arguments_.push(dependency.value);
        }
        const resource = await descriptor.create(arguments_);
        constructedDependencies.push(resource);
        return resource;
      });
      dependencies.set(name, pending);
      return pending;
    };
    const disposeDependencies = async () => {
      const failures: unknown[] = [];
      for (const resource of constructedDependencies.splice(0).reverse()) {
        try {
          await resource.dispose?.();
        } catch (error) {
          failures.push(error);
        }
      }
      dependencies.clear();
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `Context ${context.name} dependency cleanup failed`,
        );
      }
    };
    for (const member of context.members) {
      if (!member.exported) continue;
      const target = declarations.get(member.declaration);
      if (target?.kind !== "controller") continue;
      const targetDescriptor = componentDescriptors.get(member.declaration);
      if (targetDescriptor === undefined) continue;
      descriptors.set(`${context.name}.${member.name}`, {
        kind: "controller",
        identity: contextKind(context.name, target.name),
        parameters: [],
        async create() {
          activeRoots++;
          let root: ComponentResource;
          try {
            const arguments_: unknown[] = [];
            const contextBinding = members.get(member.name);
            if (contextBinding === undefined) {
              throw new Error(
                `Context ${context.name} has no binding ${member.name}`,
              );
            }
            for (const argument of contextBinding.arguments) {
              const dependency = await constructDependency(argument);
              arguments_.push(dependency.value);
            }
            root = await targetDescriptor.create(arguments_);
          } catch (error) {
            activeRoots--;
            try {
              if (activeRoots === 0) await disposeDependencies();
            } catch (cleanupError) {
              throw new AggregateError(
                [error, cleanupError],
                `Context ${context.name} construction and cleanup failed`,
              );
            }
            throw error;
          }
          let disposed = false;
          return {
            value: root.value,
            async dispose() {
              if (disposed) return;
              disposed = true;
              const failures: unknown[] = [];
              try {
                await root.dispose?.();
              } catch (error) {
                failures.push(error);
              }
              activeRoots--;
              if (activeRoots === 0) {
                try {
                  await disposeDependencies();
                } catch (error) {
                  failures.push(error);
                }
              }
              if (failures.length > 0) {
                throw new AggregateError(
                  failures,
                  `Context ${context.name} cleanup failed`,
                );
              }
            },
          };
        },
      });
    }
  }
  return descriptors;
}
