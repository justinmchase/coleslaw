import { JsrPackages } from "@justinmchase/uffda";
import { isClean, type Match, MatchKind, valueOf } from "@justinmchase/uffda";
import { analyzeMatchFailure } from "@justinmchase/uffda";
import { type GrammarOptions, parseGrammar } from "@justinmchase/uffda/grammar";
import { parse as parseJsonc } from "@std/jsonc";
import { fromFileUrl, join, relative, resolve } from "@std/path";
import type { SettingMatcher } from "./config.ts";
import { sourceSpan } from "./diagnostics.ts";
import { createDomainExpressionRuntime } from "./domain-runtime.ts";
import {
  type ColeslawProject,
  findColeslawProject,
  projectPackages,
} from "./project.ts";
import type {
  RawAggregateCommandHandler,
  RawAggregateDeclaration,
  RawAggregateEventHandler,
  RawAggregateField,
  RawAggregateShape,
  RawConfigDeclaration,
  RawConfigMember,
  RawControllerDeclaration,
  RawManagerDeclaration,
  RawModeDeclaration,
  RawModeSelection,
  RawNamePath,
  RawProgramDeclaration,
  RawSyntaxDeclaration,
  RawSyntaxModule,
  SourceSpan,
} from "./syntax.ts";

const PACKAGE = "@justinmchase/uffda";
export const UFFDA_API_VERSION = "0.9.1";
const DEVELOPMENT_VERSION = UFFDA_API_VERSION;
const DEVELOPMENT_REGISTRY = new URL("https://coleslaw-dev.invalid/");

export type ApplicationSyntax = RawSyntaxModule;

export interface ParseFailure {
  readonly message: string;
  readonly offset: number;
}

export type ApplicationParse =
  | {
    readonly ok: true;
    readonly syntax: ApplicationSyntax;
    readonly settingMatcher: SettingMatcher;
  }
  | { readonly ok: false; readonly failure: ParseFailure };

class MissingSyntaxSpan extends Error {
  constructor(ruleName: string) {
    super(`Uffda parse tree did not retain a span for ${ruleName}`);
  }
}

class SpanCatalog {
  readonly #spans = new Map<string, SourceSpan[]>();
  readonly #indices = new Map<string, number>();

  add(ruleName: string, span: SourceSpan): void {
    const spans = this.#spans.get(ruleName) ?? [];
    spans.push(span);
    this.#spans.set(ruleName, spans);
  }

  take(ruleName: string): SourceSpan {
    const spans = this.#spans.get(ruleName) ?? [];
    const index = this.#indices.get(ruleName) ?? 0;
    const span = spans[index];
    if (span === undefined) throw new MissingSyntaxSpan(ruleName);
    this.#indices.set(ruleName, index + 1);
    return span;
  }

  takeNext(ruleNames: readonly string[]): SourceSpan {
    const next = ruleNames.flatMap((ruleName) => {
      const spans = this.#spans.get(ruleName) ?? [];
      const index = this.#indices.get(ruleName) ?? 0;
      const span = spans[index];
      return span === undefined ? [] : [{ ruleName, span }];
    }).toSorted((left, right) =>
      left.span.start.offset - right.span.start.offset
    )[0];
    if (next === undefined) throw new MissingSyntaxSpan("ExportDeclaration");
    return this.take(next.ruleName);
  }
}

type ParsedAggregateHandler =
  | Omit<RawAggregateCommandHandler, "span">
  | Omit<RawAggregateEventHandler, "span">;

interface ParsedAggregateState {
  readonly name: string;
  readonly handlers: readonly ParsedAggregateHandler[];
}

interface ParsedAggregateDeclaration extends
  Omit<
    RawAggregateDeclaration,
    "fields" | "commands" | "events" | "states"
  > {
  readonly fields: readonly Omit<RawAggregateField, "span">[];
  readonly commands: readonly Omit<RawAggregateShape, "span">[];
  readonly events: readonly Omit<RawAggregateShape, "span">[];
  readonly states: readonly ParsedAggregateState[];
}

function fromHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function digest(bytes: Uint8Array): Promise<string> {
  const buffer = new Uint8Array(bytes).buffer;
  return fromHex(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)));
}

function localUffdaRoot(): string | undefined {
  const configured = Deno.env.get("COLESLAW_UFFDA_ROOT");
  if (configured !== undefined) {
    return resolve(Deno.cwd(), configured);
  }
  return undefined;
}

async function readPackageFiles(
  root: string,
): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  const projectBytes = await Deno.readFile(join(root, "uffda.jsonc"));
  files.set("uffda.jsonc", projectBytes);
  const projectValue: unknown = parseJsonc(
    new TextDecoder().decode(projectBytes),
  );
  if (
    typeof projectValue !== "object" || projectValue === null ||
    Array.isArray(projectValue)
  ) {
    throw new Error("Uffda project file must contain an object");
  }
  const configuredOutDir = Reflect.get(projectValue, "outDir") ?? "./bin";
  if (
    typeof configuredOutDir !== "string" ||
    !configuredOutDir.startsWith("./")
  ) {
    throw new Error("Uffda project outDir must be project-relative");
  }
  const outDir = resolve(root, configuredOutDir);
  const relativeOutDir = relative(root, outDir);
  if (
    relativeOutDir === ".." || relativeOutDir.startsWith("../") ||
    relativeOutDir.startsWith("..\\")
  ) {
    throw new Error("Uffda project outDir escapes its root");
  }
  const collect = async (folder: string): Promise<void> => {
    const directory = join(root, folder);
    for await (const entry of Deno.readDir(directory)) {
      const relativePath = `${folder}${entry.name}`;
      if (entry.isDirectory) {
        await collect(`${relativePath}/`);
      } else if (entry.isFile) {
        files.set(
          relativePath,
          await Deno.readFile(join(root, relativePath)),
        );
      }
    }
  };
  await collect(`${relativeOutDir.replaceAll("\\", "/")}/`);
  return files;
}

async function developmentFetch(
  files: ReadonlyMap<string, Uint8Array>,
): Promise<(url: URL) => Promise<Response>> {
  const manifest: Record<string, { size: number; checksum: string }> = {};
  for (const [path, bytes] of files) {
    manifest[`/${path}`] = {
      size: bytes.length,
      checksum: `sha256-${await digest(bytes)}`,
    };
  }
  const served = new Map<string, Uint8Array>();
  served.set(
    `${PACKAGE}/meta.json`,
    new TextEncoder().encode(JSON.stringify({
      scope: "justinmchase",
      name: "uffda",
      versions: { [DEVELOPMENT_VERSION]: {} },
    })),
  );
  served.set(
    `${PACKAGE}/${DEVELOPMENT_VERSION}_meta.json`,
    new TextEncoder().encode(JSON.stringify({ manifest })),
  );
  for (const [path, bytes] of files) {
    served.set(`${PACKAGE}/${DEVELOPMENT_VERSION}/${path}`, bytes);
  }
  return (url) => {
    const path = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const bytes = served.get(path);
    return Promise.resolve(
      bytes
        ? new Response(new Uint8Array(bytes).buffer)
        : new Response("not found", { status: 404 }),
    );
  };
}

async function createDevelopmentPackages(
  project: ColeslawProject,
): Promise<JsrPackages> {
  const root = localUffdaRoot();
  if (root === undefined) {
    throw new Error(
      `Uffda ${UFFDA_API_VERSION} with the Coleslaw grammar/runtime exports is not published yet; set COLESLAW_UFFDA_ROOT to a compatible checkout`,
    );
  }
  let files: Map<string, Uint8Array>;
  try {
    files = await readPackageFiles(root);
  } catch (error) {
    throw new Error(
      `Unable to read Uffda prerequisite checkout at ${root}: ${
        error instanceof Error ? error.message : String(error)
      }; use commit 503ee800e610862d390fd1caaf85f7533214b780 and run "deno task compile:lang" there`,
      { cause: error },
    );
  }
  const fetch = await developmentFetch(files);
  return projectPackages(project, {
    registry: DEVELOPMENT_REGISTRY,
    fetch,
  });
}

