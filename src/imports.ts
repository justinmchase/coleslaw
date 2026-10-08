import { extname, resolve, toFileUrl } from "@std/path";
import { BUILTIN_MODES } from "./application.ts";
import {
  type HostComponentDescriptor,
  type HostModeDescriptor,
  isHostComponentDescriptor,
  isHostModeDescriptor,
} from "./composition.ts";
import { parseApplicationSource } from "./uffda.ts";
import type {
  RawSyntaxDeclaration,
  RawSyntaxModule,
  SourceSpan,
} from "./syntax.ts";

export interface ImportDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly span?: SourceSpan;
}

export interface ResolvedImports {
  readonly names: ReadonlySet<string>;
  readonly symbols: ReadonlyMap<string, unknown>;
  readonly declarations: ReadonlyMap<string, RawSyntaxDeclaration>;
  readonly modeDescriptors: ReadonlyMap<string, HostModeDescriptor>;
  readonly componentDescriptors: ReadonlyMap<string, HostComponentDescriptor>;
  readonly dependencies: ReadonlyMap<string, string>;
}

export type ResolveImportsResult =
  | { readonly ok: true; readonly resolved: ResolvedImports }
  | {
    readonly ok: false;
    readonly diagnostics: readonly ImportDiagnostic[];
  };

interface LoadedModule {
  readonly exports: ReadonlyMap<string, unknown>;
  readonly imports: ReadonlyMap<string, unknown>;
  readonly dependencies: ReadonlyMap<string, string>;
}

function localDeclarations(
  syntax: RawSyntaxModule,
): Map<string, RawSyntaxDeclaration> {
  const declarations = new Map<string, RawSyntaxDeclaration>();
  for (const declaration of syntax.declarations) {
    if (
      declaration.kind === "config" || declaration.kind === "mode" ||
      declaration.kind === "program" || declaration.kind === "context" ||
      declaration.kind === "aggregate" || declaration.kind === "manager" ||
      declaration.kind === "controller"
    ) {
      declarations.set(declaration.name, declaration);
    }
  }
  return declarations;
}

function rawExports(syntax: RawSyntaxModule): readonly string[] {
  return syntax.declarations.flatMap((declaration) =>
    declaration.kind === "export" ? [declaration.name] : []
  );
}

function hostFailure(
  name: string,
  value: unknown,
  span: SourceSpan | undefined,
): ImportDiagnostic | undefined {
  if (
    isHostComponentDescriptor(value) ||
    isHostModeDescriptor(value)
  ) {
    return undefined;
  }
  return {
    code: "INVALID_HOST_EXPORT",
    message:
      `Host export ${name} must be a component or mode descriptor, not ${typeof value}`,
    span,
  };
}

