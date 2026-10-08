import { dirname, extname, isAbsolute, relative, resolve } from "@std/path";
import {
  type ApplicationDiagnostic,
  BUILTIN_MODES,
  checkApplication,
  compositionArgument,
  modeComposition,
  modeKindName,
} from "./application.ts";
import {
  checkComposition,
  type HostModeDescriptor,
  startComposition,
} from "./composition.ts";
import {
  type ConfigDiagnostic,
  environmentName,
  flattenSettings,
  prepareConfig,
} from "./config.ts";
import { formatDiagnostic, sourceSpan } from "./diagnostics.ts";
import { resolveApplicationImports } from "./imports.ts";
import { selectExactlyOneJob, selectMode } from "./selection.ts";
import {
  createDeclarativeHostComponents,
  validateDeclarativeDomain,
} from "./domain-runtime.ts";
import type {
  RawModeDeclaration,
  RawProgramDeclaration,
  RawSyntaxModule,
  SourceSpan,
  UffdaExpressionNode,
} from "./syntax.ts";
import { parseApplicationSource, UFFDA_API_VERSION } from "./uffda.ts";
import {
  checkedArtifactPath,
  type ColeslawProject,
  findColeslawProject,
} from "./project.ts";

const ARTIFACT_SCHEMA = "coleslaw.checked-application";
const ARTIFACT_VERSION = 1;
const COLESLAW_COMPILER_VERSION = "1.0.0";

interface CheckedArtifact {
  readonly schema: typeof ARTIFACT_SCHEMA;
  readonly version: typeof ARTIFACT_VERSION;
  readonly compilerVersion: typeof COLESLAW_COMPILER_VERSION;
  readonly uffdaApiVersion: typeof UFFDA_API_VERSION;
  readonly sourcePath: string;
  readonly sourceSha256: string;
  readonly dependencySha256: Readonly<Record<string, string>>;
  readonly syntax: unknown;
}

interface ValidatedApplication {
  readonly project: ColeslawProject;
  readonly sourcePath: string;
  readonly sourceText: string;
  readonly syntax: RawSyntaxModule;
  readonly settingMatcher: NonNullable<
    Extract<Awaited<ReturnType<typeof parseApplicationSource>>, { ok: true }>
  >["settingMatcher"];
  readonly imports: Extract<
    Awaited<ReturnType<typeof resolveApplicationImports>>,
    { ok: true }
  >["resolved"];
  readonly componentDescriptors: ReadonlyMap<
    string,
    import("./composition.ts").HostComponentDescriptor
  >;
  readonly program: RawProgramDeclaration;
  readonly config: Extract<
    ReturnType<typeof checkApplication>,
    { ok: true }
  >["checked"]["config"];
  readonly modes: ReadonlyMap<string, RawModeDeclaration>;
}

function hash(bytes: Uint8Array): Promise<string> {
  return crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer).then(
    (value) =>
      Array.from(
        new Uint8Array(value),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join(""),
  );
}

function jsonForSyntax(value: unknown): string {
  return JSON.stringify(value, (_key, current: unknown) => {
    if (current instanceof RegExp) {
      return { $type: "regexp", source: current.source, flags: current.flags };
    }
    if (typeof current === "bigint") {
      return { $type: "bigint", value: current.toString() };
    }
    return current;
  }, 2);
}

function printDiagnostic(
  diagnostic: {
    readonly code: string;
    readonly message: string;
    readonly span?: SourceSpan;
  },
): void {
  console.error(
    formatDiagnostic({
      code: diagnostic.code,
      message: diagnostic.message,
      span: diagnostic.span,
    }),
  );
}

function printConfigDiagnostics(
  diagnostics: readonly ConfigDiagnostic[],
): void {
  for (const diagnostic of diagnostics) {
    const source = diagnostic.source ? ` (${diagnostic.source})` : "";
    console.error(
      `coleslaw: ${diagnostic.code}: ${diagnostic.message}${source}`,
    );
  }
}

async function readSource(path: string): Promise<
  | { readonly ok: true; readonly path: string; readonly text: string }
  | { readonly ok: false }