function collectSpans(
  matchResult: Match,
  sourceName: string,
  source: string,
  spans: SpanCatalog,
): void {
  if (
    matchResult.kind === MatchKind.Ok ||
    matchResult.kind === MatchKind.Skip
  ) {
    const ruleName = matchResult.origin?.rule.name;
    if (ruleName !== undefined) {
      spans.add(
        ruleName,
        sourceSpan(
          sourceName,
          source,
          matchResult.originalSpan.start,
          matchResult.originalSpan.end,
        ),
      );
    }
    for (const child of matchResult.matches) {
      collectSpans(child, sourceName, source, spans);
    }
  } else if (matchResult.kind === MatchKind.Fail) {
    for (const child of matchResult.matches) {
      collectSpans(child, sourceName, source, spans);
    }
  }
}

function withSpan<T extends object>(
  value: T,
  spans: SpanCatalog,
  ruleName: string,
): T & { readonly span: SourceSpan } {
  return { ...value, span: spans.take(ruleName) };
}

function namePath(
  value: RawNamePath,
  spans: SpanCatalog,
): RawNamePath & { readonly span: SourceSpan } {
  return withSpan(value, spans, "NamePath");
}

function configMember(
  value: RawConfigMember,
  spans: SpanCatalog,
): RawConfigMember & { readonly span: SourceSpan } {
  if (value.kind === "group") {
    return {
      ...withSpan(value, spans, "SettingGroup"),
      settings: value.settings.map((child) => configMember(child, spans)),
    };
  }
  return withSpan(value, spans, "Setting");
}

function configDeclaration(
  value: RawConfigDeclaration,
  spans: SpanCatalog,
): RawConfigDeclaration & { readonly span: SourceSpan } {
  return {
    ...withSpan(value, spans, "ConfigDeclaration"),
    settings: value.settings.map((member) => configMember(member, spans)),
  };
}

function modeSelection(
  value: RawModeSelection,
  spans: SpanCatalog,
): RawModeSelection & { readonly span: SourceSpan } {
  return {
    ...withSpan(value, spans, "ModeSelection"),
    mode: namePath(value.mode, spans),
  };
}

function modeDeclaration(
  value: RawModeDeclaration,
  spans: SpanCatalog,
): RawModeDeclaration & { readonly span: SourceSpan } {
  return {
    ...withSpan(value, spans, "ModeDeclaration"),
    modeKind: typeof value.modeKind === "string"
      ? value.modeKind
      : namePath(value.modeKind, spans),
    sections: value.sections.map((section) => ({
      ...withSpan(section, spans, "CompositionSection"),
      bindings: section.bindings.map((binding) => ({
        ...withSpan(binding, spans, "ComponentBinding"),
        component: namePath(binding.component, spans),
      })),
    })),
  };
}

function programDeclaration(
  value: RawProgramDeclaration,
  spans: SpanCatalog,
): RawProgramDeclaration & { readonly span: SourceSpan } {
  return {
    ...withSpan(value, spans, "ProgramDeclaration"),
    config: namePath(value.config, spans),
    selector: namePath(value.selector, spans),
    positionals: value.positionals.map((mapping) => ({
      ...withSpan(mapping, spans, "PositionalBinding"),
      setting: namePath(mapping.setting, spans),
    })),
    selections: value.selections.map((selection) =>
      modeSelection(selection, spans)
    ),
  };
}

