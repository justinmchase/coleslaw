import type { ConfigMember, UffdaPatternNode } from "./syntax.ts";

export interface SettingShape {
  readonly path: readonly string[];
  readonly pattern: UffdaPatternNode;
  readonly secret: boolean;
}

export interface PositionalSetting {
  readonly index: number;
  readonly path: readonly string[];
}

export interface ConfigInput {
  readonly arguments: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
}

export interface SettingMatch {
  readonly matched: boolean;
  readonly value?: unknown;
  readonly expected?: string;
}

export interface SettingMatcher {
  match(
    pattern: UffdaPatternNode,
    input: string | undefined,
  ): Promise<SettingMatch>;
}

export interface ConfigDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly source?:
    | "command line"
    | "positional argument"
    | "environment"
    | "default";
}

export interface ResolvedConfig {
  readonly values: Readonly<Record<string, unknown>>;
  readonly diagnostics: readonly ConfigDiagnostic[];
}

export interface PreparedConfig {
  readonly resolve: (paths: readonly (readonly string[])[]) => Promise<
    ResolvedConfig
  >;
  readonly positionals: readonly string[];
  readonly knownPaths: ReadonlySet<string>;
}

function pathKey(path: readonly string[]): string {
  return path.join(".");
}

function writePath(
  target: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): void {
  let cursor = target;
  for (const segment of path.slice(0, -1)) {
    const existing = cursor[segment];
    if (!isObjectRecord(existing)) {
      const nested: Record<string, unknown> = {};
      cursor[segment] = nested;
      cursor = nested;
    } else {
      cursor = existing;
    }
  }
  const leaf = path.at(-1);
  if (leaf !== undefined) cursor[leaf] = value;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function kebabCase(segment: string): string {
  return segment.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function snakeCase(segment: string): string {
  return segment.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
}

export function flagName(path: readonly string[]): string {
  return `--${path.map(kebabCase).join(".")}`;
}

export function environmentName(path: readonly string[]): string {
  return path.map(snakeCase).join("__");
}

export function flattenSettings(
  members: readonly ConfigMember[],
  prefix: readonly string[] = [],
): SettingShape[] {
  const flattened: SettingShape[] = [];
  for (const member of members) {
    const path = [...prefix, member.name];
    if (member.kind === "setting") {
      flattened.push({
        path,
        pattern: member.pattern,
        secret: member.secret,
      });
    } else {
      flattened.push(...flattenSettings(member.settings, path));
    }
  }
  return flattened;
}

function parseArguments(
  args: readonly string[],
  positionals: readonly PositionalSetting[],
  knownPaths: ReadonlySet<string>,
): {
  named: Map<string, string>;
  positional: Map<string, string>;
  rest: string[];
  diagnostics: ConfigDiagnostic[];
} {
  const named = new Map<string, string>();
  const positional = new Map<string, string>();
  const rest: string[] = [];
  const diagnostics: ConfigDiagnostic[] = [];
  let positionalOnly = false;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!positionalOnly && argument === "--") {
      positionalOnly = true;
      continue;
    }
    if (positionalOnly || !argument.startsWith("--")) {
      rest.push(argument);
      continue;
    }

    const equals = argument.indexOf("=");
    const flag = equals < 0 ? argument : argument.slice(0, equals);
    const supplied = equals < 0 ? undefined : argument.slice(equals + 1);
    const path = knownPathForFlag(flag, knownPaths);
    if (!path) {
      diagnostics.push({
        code: "UNKNOWN_SETTING",
        message: `Unknown setting flag ${flag}`,
        source: "command line",
      });
      continue;
    }
    const key = pathKey(path);
    if (named.has(key)) {
      diagnostics.push({
        code: "DUPLICATE_SETTING",
        message: `Setting ${key} was supplied more than once`,
        path: key,
        source: "command line",
      });
      continue;
    }
    if (supplied !== undefined) {
      named.set(key, supplied);
    } else {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        diagnostics.push({
          code: "MISSING_SETTING_VALUE",
          message: `Expected a value after ${flag}`,
          path: key,
          source: "command line",
        });
      } else {
        named.set(key, value);
        index++;
      }
    }
  }

  const ordered = positionals.toSorted((a, b) => a.index - b.index);
  const maxIndex = ordered.at(-1)?.index ?? -1;
  if (rest.length > maxIndex + 1) {
    diagnostics.push({
      code: "EXTRA_POSITIONAL",
      message: `Received ${
        rest.length - maxIndex - 1
      } extra positional argument(s)`,
      source: "positional argument",
    });
  }
  const mappedIndices = new Set<number>();
  for (const mapping of ordered) {
    if (
      !Number.isSafeInteger(mapping.index) || mapping.index < 0 ||
      mappedIndices.has(mapping.index)
    ) {
      diagnostics.push({
        code: "INVALID_POSITIONAL_MAPPING",
        message: `Invalid or duplicate positional index ${mapping.index}`,
      });
      continue;
    }
    mappedIndices.add(mapping.index);
    const value = rest[mapping.index];
    if (value !== undefined) positional.set(pathKey(mapping.path), value);
  }
  for (let index = 0; index < Math.min(rest.length, maxIndex + 1); index++) {
    if (!mappedIndices.has(index)) {
      diagnostics.push({
        code: "UNMAPPED_POSITIONAL",
        message: `Positional argument ${index + 1} has no declared setting`,
        source: "positional argument",
      });
    }
  }
  return { named, positional, rest, diagnostics };
}