export async function resolveApplicationImports(
  syntax: RawSyntaxModule,
  sourcePath: string,
): Promise<ResolveImportsResult> {
  const diagnostics: ImportDiagnostic[] = [];
  const dependencies = new Map<string, string>();
  const cache = new Map<string, Promise<LoadedModule>>();
  const stack = new Set<string>();

  const load = (
    path: string,
    source: RawSyntaxModule,
  ): Promise<LoadedModule> => {
    const key = resolve(path);
    if (stack.has(key)) {
      throw new Error(`Circular Coleslaw module import: ${key}`);
    }
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    stack.add(key);
    const loading = loadBody(key, source).finally(() => stack.delete(key));
    cache.set(key, loading);
    return loading;
  };

  const loadBody = async (
    path: string,
    source: RawSyntaxModule,
  ): Promise<LoadedModule> => {
    const declarations = localDeclarations(source);
    const importedSymbols = new Map<string, unknown>();
    const localExports = new Map<string, unknown>();
    const imports = source.declarations.filter(
      (declaration) => declaration.kind === "import",
    );
    for (const declaration of imports) {
      if (declaration.kind !== "import") continue;
      const target = declaration.moduleUrl;
      if (!target.startsWith("./") && !target.startsWith("../")) {
        diagnostics.push({
          code: "UNSUPPORTED_IMPORT",
          message:
            `Only relative local module imports are supported, got ${target}`,
          span: declaration.span,
        });
        continue;
      }
      const dependencyPath = resolve(path, "..", target);
      let exported: ReadonlyMap<string, unknown>;
      if (extname(dependencyPath) === ".clsw") {
        let dependencySyntax: RawSyntaxModule;
        try {
          const text = await Deno.readTextFile(dependencyPath);
          const parsed = await parseApplicationSource(
            text,
            dependencyPath,
          );
          if (!parsed.ok) {
            diagnostics.push({
              code: "IMPORTED_MODULE_PARSE_FAILURE",
              message: parsed.failure.message,
              span: declaration.span,
            });
            continue;
          }
          dependencySyntax = parsed.syntax;
          dependencies.set(dependencyPath, text);
        } catch (error) {
          diagnostics.push({
            code: "IMPORT_READ_FAILURE",
            message: `Unable to read ${dependencyPath}: ${
              error instanceof Error ? error.message : String(error)
            }`,
            span: declaration.span,
          });
          continue;
        }
        const dependency = await load(dependencyPath, dependencySyntax);
        exported = dependency.exports;
        for (const [name, text] of dependency.dependencies) {
          dependencies.set(name, text);
        }
      } else if (
        extname(dependencyPath) === ".ts" ||
        extname(dependencyPath) === ".js"
      ) {
        let namespace: Readonly<Record<string, unknown>>;
        try {
          namespace = await import(toFileUrl(dependencyPath).href);
        } catch (error) {
          diagnostics.push({
            code: "HOST_IMPORT_FAILURE",
            message: `Unable to load host module ${dependencyPath}: ${
              error instanceof Error ? error.message : String(error)
            }`,
            span: declaration.span,
          });
          continue;
        }
        exported = new Map(Object.entries(namespace));
        const text = await Deno.readTextFile(dependencyPath);
        dependencies.set(dependencyPath, text);
      } else {
        diagnostics.push({
          code: "UNSUPPORTED_IMPORT_EXTENSION",
          message: `Unsupported imported module extension for ${target}`,
          span: declaration.span,
        });
        continue;
      }

      for (const name of declaration.names) {
        if (!exported.has(name)) {
          diagnostics.push({
            code: "UNEXPORTED_IMPORT",
            message: `${target} does not export ${name}`,
            span: declaration.span,
          });
          continue;
        }
        if (importedSymbols.has(name) || declarations.has(name)) {
          diagnostics.push({
            code: "DUPLICATE_IMPORT",
            message: `Name ${name} is declared or imported more than once`,
            span: declaration.span,
          });
          continue;
        }
        const value = exported.get(name);
        importedSymbols.set(name, value);
        if (
          extname(dependencyPath) === ".ts" ||
          extname(dependencyPath) === ".js"
        ) {
          const problem = hostFailure(name, value, declaration.span);
          if (problem) diagnostics.push(problem);
        }
        if (isHostModeDescriptor(value)) {
          if (
            Object.hasOwn(BUILTIN_MODES, value.kind) &&
            value !== BUILTIN_MODES[value.kind]
          ) {
            diagnostics.push({
              code: "BUILTIN_MODE_SHADOW",
              message:
                `Imported mode kind ${value.kind} cannot shadow a built-in`,
              span: declaration.span,
            });
          }
        }
      }
    }

    for (const [name, value] of declarations) localExports.set(name, value);
    const exported = new Map<string, unknown>();
    for (const name of rawExports(source)) {
      const value = localExports.get(name) ?? importedSymbols.get(name);
      if (value === undefined) {
        diagnostics.push({
          code: "UNKNOWN_EXPORT",
          message: `Cannot export unknown name ${name}`,
        });
      } else if (exported.has(name)) {
        diagnostics.push({
          code: "DUPLICATE_EXPORT",
          message: `Name ${name} is exported more than once`,
        });
      } else {
        exported.set(name, value);
      }
    }
    return {
      exports: exported,
      imports: importedSymbols,
      dependencies: new Map(),
    };
  };

  let rootPath: string;
  try {
    rootPath = await Deno.realPath(sourcePath);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [{
        code: "SOURCE_PATH_FAILURE",
        message: `Unable to resolve ${sourcePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }],
    };
  }
  try {
    const loaded = await load(rootPath, syntax);
    if (diagnostics.length > 0) return { ok: false, diagnostics };
    const visibleModeDescriptors = new Map<string, HostModeDescriptor>();
    const visibleComponentDescriptors = new Map<
      string,
      HostComponentDescriptor
    >();
    for (const [name, value] of loaded.imports) {
      if (isHostModeDescriptor(value)) visibleModeDescriptors.set(name, value);
      if (isHostComponentDescriptor(value)) {
        visibleComponentDescriptors.set(name, value);
      }
    }
    const declarations = new Map<string, RawSyntaxDeclaration>();
    for (const [name, value] of loaded.imports) {
      if (
        typeof value === "object" && value !== null &&
        [
          "config",
          "mode",
          "program",
          "context",
          "aggregate",
          "manager",
          "controller",
        ]
          .includes(Reflect.get(value, "kind"))
      ) {
        declarations.set(name, value as RawSyntaxDeclaration);
      }
    }
    return {
      ok: true,
      resolved: {
        names: new Set(loaded.imports.keys()),
        symbols: loaded.imports,
        declarations,
        modeDescriptors: visibleModeDescriptors,
        componentDescriptors: visibleComponentDescriptors,
        dependencies,
      },
    };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [{
        code: "IMPORT_GRAPH_FAILURE",
        message: error instanceof Error ? error.message : String(error),
      }],
    };
  }
}