> {
  const absolutePath = resolve(Deno.cwd(), path);
  try {
    return {
      ok: true,
      path: absolutePath,
      text: await Deno.readTextFile(absolutePath),
    };
  } catch (error) {
    console.error(
      `cslw: unable to read ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { ok: false };
  }
}

async function loadValidated(
  path: string,
): Promise<ValidatedApplication | undefined> {
  const file = await readSource(path);
  if (!file.ok) return undefined;
  const sourceName = relative(Deno.cwd(), file.path);
  const project = await findColeslawProject(file.path);
  const parsed = await parseApplicationSource(file.text, sourceName, project);
  if (!parsed.ok) {
    printDiagnostic({
      code: "PARSE_FAILURE",
      message: parsed.failure.message,
      span: sourceSpan(sourceName, file.text, parsed.failure.offset),
    });
    return undefined;
  }
  const domainDiagnostics = validateDeclarativeDomain(parsed.syntax);
  if (domainDiagnostics.length > 0) {
    for (const diagnostic of domainDiagnostics) {
      printDiagnostic(diagnostic);
    }
    return undefined;
  }
  const imports = await resolveApplicationImports(parsed.syntax, file.path);
  if (!imports.ok) {
    for (const diagnostic of imports.diagnostics) {
      printDiagnostic(diagnostic);
    }
    return undefined;
  }
  const componentDescriptors = new Map([
    ...imports.resolved.componentDescriptors,
    ...createDeclarativeHostComponents(parsed.syntax),
  ]);
  const checked = checkApplication(parsed.syntax, {
    importedNames: imports.resolved.names,
    importedDeclarations: imports.resolved.declarations,
    modeDescriptors: imports.resolved.modeDescriptors,
    componentDescriptors,
  });
  if (!checked.ok) {
    for (const diagnostic of checked.diagnostics) {
      printDiagnostic(diagnostic);
    }
    return undefined;
  }
  const importedConfigDiagnostics = validateDeclarativeDomain({
    ...parsed.syntax,
    declarations: [checked.checked.config],
  });
  if (importedConfigDiagnostics.length > 0) {
    for (const diagnostic of importedConfigDiagnostics) {
      printDiagnostic(diagnostic);
    }
    return undefined;
  }
  return {
    project,
    sourcePath: file.path,
    sourceText: file.text,
    syntax: parsed.syntax,
    settingMatcher: parsed.settingMatcher,
    imports: imports.resolved,
    componentDescriptors,
    program: checked.checked.program,
    config: checked.checked.config,
    modes: checked.checked.modes,
  };
}

async function compileApplication(
  application: ValidatedApplication,
): Promise<void> {
  const sourceSha256 = await hash(
    new TextEncoder().encode(application.sourceText),
  );
  const dependencySha256: Record<string, string> = {};
  for (const [path, text] of application.imports.dependencies) {
    dependencySha256[relative(application.project.root, path)] = await hash(
      new TextEncoder().encode(text),
    );
  }
  for (
    const path of [
      application.project.path,
      resolve(application.project.root, "clsw.lock"),
    ]
  ) {
    dependencySha256[relative(application.project.root, path)] = await hash(
      await Deno.readFile(path),
    );
  }
  const artifact: CheckedArtifact = {
    schema: ARTIFACT_SCHEMA,
    version: ARTIFACT_VERSION,
    compilerVersion: COLESLAW_COMPILER_VERSION,
    uffdaApiVersion: UFFDA_API_VERSION,
    sourcePath: relative(application.project.root, application.sourcePath),
    sourceSha256,
    dependencySha256,
    syntax: JSON.parse(jsonForSyntax(application.syntax)),
  };
  const target = checkedArtifactPath(
    application.sourcePath,
    application.project,
  );
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    await Deno.mkdir(dirname(target), { recursive: true });
    await Deno.writeTextFile(
      temporary,
      `${JSON.stringify(artifact, null, 2)}\n`,
    );
    await Deno.rename(temporary, target);
  } catch (error) {
    try {
      await Deno.remove(temporary);
    } catch (cleanupError) {
      if (!(cleanupError instanceof Deno.errors.NotFound)) throw cleanupError;
    }
    throw error;
  }
  console.log(target);
}

function isCheckedArtifact(value: unknown): value is CheckedArtifact {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CheckedArtifact>;
  if (
    candidate.schema !== ARTIFACT_SCHEMA ||
    candidate.version !== ARTIFACT_VERSION ||
    candidate.compilerVersion !== COLESLAW_COMPILER_VERSION ||
    candidate.uffdaApiVersion !== UFFDA_API_VERSION ||
    typeof candidate.sourcePath !== "string" ||
    typeof candidate.sourceSha256 !== "string" ||
    typeof candidate.dependencySha256 !== "object" ||
    candidate.dependencySha256 === null ||
    typeof candidate.syntax !== "object" || candidate.syntax === null
  ) return false;
  return Object.values(candidate.dependencySha256).every((value) =>
    typeof value === "string"
  );
}

async function readArtifact(path: string): Promise<
  | { readonly ok: true; readonly artifact: CheckedArtifact }
  | { readonly ok: false }
> {
  let value: unknown;
  try {
    value = JSON.parse(await Deno.readTextFile(path));
  } catch (error) {
    console.error(
      `cslw: unable to read checked artifact ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { ok: false };
  }
  if (!isCheckedArtifact(value)) {
    console.error(
      `cslw: checked artifact ${path} has an unsupported or invalid schema`,
    );
    return { ok: false };
  }
  return { ok: true, artifact: value };
}

function projectPath(path: string, project: ColeslawProject): string {
  if (isAbsolute(path)) {
    throw new Error(`Artifact path must be project-relative: ${path}`);
  }
  const target = resolve(project.root, path);
  const within = relative(project.root, target);
  if (within === ".." || within.startsWith("..")) {
    throw new Error(`Artifact path escapes the project root: ${path}`);
  }
  return target;
}

async function validateArtifact(
  path: string,
): Promise<ValidatedApplication | undefined> {
  const project = await findColeslawProject(resolve(Deno.cwd(), path));
  const loaded = await readArtifact(path);
  if (!loaded.ok) return undefined;
  const artifact = loaded.artifact;
  const sourcePath = projectPath(artifact.sourcePath, project);
  const source = await readSource(sourcePath);
  if (!source.ok) return undefined;
  const currentSourceHash = await hash(new TextEncoder().encode(source.text));
  if (currentSourceHash !== artifact.sourceSha256) {
    console.error(
      `cslw: checked artifact is stale; source changed: ${artifact.sourcePath}`,
    );
    return undefined;
  }
  for (
    const [dependency, expected] of Object.entries(
      artifact.dependencySha256,
    )
  ) {
    const file = await readSource(projectPath(dependency, project));
    if (!file.ok) return undefined;
    const actual = await hash(new TextEncoder().encode(file.text));
    if (actual !== expected) {
      console.error(
        `cslw: checked artifact is stale; dependency changed: ${dependency}`,
      );
      return undefined;
    }
  }
  return await loadValidated(sourcePath);
}

function getValue(
  object: Readonly<Record<string, unknown>>,
  path: readonly string[],
): unknown {
  let value: unknown = object;
  for (const segment of path) {
    if (typeof value !== "object" || value === null) return undefined;
    value = Reflect.get(value, segment);
  }
  return value;
}

function selectionArgumentValue(
  expression: UffdaExpressionNode,
  configBinding: string,
  values: Readonly<Record<string, unknown>>,
): unknown {
  const argument = compositionArgument(expression, configBinding, new Set());
  if (argument === undefined) return undefined;
  if (argument.kind === "literal") return argument.value;
  if (argument.kind === "setting") return getValue(values, argument.path);
  return undefined;
}

function selectedModeName(
  application: ValidatedApplication,
  name: string,
): RawModeDeclaration | undefined {
  const local = application.modes.get(name);
  if (local !== undefined) return local;
  const imported = application.imports.symbols.get(name);
  if (
    typeof imported === "object" && imported !== null &&
    Reflect.get(imported, "kind") === "mode"
  ) {
    return imported as RawModeDeclaration;
  }
  return undefined;
}

function reachableBindings(
  checked: ReturnType<typeof checkComposition> & { ok: true },
): Set<string> {
  const reached = new Set<string>();
  const byName = new Map(
    checked.checked.bindings.map((binding) => [binding.name, binding]),
  );
  const visit = (name: string): void => {
    if (reached.has(name)) return;
    reached.add(name);
    for (const dependency of checked.checked.dependencies.get(name) ?? []) {
      if (!dependency.startsWith("$setting:")) visit(dependency);
    }
  };
  for (const root of checked.checked.roots) visit(root.name);
  return new Set(
    [...reached].filter((name) => byName.has(name)),
  );
}

async function runApplication(
  application: ValidatedApplication,
  arguments_: readonly string[],
): Promise<void> {
  const program = application.program;
  const positionals = program.positionals.map((mapping) => ({
    index: mapping.index,
    path: mapping.setting.segments.slice(1),
  }));
  const environment: Record<string, string> = {};
  for (const setting of flattenSettings(application.config.settings)) {
    const value = Deno.env.get(environmentName(setting.path));
    if (value !== undefined) environment[environmentName(setting.path)] = value;
  }
  const config = prepareConfig(
    application.config.settings,
    positionals,
    { arguments: arguments_, environment },
    application.settingMatcher,
  );
  const selector = program.selector.segments.slice(1);
  const selected = await selectMode(config, selector, program.selections);
  if (!selected.ok) {
    printConfigDiagnostics(selected.diagnostics);
    throw new Error("Mode selection failed");
  }
  const declaration = selectedModeName(
    application,
    selected.selected.name.segments.join("."),
  );
  if (declaration === undefined) {
    throw new Error(
      `Selected mode ${
        selected.selected.name.segments.join(".")
      } is not a local or imported mode declaration`,
    );
  }
  const kind = modeKindName(declaration);
  const descriptor: HostModeDescriptor | undefined = kind in BUILTIN_MODES
    ? BUILTIN_MODES[kind]
    : application.imports.modeDescriptors.get(kind);
  if (descriptor === undefined) {
    throw new Error(`No mode descriptor is registered for ${kind}`);
  }

  const selection = program.selections.find((candidate) =>
    candidate.label === selected.selected.label
  );
  if (selection === undefined) {
    throw new Error("Selected mode mapping disappeared after validation");
  }
  const extraArguments: unknown[] = [];
  for (const expression of selection.arguments) {
    const value = selectionArgumentValue(
      expression,
      program.configBinding,
      selected.selected.settings,
    );
    if (value === undefined) {
      const argument = compositionArgument(
        expression,
        program.configBinding,
        new Set(),
      );
      if (argument?.kind !== "setting") {
        throw new Error(
          `Mode mapping ${
            JSON.stringify(selection.label)
          } has an unsupported argument`,
        );
      }
      const resolved = await config.resolve([argument.path]);
      if (resolved.diagnostics.length > 0) {
        printConfigDiagnostics(resolved.diagnostics);
        throw new Error("Mode argument resolution failed");
      }
      extraArguments.push(getValue(resolved.values, argument.path));
    } else {
      extraArguments.push(value);
    }
  }

  let modeToRun = declaration;
  let invocationArguments: readonly unknown[] = [];
  if (descriptor.entryPoint === "job") {
    const jobs = declaration.sections.flatMap((section) =>
      section.name === "jobs" ? section.bindings : []
    );
    const jobSelection = selectExactlyOneJob(
      jobs.map((job) => job.name),
      extraArguments[0] === undefined ? undefined : String(extraArguments[0]),
    );
    if (!jobSelection.ok) {
      printConfigDiagnostics(jobSelection.diagnostics);
      throw new Error("Job selection failed");
    }
    modeToRun = {
      ...declaration,
      sections: declaration.sections.map((section) =>
        section.name === "jobs"
          ? {
            ...section,
            bindings: section.bindings.filter((binding) =>
              binding.name === jobSelection.job
            ),
          }
          : section
      ),
    };
    invocationArguments = extraArguments.slice(1);
  } else if (descriptor.entryPoint === "controller") {
    invocationArguments = extraArguments;
  } else if (extraArguments.length > 0) {
    throw new Error(
      `Mode kind ${kind} does not accept mode-selection arguments`,
    );
  }

  const compositionProblems: ApplicationDiagnostic[] = [];
  const composition = modeComposition(
    modeToRun,
    application.componentDescriptors,
    program.configBinding,
    compositionProblems,
  );
  if (composition === undefined || compositionProblems.length > 0) {
    for (const diagnostic of compositionProblems) {
      printDiagnostic(diagnostic);
    }
    throw new Error("Selected mode composition is invalid");
  }
  const checked = checkComposition(
    composition,
    descriptor,
    application.componentDescriptors,
  );
  if (!checked.ok) {
    for (const problem of checked.problems) {
      console.error(`coleslaw: ${problem.code}: ${problem.message}`);
    }
    throw new Error("Selected mode composition is invalid");
  }

  const reached = reachableBindings(checked);
  const settingsToResolve = checked.checked.bindings.flatMap((binding) =>
    reached.has(binding.name)
      ? binding.arguments.flatMap((argument) =>
        argument.kind === "setting" ? [argument.path] : []
      )
      : []
  );
  const resolved = await config.resolve(settingsToResolve);
  if (resolved.diagnostics.length > 0) {
    printConfigDiagnostics(resolved.diagnostics);
    throw new Error("Reached component settings are invalid");
  }
  const started = await startComposition(checked.checked, {
    settingValue: (path) => getValue(resolved.values, path),
  });
  const secretValues = flattenSettings(application.config.settings)
    .filter((setting) => setting.secret)
    .map((setting) => getValue(resolved.values, setting.path))
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value))
    .filter((value) => value.length > 0)
    .toSorted((left, right) => right.length - left.length);
  let runFailure: unknown;
  try {
    await started.run(invocationArguments);
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    for (const value of secretValues) {
      message = message.replaceAll(value, "[redacted]");
    }
    runFailure = new Error(message, { cause: error });
  }
  try {
    await started.dispose();
  } catch (error) {
    if (runFailure !== undefined) {
      throw new AggregateError(
        [runFailure, error],
        "Mode run and cleanup failed",
      );
    }
    throw error;
  }
  if (runFailure !== undefined) throw runFailure;
}

