import { assertEquals } from "@std/assert";
import { PatternKind } from "@justinmchase/uffda/pattern";
import { prepareConfig, type SettingMatcher } from "../src/config.ts";
import {
  selectExactlyOneJob,
  selectMode,
  validateModeSelections,
} from "../src/selection.ts";
import type { ConfigMember, ModeSelection } from "../src/syntax.ts";

const span = {
  source: "app.clsw",
  start: { offset: 0, line: 0, column: 0 },
  end: { offset: 1, line: 0, column: 1 },
};

const configMembers: ConfigMember[] = [{
  kind: "setting",
  name: "mode",
  pattern: {
    kind: PatternKind.RegExp,
    pattern: /string-with-default-api/,
  },
  secret: false,
  span,
}];

const matcher: SettingMatcher = {
  match(pattern, input) {
    if (
      pattern.kind === PatternKind.RegExp &&
      pattern.pattern.source === "string-with-default-api"
    ) {
      return Promise.resolve({ matched: true, value: input ?? "api" });
    }
    return Promise.resolve({ matched: false, expected: "string" });
  },
};

const selections: ModeSelection[] = [
  {
    kind: "selection",
    label: "api",
    mode: { segments: ["PublicApi"], span },
    arguments: [],
    span,
  },
  {
    kind: "selection",
    label: "job",
    mode: { segments: ["Jobs"], span },
    arguments: [{
      kind: "reference",
      path: { segments: ["jobName"], span },
      span,
    }],
    span,
  },
];

Deno.test(
  "req:application-shell-004 mode labels select references independently of declaration names",
  async () => {
    const config = prepareConfig(configMembers, [], {
      arguments: ["--mode=job"],
      environment: {},
    }, matcher);
    const result = await selectMode(config, ["mode"], selections);
    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.selected.label, "job");
      assertEquals(result.selected.name.segments, ["Jobs"]);
      assertEquals(result.selected.arguments.length, 1);
    }
  },
);

Deno.test(
  "req:application-shell-004 selector patterns provide defaults and unknown labels fail",
  async () => {
    const config = prepareConfig(configMembers, [], {
      arguments: [],
      environment: {},
    }, matcher);
    const defaultResult = await selectMode(config, ["mode"], selections);
    assertEquals(defaultResult.ok, true);
    if (defaultResult.ok) {
      assertEquals(defaultResult.selected.label, "api");
    }

    const unknownConfig = prepareConfig(configMembers, [], {
      arguments: ["--mode=worker"],
      environment: {},
    }, matcher);
    const unknown = await selectMode(unknownConfig, ["mode"], selections);
    assertEquals(unknown.ok, false);
    if (!unknown.ok) {
      assertEquals(unknown.diagnostics[0].code, "UNKNOWN_MODE_LABEL");
      assertEquals(unknown.diagnostics[0].message.includes("worker"), false);
      assertEquals(unknown.diagnostics[0].message.includes("api"), true);
    }
  },
);

Deno.test(
  "req:application-shell-004 duplicate labels and invalid selector shapes are diagnosed",
  async () => {
    const duplicate = validateModeSelections([
      selections[0],
      { ...selections[1], label: "api" },
    ]);
    assertEquals(duplicate[0].code, "DUPLICATE_MODE_LABEL");

    const invalidMatcher: SettingMatcher = {
      match: () => Promise.resolve({ matched: true, value: 3 }),
    };
    const config = prepareConfig(configMembers, [], {
      arguments: [],
      environment: {},
    }, invalidMatcher);
    const result = await selectMode(config, ["mode"], selections);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.diagnostics[0].code, "INVALID_MODE_SELECTOR");
    }
  },
);

Deno.test(
  "req:application-shell-004 exactly one Job is selected",
  () => {
    assertEquals(selectExactlyOneJob(["ImportCatalog"]), {
      ok: true,
      job: "ImportCatalog",
    });
    assertEquals(selectExactlyOneJob(["ImportCatalog", "RebuildSearch"]), {
      ok: false,
      diagnostics: [{
        code: "MISSING_JOB",
        message: 'Select one job: "ImportCatalog", "RebuildSearch"',
      }],
    });
    assertEquals(
      selectExactlyOneJob(
        ["ImportCatalog", "RebuildSearch"],
        "RebuildSearch",
      ),
      { ok: true, job: "RebuildSearch" },
    );
    const unknown = selectExactlyOneJob(
      ["ImportCatalog", "RebuildSearch"],
      "DeleteEverything",
    );
    assertEquals(unknown.ok, false);
    if (!unknown.ok) {
      assertEquals(unknown.diagnostics[0].code, "UNKNOWN_JOB");
      assertEquals(
        unknown.diagnostics[0].message.includes("ImportCatalog"),
        true,
      );
    }
  },
);
