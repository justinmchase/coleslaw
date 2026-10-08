import {
  checkComposition,
  type ComponentBinding as CheckedComponentBinding,
  type ComponentCategory,
  type CompositionArgument,
  type CompositionProblem,
  type HostComponentDescriptor,
  type HostModeDescriptor,
  type ModeComposition,
  type ModeRunOptions,
} from "./composition.ts";
import { problemResponse } from "./problems.ts";
import type {
  RawCompositionSection,
  RawConfigDeclaration,
  RawModeDeclaration,
  RawProgramDeclaration,
  RawSyntaxModule,
  SourceSpan,
  UffdaExpressionNode,
} from "./syntax.ts";
import { ExpressionKind } from "@justinmchase/uffda/expression";

export interface ApplicationDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly span?: SourceSpan;
}

export interface ApplicationCheckEnvironment {
  readonly importedNames?: ReadonlySet<string>;
  readonly importedDeclarations?: ReadonlyMap<
    string,
    RawSyntaxModule["declarations"][number]
  >;
  readonly modeDescriptors?: ReadonlyMap<string, HostModeDescriptor>;
  readonly componentDescriptors?: ReadonlyMap<
    string,
    HostComponentDescriptor
  >;
}

export interface CheckedApplication {
  readonly syntax: RawSyntaxModule;
  readonly config: RawConfigDeclaration;
  readonly program: RawProgramDeclaration;
  readonly modes: ReadonlyMap<string, RawModeDeclaration>;
  readonly exports: ReadonlySet<string>;
}

export type ApplicationCheck =
  | { readonly ok: true; readonly checked: CheckedApplication }
  | {
    readonly ok: false;
    readonly diagnostics: readonly ApplicationDiagnostic[];
  };