function knownPathForFlag(
  flag: string,
  knownPaths: ReadonlySet<string>,
): readonly string[] | undefined {
  for (const key of knownPaths) {
    const path = key.split(".");
    if (flagName(path) === flag) return path;
  }
  return undefined;
}

export function prepareConfig(
  members: readonly ConfigMember[],
  positionals: readonly PositionalSetting[],
  input: ConfigInput,
  matcher: SettingMatcher,
): PreparedConfig {
  const settings = flattenSettings(members);
  const settingsByPath = new Map(
    settings.map((setting) => [pathKey(setting.path), setting]),
  );
  const knownPaths = new Set(settingsByPath.keys());
  const parsed = parseArguments(input.arguments, positionals, knownPaths);
  const cached = new Map<string, unknown>();

  return {
    positionals: parsed.rest,
    knownPaths,
    async resolve(paths) {
      const values: Record<string, unknown> = {};
      const diagnostics = parsed.diagnostics.slice();
      for (const path of paths) {
        const key = pathKey(path);
        if (cached.has(key)) {
          writePath(values, path, cached.get(key));
          continue;
        }
        const setting = settingsByPath.get(key);
        if (!setting) {
          diagnostics.push({
            code: "UNKNOWN_SETTING",
            message: `No setting named ${key}`,
            path: key,
          });
          continue;
        }

        const environmentValue = input.environment[environmentName(path)];
        const namedValue = parsed.named.get(key);
        const positionalValue = parsed.positional.get(key);
        const raw = namedValue ?? positionalValue ?? environmentValue;
        const source: ConfigDiagnostic["source"] = namedValue !== undefined
          ? "command line"
          : positionalValue !== undefined
          ? "positional argument"
          : environmentValue !== undefined
          ? "environment"
          : "default";
        try {
          const result = await matcher.match(setting.pattern, raw);
          if (!result.matched) {
            diagnostics.push({
              code: "INVALID_SETTING",
              message: result.expected
                ? `Expected ${result.expected}`
                : "Value did not match its declared pattern",
              path: key,
              source,
            });
            continue;
          }
          cached.set(key, result.value);
          writePath(values, path, result.value);
        } catch (error) {
          diagnostics.push({
            code: "SETTING_MATCH_FAILURE",
            message: setting.secret
              ? "Unable to parse secret setting"
              : `Unable to parse setting: ${
                error instanceof Error ? error.message : String(error)
              }`,
            path: key,
            source,
          });
        }
      }
      return { values, diagnostics };
    },
  };
}