function aggregateDeclaration(
  value: ParsedAggregateDeclaration,
  spans: SpanCatalog,
): RawAggregateDeclaration & { readonly span: SourceSpan } {
  const fields = value.fields.map((field, index) =>
    withSpan(
      field,
      spans,
      index === 0 ? "AggregateIdentity" : "AggregateField",
    )
  );
  const commands = value.commands.map((command) =>
    withSpan(command, spans, "AggregateCommand")
  );
  const events = value.events.map((event) =>
    withSpan(event, spans, "AggregateEvent")
  );
  const states = value.states.map((state) => {
    const commandHandlers = state.handlers.filter((handler) =>
      "decision" in handler
    );
    const eventHandlers = state.handlers.filter((handler) =>
      "event" in handler
    );
    return {
      ...withSpan(state, spans, "AggregateState"),
      commands: commandHandlers.map((handler) => {
        const decisionRule = handler.decision.kind === "emit"
          ? "AggregateCommandEvent"
          : "AggregateCommandReject";
        return {
          ...withSpan(handler, spans, decisionRule),
          decision: handler.decision.kind === "emit"
            ? {
              ...handler.decision,
              events: handler.decision.events.map((event) =>
                withSpan(event, spans, "AggregateEmittedEvent")
              ),
            }
            : handler.decision,
        };
      }),
      events: eventHandlers.map((handler) => ({
        ...withSpan(handler, spans, "AggregateEventHandler"),
        set: handler.set.map((assignment) =>
          withSpan(assignment, spans, "AggregateSetField")
        ),
      })),
    };
  });
  return {
    ...withSpan(value, spans, "AggregateDeclaration"),
    fields,
    commands,
    events,
    states,
  };
}

function managerDeclaration(
  value: RawManagerDeclaration,
  spans: SpanCatalog,
): RawManagerDeclaration & { readonly span: SourceSpan } {
  return {
    ...withSpan(value, spans, "ManagerDeclaration"),
    operations: value.operations.map((operation) => ({
      ...withSpan(operation, spans, "ManagerOperation"),
    })),
  };
}

function controllerDeclaration(
  value: RawControllerDeclaration,
  spans: SpanCatalog,
): RawControllerDeclaration & { readonly span: SourceSpan } {
  return {
    ...withSpan(value, spans, "ControllerDeclaration"),
    routes: value.routes.map((route) => ({
      ...withSpan(route, spans, "ControllerRoute"),
      operation: withSpan(route.operation, spans, "DomainNamePath"),
      requestShapes: route.requestShapes.map((shape) => ({
        ...withSpan(shape, spans, "ControllerRequestShape"),
      })),
    })),
  };
}

function syntaxWithSpans(
  value: RawSyntaxModule,
  sourceName: string,
  spans: SpanCatalog,
): RawSyntaxModule {
  const declarations: RawSyntaxDeclaration[] = [];
  for (let index = 0; index < value.declarations.length; index++) {
    const declaration = value.declarations[index];
    switch (declaration.kind) {
      case "import":
        declarations.push(
          withSpan(declaration, spans, "ImportDeclarationSyntax"),
        );
        break;
      case "export": {
        declarations.push({
          ...declaration,
          span: spans.takeNext([
            "ExportName",
            "ExportedConfig",
            "ExportedMode",
            "ExportedProgram",
            "ExportedContext",
            "ExportedAggregate",
            "ExportedManager",
            "ExportedController",
          ]),
        });
        break;
      }
      case "config":
        declarations.push(configDeclaration(declaration, spans));
        break;
      case "mode":
        declarations.push(modeDeclaration(declaration, spans));
        break;
      case "program":
        declarations.push(programDeclaration(declaration, spans));
        break;
      case "context":
        declarations.push({
          ...withSpan(declaration, spans, "ContextDeclaration"),
          members: declaration.members.map((member) => ({
            ...withSpan(member, spans, "ContextMember"),
          })),
        });
        break;
      case "aggregate":
        declarations.push(
          aggregateDeclaration(
            declaration as unknown as ParsedAggregateDeclaration,
            spans,
          ),
        );
        break;
      case "manager":
        declarations.push(managerDeclaration(declaration, spans));
        break;
      case "controller":
        declarations.push(controllerDeclaration(declaration, spans));
        break;
    }
  }
  return {
    ...withSpan(value, spans, "ModuleBody"),
    source: sourceName,
    declarations,
  };
}