function usage(): void {
  console.log(
    "Usage: cslw <parse|check|compile|run> <application.clsw> [settings...]\n" +
      "  parse    Print the syntax AST without loading host modules\n" +
      "  check    Resolve imports and validate composition without constructing resources\n" +
      "  compile  Write a versioned checked artifact with source provenance\n" +
      "  run      Select and execute the declared mode\n" +
      "Formatting is deferred; `fmt` is not implemented.",
  );
}

export async function executeCli(
  arguments_: readonly string[],
): Promise<number> {
  const [command, path, ...rest] = arguments_;
  if (command === undefined || command === "help" || command === "--help") {
    usage();
    return 0;
  }
  if (command === "fmt") {
    console.error("cslw: fmt is deferred and is not implemented");
    return 2;
  }
  if (!["parse", "check", "compile", "run"].includes(command)) {
    console.error(`cslw: unknown command ${command}`);
    usage();
    return 2;
  }
  if (path === undefined) {
    console.error(`cslw: ${command} requires an application path`);
    usage();
    return 2;
  }
  if (command !== "run" && rest.length > 0) {
    console.error(`cslw: unexpected argument ${rest[0]} for ${command}`);
    return 2;
  }
  try {
    if (command === "parse") {
      const file = await readSource(path);
      if (!file.ok) return 1;
      const sourceName = relative(Deno.cwd(), file.path);
      const parsed = await parseApplicationSource(file.text, sourceName);
      if (!parsed.ok) {
        printDiagnostic({
          code: "PARSE_FAILURE",
          message: parsed.failure.message,
          span: sourceSpan(sourceName, file.text, parsed.failure.offset),
        });
        return 1;
      }
      console.log(jsonForSyntax(parsed.syntax));
      return 0;
    }
    if (command === "run") {
      const application = extname(path) === ".clsw"
        ? await loadValidated(path)
        : await validateArtifact(path);
      if (application === undefined) return 1;
      await runApplication(application, rest);
      return 0;
    }
    const application = await loadValidated(path);
    if (application === undefined) return 1;
    if (command === "check") {
      console.log(
        `Checked ${
          relative(Deno.cwd(), application.sourcePath)
        }: ${application.modes.size} mode(s), program ${application.program.name}`,
      );
      return 0;
    }
    if (command === "compile") {
      await compileApplication(application);
      return 0;
    }
    return 2;
  } catch (error) {
    console.error(
      `cslw: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}