export const BUILTIN_MODES: Readonly<Record<string, HostModeDescriptor>> = {
  Web: {
    kind: "Web",
    traversal: "limited",
    entryPoint: "controller",
    async run(entryPoints, arguments_, options?: ModeRunOptions) {
      const controllers = entryPoints.map((entryPoint) => {
        if (
          typeof entryPoint !== "object" || entryPoint === null ||
          typeof Reflect.get(entryPoint, "handle") !== "function"
        ) {
          throw new Error("Web entry point does not expose an HTTP handler");
        }
        return entryPoint as { handle(request: Request): Promise<Response> };
      });
      const port = arguments_[0] ?? 8080;
      const hostname = arguments_[1] ?? "0.0.0.0";
      if (
        typeof port !== "number" || !Number.isInteger(port) || port < 0 ||
        port > 65535
      ) {
        throw new Error(
          "Web mode port must be an integer from 0 through 65535",
        );
      }
      if (typeof hostname !== "string" || hostname.length === 0) {
        throw new Error("Web mode hostname must be a non-empty string");
      }
      const shutdown = new AbortController();
      const onInterrupt = () => shutdown.abort();
      const onExternalAbort = () => shutdown.abort();
      const signals = Deno.build.os === "windows"
        ? ["SIGINT"] as const
        : ["SIGINT", "SIGTERM"] as const;
      const registeredSignals: (typeof signals)[number][] = [];
      let server: ReturnType<typeof Deno.serve> | undefined;
      let serverFailure: unknown;
      let serverFailed = false;
      const cleanupFailures: unknown[] = [];
      try {
        if (options?.signal?.aborted) shutdown.abort();
        else {options?.signal?.addEventListener("abort", onExternalAbort, {
            once: true,
          });}
        for (const signal of signals) {
          Deno.addSignalListener(signal, onInterrupt);
          registeredSignals.push(signal);
        }
        server = Deno.serve({
          hostname,
          port,
          signal: shutdown.signal,
          onListen: (address) => {
            options?.onListen?.(address);
            console.log(
              `Web mode listening on http://${address.hostname}:${address.port}`,
            );
          },
        }, async (request) => {
          const allowedMethods = new Set<string>();
          let methodNotAllowed = false;
          for (const controller of controllers) {
            try {
              const response = await controller.handle(request);
              if (response.status === 405) {
                methodNotAllowed = true;
                for (
                  const method of response.headers.get("allow")?.split(",") ??
                    []
                ) {
                  const trimmed = method.trim();
                  if (trimmed.length > 0) allowedMethods.add(trimmed);
                }
                continue;
              }
              if (response.status !== 404) return response;
            } catch (error) {
              console.error(
                `Web controller failed: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
              return problemResponse(
                500,
                "Internal Server Error",
                "Internal server error",
              );
            }
          }
          if (methodNotAllowed) {
            return problemResponse(
              405,
              "Method Not Allowed",
              undefined,
              {},
              allowedMethods.size > 0
                ? { allow: [...allowedMethods].join(", ") }
                : {},
            );
          }
          return problemResponse(404, "Not Found");
        });
        await server.finished;
      } catch (error) {
        if (
          !shutdown.signal.aborted ||
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          serverFailure = error;
          serverFailed = true;
        }
      }
      if (server !== undefined && !shutdown.signal.aborted) {
        try {
          await server.shutdown();
        } catch (error) {
          cleanupFailures.push(error);
        }
      }
      for (const signal of registeredSignals) {
        try {
          Deno.removeSignalListener(signal, onInterrupt);
        } catch (error) {
          cleanupFailures.push(error);
        }
      }
      options?.signal?.removeEventListener("abort", onExternalAbort);
      if (serverFailed && cleanupFailures.length > 0) {
        throw new AggregateError(
          [serverFailure, ...cleanupFailures],
          "Web server and signal-listener cleanup failed",
        );
      }
      if (serverFailed) throw serverFailure;
      if (cleanupFailures.length > 0) {
        throw new AggregateError(cleanupFailures, "Web server cleanup failed");
      }
    },
  },
  Worker: {
    kind: "Worker",
    traversal: "full",
    entryPoint: "consumer",
    run: () => {
      throw new Error(
        "The Worker host adapter is not available in this runtime",
      );
    },
  },
  Job: {
    kind: "Job",
    traversal: "full",
    entryPoint: "job",
    run: (entryPoints, arguments_) => {
      if (entryPoints.length !== 1) {
        throw new Error("Job mode must execute exactly one job");
      }
      const selected = entryPoints[0];
      const run = typeof selected === "function"
        ? selected
        : typeof selected === "object" && selected !== null
        ? Reflect.get(selected, "run")
        : undefined;
      if (typeof run !== "function") {
        throw new Error("Selected job does not expose a run function");
      }
      return run(...arguments_);
    },
  },
  Events: {
    kind: "Events",
    traversal: "full",
    entryPoint: "reactor",
    run: () => {
      throw new Error(
        "The Events host adapter is not available in this runtime",
      );
    },
  },
};

function declarationName(
  declaration: RawSyntaxModule["declarations"][number],
): string | undefined {
  switch (declaration.kind) {
    case "config":
    case "shape":
    case "mode":
    case "program":
    case "context":
    case "aggregate":
    case "manager":
    case "controller":
      return declaration.name;
    case "import":
    case "export":
      return undefined;
  }
}

function pathExists(
  members: RawConfigDeclaration["settings"],
  path: readonly string[],
): boolean {
  const [name, ...rest] = path;
  const member = members.find((candidate) => candidate.name === name);
  if (member === undefined) return false;
  if (rest.length === 0) return member.kind === "setting";
  return member.kind === "group" && pathExists(member.settings, rest);
}

export function modeComposition(
  declaration: RawModeDeclaration,
  components: ReadonlyMap<string, HostComponentDescriptor>,
  configBinding: string,
  diagnostics: ApplicationDiagnostic[],
): ModeComposition | undefined {
  const sections: Partial<
    Record<ComponentCategory, CheckedComponentBinding[]>
  > = {};
  const categories: Readonly<
    Record<RawCompositionSection["name"], ComponentCategory>
  > = {
    services: "service",
    repositories: "repository",
    managers: "manager",
    controllers: "controller",
    jobs: "job",
    consumers: "consumer",
    reactors: "reactor",
  };
  let missingDescriptor = false;
  const bindingNames = new Set(
    declaration.sections.flatMap((section) =>
      section.bindings.map((binding) => binding.name)
    ),
  );
  for (const section of declaration.sections) {
    const category = categories[section.name];
    sections[category] = section.bindings.flatMap((binding) => {
      const component = binding.component.segments.join(".");
      const descriptor = components.get(component);
      if (descriptor === undefined) {
        missingDescriptor = true;
        diagnostics.push({
          code: "UNKNOWN_COMPONENT",
          message: `No imported host descriptor for ${component}`,
          span: binding.span,
        });
        return [];
      }
      const arguments_: CompositionArgument[] = [];
      for (const expression of binding.arguments) {
        const converted = compositionArgument(
          expression,
          configBinding,
          bindingNames,
          new Set(
            (declaration.parameters ?? []).map((parameter) => parameter.name),
          ),
        );
        if (converted === undefined) {
          diagnostics.push({
            code: "UNSUPPORTED_COMPONENT_ARGUMENT",
            message: `Unsupported constructor argument for ${binding.name}`,
            span: binding.span,
          });
        } else {
          arguments_.push(converted);
        }
      }
      return [{
        name: binding.name,
        component,
        category,
        descriptor,
        arguments: arguments_,
      }];
    });
  }
  return missingDescriptor
    ? undefined
    : { kind: modeKindName(declaration), sections };
}

function expressionPath(
  expression: UffdaExpressionNode,
): readonly string[] | undefined {
  if (expression.kind === ExpressionKind.Reference) return [expression.name];
  if (expression.kind === ExpressionKind.Member) {
    const prefix = expressionPath(expression.expression);
    return prefix === undefined ? undefined : [...prefix, expression.name];
  }
  return undefined;
}

export function compositionArgument(
  expression: UffdaExpressionNode,
  configBinding: string,
  bindingNames: ReadonlySet<string>,
  parameterNames: ReadonlySet<string> = new Set(),
): CompositionArgument | undefined {
  const path = expressionPath(expression);
  if (path !== undefined) {
    if (path[0] === configBinding && path.length > 1) {
      return { kind: "setting", path: path.slice(1) };
    }
    if (path.length === 1 && bindingNames.has(path[0])) {
      return { kind: "binding", name: path[0] };
    }
    if (path.length === 1 && parameterNames.has(path[0])) {
      return { kind: "parameter", name: path[0] };
    }
    return undefined;
  }
  switch (expression.kind) {
    case ExpressionKind.String: {
      if (!expression.values.every((value) => typeof value === "string")) {
        return undefined;
      }
      return {
        kind: "literal",
        value: expression.values.join(""),
      };
    }
    case ExpressionKind.Number:
    case ExpressionKind.Boolean:
      return { kind: "literal", value: expression.value };
    case ExpressionKind.Value:
      return expression.value === null
        ? { kind: "literal", value: null }
        : undefined;
    default:
      return undefined;
  }
}

export function modeKindName(declaration: RawModeDeclaration): string {
  return typeof declaration.modeKind === "string"
    ? declaration.modeKind
    : declaration.modeKind.segments.join(".");
}

function appendCompositionProblems(
  target: ApplicationDiagnostic[],
  problems: readonly CompositionProblem[],
  span: SourceSpan | undefined,
): void {
  for (const problem of problems) {
    target.push({ code: problem.code, message: problem.message, span });
  }
}

export function checkApplication(
  syntax: RawSyntaxModule,
  environment: ApplicationCheckEnvironment = {},
): ApplicationCheck {
  const diagnostics: ApplicationDiagnostic[] = [];
  const declarations = new Map<
    string,
    RawSyntaxModule["declarations"][number]
  >();
  const imported = new Set<string>();
  for (const declaration of syntax.declarations) {
    if (declaration.kind !== "import") continue;
    for (const name of declaration.names) {
      if (imported.has(name)) {
        diagnostics.push({
          code: "DUPLICATE_IMPORT",
          message: `Name ${name} is imported more than once`,
          span: declaration.span,
        });
      }
      imported.add(name);
      if (
        environment.importedNames !== undefined &&
        !environment.importedNames.has(name)
      ) {
        diagnostics.push({
          code: "UNRESOLVED_IMPORT",
          message: `Imported name ${name} did not resolve to an export`,
          span: declaration.span,
        });
      }
    }
  }
  for (const declaration of syntax.declarations) {
    if (declaration.kind === "import" || declaration.kind === "export") {
      continue;
    }
    const name = declarationName(declaration);
    if (name === undefined) continue;
    if (declarations.has(name) || imported.has(name)) {
      diagnostics.push({
        code: "DUPLICATE_DECLARATION",
        message: `Name ${name} is declared more than once`,
        span: declaration.span,
      });
    } else {
      declarations.set(name, declaration);
    }
  }

  const exports = new Set<string>();
  for (const declaration of syntax.declarations) {
    if (declaration.kind !== "export") continue;
    if (exports.has(declaration.name)) {
      diagnostics.push({
        code: "DUPLICATE_EXPORT",
        message: `Name ${declaration.name} is exported more than once`,
        span: declaration.span,
      });
    }
    if (
      !declarations.has(declaration.name) && !imported.has(declaration.name)
    ) {
      diagnostics.push({
        code: "UNKNOWN_EXPORT",
        message: `Cannot export unknown name ${declaration.name}`,
        span: declaration.span,
      });
    }
    exports.add(declaration.name);
  }

  const programs = [...declarations.values()].filter(
    (value): value is RawProgramDeclaration => value.kind === "program",
  );
  const modes = [...declarations.values()].filter(
    (value): value is RawModeDeclaration => value.kind === "mode",
  );
  if (programs.length !== 1) {
    diagnostics.push({
      code: "PROGRAM_COUNT",
      message:
        `Application module must declare exactly one program; found ${programs.length}`,
      span: syntax.span,
    });
  }
  const program = programs[0];
  const configName = program?.config.segments.join(".");
  const configDeclaration = configName === undefined
    ? undefined
    : declarations.get(configName) ??
      environment.importedDeclarations?.get(configName);
  const config = configDeclaration?.kind === "config"
    ? configDeclaration
    : undefined;
  const modesByName = new Map(modes.map((mode) => [mode.name, mode]));

  if (program && config === undefined) {
    diagnostics.push({
      code: "UNKNOWN_CONFIG",
      message: `Program ${program.name} refers to unknown config ${configName}`,
      span: program.config.span,
    });
  }
  if (program && config) {
    if (
      program.config.segments.length !== 1 ||
      program.config.segments[0] !== config.name
    ) {
      diagnostics.push({
        code: "UNKNOWN_CONFIG",
        message: `Program ${program.name} refers to unknown config ${
          program.config.segments.join(".")
        }`,
        span: program.config.span,
      });
    }
    const selectorPath = program.selector.segments;
    if (
      selectorPath[0] !== program.configBinding ||
      !pathExists(config.settings, selectorPath.slice(1))
    ) {
      diagnostics.push({
        code: "UNKNOWN_MODE_SELECTOR",
        message: `Program selector ${
          selectorPath.join(".")
        } does not name a setting in config ${config.name}`,
        span: program.selector.span,
      });
    }
    const positionals = new Set<number>();
    for (const mapping of program.positionals) {
      if (positionals.has(mapping.index)) {
        diagnostics.push({
          code: "DUPLICATE_POSITIONAL",
          message: `Positional index ${mapping.index} is mapped more than once`,
          span: mapping.span,
        });
      }
      positionals.add(mapping.index);
      if (
        mapping.index < 0 || !Number.isSafeInteger(mapping.index) ||
        mapping.setting.segments[0] !== program.configBinding ||
        !pathExists(config.settings, mapping.setting.segments.slice(1))
      ) {
        diagnostics.push({
          code: "INVALID_POSITIONAL",
          message:
            `Positional mapping ${mapping.index} refers to an invalid config setting`,
          span: mapping.span,
        });
      }
    }
    const labels = new Set<string>();
    if (program.selections.length === 0) {
      diagnostics.push({
        code: "MISSING_MODE_SELECTION",
        message: "Program must map at least one mode label",
        span: program.span,
      });
    }
    for (const selection of program.selections) {
      if (labels.has(selection.label)) {
        diagnostics.push({
          code: "DUPLICATE_MODE_LABEL",
          message: `Mode label ${
            JSON.stringify(selection.label)
          } is duplicated`,
          span: selection.span,
        });
      }
      labels.add(selection.label);
    }
    for (const selection of program.selections) {
      const modeName = selection.mode.segments.join(".");
      if (!modesByName.has(modeName) && !imported.has(modeName)) {
        diagnostics.push({
          code: "UNKNOWN_MODE",
          message: `Program maps ${
            JSON.stringify(selection.label)
          } to unknown mode ${modeName}`,
          span: selection.mode.span,
        });
      }
      const importedMode = environment.importedDeclarations?.get(modeName);
      const selectedMode = modesByName.get(modeName) ??
        (importedMode?.kind === "mode" ? importedMode : undefined);
      const selectedKind = selectedMode
        ? modeKindName(selectedMode)
        : undefined;
      const modeDescriptor = selectedKind !== undefined
        ? selectedKind in BUILTIN_MODES
          ? BUILTIN_MODES[selectedKind]
          : environment.modeDescriptors?.get(selectedKind)
        : undefined;
      const parameters = selectedMode?.parameters ?? [];
      if (
        parameters.length > 0 &&
        parameters.length !== selection.arguments.length
      ) {
        diagnostics.push({
          code: "INVALID_MODE_ARGUMENT_COUNT",
          message:
            `Mode ${modeName} expects ${parameters.length} arguments but received ${selection.arguments.length}`,
          span: selection.span,
        });
      } else if (
        selection.arguments.length > 0 &&
        parameters.length === 0 &&
        (modeDescriptor?.entryPoint !== "job" || selection.arguments.length > 1)
      ) {
        diagnostics.push({
          code: "UNSUPPORTED_MODE_ARGUMENTS",
          message: `Mode selection ${
            JSON.stringify(selection.label)
          } does not declare supported parameters`,
          span: selection.span,
        });
      }
    }
  }

  for (const mode of modes) {
    const parameterNames = (mode.parameters ?? []).map((parameter) =>
      parameter.name
    );
    if (
      new Set(parameterNames).size !== parameterNames.length ||
      parameterNames.some((name) =>
        name === program?.configBinding ||
        mode.sections.some((section) =>
          section.bindings.some((binding) => binding.name === name)
        )
      )
    ) {
      diagnostics.push({
        code: "DUPLICATE_MODE_PARAMETER",
        message:
          `Mode ${mode.name} parameter names must be unique and cannot shadow config or component bindings`,
        span: mode.span,
      });
    }
    const kindName = modeKindName(mode);
    const descriptor = kindName in BUILTIN_MODES
      ? BUILTIN_MODES[kindName]
      : environment.modeDescriptors?.get(kindName);
    if (descriptor === undefined) {
      diagnostics.push({
        code: "UNKNOWN_MODE_KIND",
        message: `Mode ${mode.name} uses unknown mode kind ${kindName}`,
        span: mode.span,
      });
      continue;
    }
    const composition = modeComposition(
      mode,
      environment.componentDescriptors ?? new Map(),
      program?.configBinding ?? "",
      diagnostics,
    );
    if (composition === undefined) continue;
    if (config !== undefined) {
      for (const bindings of Object.values(composition.sections)) {
        for (const binding of bindings ?? []) {
          for (const argument of binding.arguments) {
            if (
              argument.kind === "setting" &&
              !pathExists(config.settings, argument.path)
            ) {
              diagnostics.push({
                code: "UNKNOWN_COMPONENT_SETTING",
                message: `Component ${binding.name} refers to unknown setting ${
                  argument.path.join(".")
                }`,
                span: mode.span,
              });
            }
          }
        }
      }
    }
    const descriptors = environment.componentDescriptors ?? new Map();
    const checked = checkComposition(composition, descriptor, descriptors);
    if (!checked.ok) {
      appendCompositionProblems(diagnostics, checked.problems, mode.span);
    }
  }

  return diagnostics.length > 0 || config === undefined || program === undefined
    ? { ok: false, diagnostics }
    : {
      ok: true,
      checked: {
        syntax,
        config,
        program,
        modes: modesByName,
        exports,
      },
    };
}