function grammarOptions(
  packages: JsrPackages,
  project: ColeslawProject,
  languageProject: ColeslawProject,
): GrammarOptions {
  return {
    resolverOptions: {
      imports: project.imports,
      packages,
      artifacts: { root: languageProject.root, outDir: languageProject.outDir },
    },
  };
}

export async function parseApplicationSource(
  source: string,
  sourceName = "app.clsw",
  suppliedProject?: ColeslawProject,
): Promise<ApplicationParse> {
  const project = suppliedProject ??
    await findColeslawProject(resolve(Deno.cwd(), sourceName));
  const uffdaSpecifier = project.imports.get(PACKAGE);
  if (uffdaSpecifier === undefined) {
    throw new Error(
      `clsw.jsonc must map ${PACKAGE} to Uffda ${UFFDA_API_VERSION}`,
    );
  }
  if (
    !new RegExp(
      `^jsr:${PACKAGE.replaceAll("/", "\\/")}@(?:\\^|~)?${
        UFFDA_API_VERSION.replaceAll(".", "\\.")
      }$`,
    ).test(uffdaSpecifier)
  ) {
    throw new Error(
      `clsw.jsonc maps ${PACKAGE} to ${uffdaSpecifier}; expected Uffda ${UFFDA_API_VERSION}`,
    );
  }
  const packages = await createDevelopmentPackages(project);
  const grammarUrl = new URL("./grammar/application.uff", import.meta.url);
  const languageProject = await findColeslawProject(fromFileUrl(grammarUrl));
  const result: Match<ApplicationSyntax> = await parseGrammar({
    source,
    moduleUrl: grammarUrl,
    entryRuleName: "ColeslawLang",
    grammarOptions: grammarOptions(packages, project, languageProject),
  });
  if (isClean(result) && result.kind === MatchKind.Ok) {
    const syntax = valueOf(result);
    if (syntax?.kind === "module" && Array.isArray(syntax.declarations)) {
      const spans = new SpanCatalog();
      collectSpans(result, sourceName, source, spans);
      let locatedSyntax: ApplicationSyntax;
      try {
        locatedSyntax = syntaxWithSpans(syntax, sourceName, spans);
      } catch (error) {
        if (error instanceof MissingSyntaxSpan) {
          return {
            ok: false,
            failure: { message: error.message, offset: 0 },
          };
        }
        throw error;
      }
      const domainRuntime = createDomainExpressionRuntime();
      return {
        ok: true,
        syntax: locatedSyntax,
        settingMatcher: {
          async match(pattern, input) {
            const matched = await domainRuntime.match(pattern, input);
            if (matched.matched) {
              return { matched: true, value: matched.value };
            }
            return {
              matched: false,
              expected: `a value matching the ${pattern.kind} pattern`,
            };
          },
        },
      };
    }
  }
  const analysis = result.kind === MatchKind.Fail
    ? await analyzeMatchFailure(result)
    : undefined;
  const offset = analysis && analysis.sourceOffset >= 0
    ? analysis.sourceOffset
    : "originalSpan" in result &&
        typeof result.originalSpan.start === "number"
    ? result.originalSpan.start
    : source.length;
  const detail = "message" in result && typeof result.message === "string"
    ? result.message
    : analysis
    ? analysis.explanation ??
      `Expected ${analysis.expected.join(", ")}${
        analysis.rules.length > 0 ? ` in ${analysis.rules.join(" > ")}` : ""
      }`
    : "Input does not match the Coleslaw application grammar";
  return {
    ok: false,
    failure: {
      message: `${sourceName}: ${detail}`,
      offset,
    },
  };
}
