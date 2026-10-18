import { assertEquals, assertStringIncludes } from "@std/assert";
import { PatternKind } from "@justinmchase/uffda/pattern";
import {
  environmentName,
  flagName,
  prepareConfig,
  type SettingMatcher,
} from "../src/config.ts";
import type { ConfigMember } from "../src/syntax.ts";

function setting(
  name: string,
  pattern: string,
  secret = false,
): ConfigMember {
  return {
    kind: "setting",
    name,
    pattern: { kind: PatternKind.RegExp, pattern: new RegExp(pattern) },
    secret,
    span: {
      source: "app.clsw",
      start: { offset: 0, line: 0, column: 0 },
      end: { offset: 1, line: 0, column: 1 },
    },
  };
}

const matcher: SettingMatcher = {
  match(pattern, input) {
    if (
      pattern.kind === PatternKind.RegExp &&
      pattern.pattern.source === "required-string"
    ) {
      return Promise.resolve(
        typeof input === "string"
          ? { matched: true, value: input }
          : { matched: false, expected: "a non-empty string" },
      );
    }
    if (
      pattern.kind === PatternKind.RegExp && pattern.pattern.source === "number"
    ) {
      const value = input === undefined ? undefined : Number(input);
      return Promise.resolve(
        value !== undefined && Number.isFinite(value)
          ? { matched: true, value }
          : { matched: false, expected: "a number" },
      );
    }
    if (
      pattern.kind === PatternKind.RegExp &&
      pattern.pattern.source === "default-api"
    ) {
      return Promise.resolve({ matched: true, value: input ?? "api" });
    }
    return Promise.resolve({ matched: true, value: input });
  },
};

Deno.test(
  "req:application-shell-003 nested settings map to flag and environment names",
  async () => {
    assertEquals(
      flagName(["database", "connectionUrl"]),
      "--database.connection-url",
    );
    assertEquals(
      environmentName(["database", "connectionUrl"]),
      "DATABASE__CONNECTION_URL",
    );
    const config = prepareConfig(
      [{
        kind: "group",
        name: "database",
        settings: [setting("connectionUrl", "required-string")],
        span: {
          source: "app.clsw",
          start: { offset: 0, line: 0, column: 0 },
          end: { offset: 1, line: 0, column: 1 },
        },
      }],
      [],
      {
        arguments: ["--database.connection-url", "postgres://localhost/app"],
        environment: {},
      },
      matcher,
    );
    assertEquals(await config.resolve([["database", "connectionUrl"]]), {
      values: { database: { connectionUrl: "postgres://localhost/app" } },
      diagnostics: [],
    });
  },
);

Deno.test(
  "req:application-shell-003 named settings precede positional, environment, and defaults",
  async () => {
    const members = [
      setting("mode", "required-string"),
      {
        kind: "group" as const,
        name: "job",
        settings: [setting("jobName", "required-string")],
        span: {
          source: "app.clsw",
          start: { offset: 0, line: 0, column: 0 },
          end: { offset: 1, line: 0, column: 1 },
        },
      },
      setting("limit", "number"),
      setting("defaultMode", "default-api"),
    ];
    const config = prepareConfig(members, [
      { index: 0, path: ["mode"] },
      { index: 1, path: ["job", "jobName"] },
    ], {
      arguments: [
        "positional-mode",
        "positional-job",
        "--mode",
        "named-mode",
        "--limit=4",
      ],
      environment: {
        MODE: "environment-mode",
        JOB__JOB_NAME: "environment-job",
      },
    }, matcher);
    const result = await config.resolve([
      ["mode"],
      ["job", "jobName"],
      ["limit"],
      ["defaultMode"],
    ]);
    assertEquals(result, {
      values: {
        mode: "named-mode",
        job: { jobName: "positional-job" },
        limit: 4,
        defaultMode: "api",
      },
      diagnostics: [],
    });
  },
);

Deno.test(
  "req:application-shell-003 validates only requested settings and redacts secret failures",
  async () => {
    const config = prepareConfig(
      [
        setting("mode", "required-string"),
        setting("unusedCredential", "required-string"),
        setting("apiSecret", "required-string", true),
      ],
      [],
      {
        arguments: ["--api-secret", "do-not-leak", "--unused-credential", ""],
        environment: {},
      },
      {
        async match(pattern) {
          if (
            pattern.kind === PatternKind.RegExp &&
            pattern.pattern.source === "required-string"
          ) {
            return { matched: false, expected: "a non-empty string" };
          }
          return await matcher.match(pattern, undefined);
        },
      },
    );
    const result = await config.resolve([["mode"], ["apiSecret"]]);
    assertEquals(result.diagnostics.length, 2);
    assertEquals(
      result.diagnostics.map((diagnostic) => diagnostic.path),
      ["mode", "apiSecret"],
    );
    const text = JSON.stringify(result.diagnostics);
    assertStringIncludes(text, "a non-empty string");
    assertEquals(text.includes("do-not-leak"), false);
    assertEquals(text.includes("unusedCredential"), false);
  },
);

Deno.test(
  "req:application-shell-003 rejects unknown flags and extra positionals",
  async () => {
    const config = prepareConfig([setting("mode", "required-string")], [{
      index: 0,
      path: ["mode"],
    }], {
      arguments: ["api", "extra", "--unknown", "value"],
      environment: {},
    }, matcher);
    const result = await config.resolve([["mode"]]);
    assertEquals(
      result.diagnostics.map((diagnostic) => diagnostic.code),
      ["UNKNOWN_SETTING", "EXTRA_POSITIONAL"],
    );
  },
);
