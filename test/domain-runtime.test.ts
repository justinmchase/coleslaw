import { assertEquals, assertRejects } from "@std/assert";
import { isClean, MatchKind, unwrap, valueOf } from "@justinmchase/uffda";
import { ExpressionKind } from "@justinmchase/uffda/expression";
import { expressionGrammar } from "@justinmchase/uffda/expression";
import type { Expression, Pattern } from "@justinmchase/uffda/runtime";
import { PatternKind } from "@justinmchase/uffda/pattern";
import {
  createDomainExpressionRuntime,
  validateDeclarativeDomain,
} from "../src/domain-runtime.ts";
import { shapeDefinitionsFromDeclarations } from "../src/shapes.ts";
import { executeCli } from "../src/cli.ts";
import { parseApplicationSource } from "../src/uffda.ts";

async function parseExpression(source: string): Promise<Expression> {
  const result = await expressionGrammar(source);
  if (!isClean(result) || result.kind !== MatchKind.Ok) {
    throw new Error(`Unable to parse expression: ${source}`);
  }
  return unwrap(valueOf(result)) as Expression;
}

Deno.test(
  "req:application-shell-001 named shapes reuse Uffda pattern behavior",
  async () => {
    const parsed = await parseApplicationSource(
      `shape Identifier = (string);
config Settings { id: (Identifier); }`,
      "named-shape.clsw",
    );
    if (!parsed.ok) throw new Error(parsed.failure.message);
    const shapes = shapeDefinitionsFromDeclarations(
      parsed.syntax.declarations,
    );
    const config = parsed.syntax.declarations.find((declaration) =>
      declaration.kind === "config"
    );
    if (config?.kind !== "config" || config.settings[0].kind !== "setting") {
      throw new Error("Test config setting was not parsed");
    }
    const runtime = createDomainExpressionRuntime(shapes);
    assertEquals(
      (await runtime.match(config.settings[0].pattern, "counter-1")).matched,
      true,
    );
    assertEquals(
      (await runtime.match(config.settings[0].pattern, 42)).matched,
      false,
    );
  },
);

Deno.test(
  "req:application-shell-010 domain expressions use an explicit pure core scope",
  async () => {
    const runtime = createDomainExpressionRuntime();
    const evaluate = async (source: string) =>
      await runtime.evaluate(await parseExpression(source), {});

    assertEquals(await evaluate("(add 1 2)"), 3);
    assertEquals(await evaluate("(coalesce null 5)"), 5);
    assertEquals(await evaluate("(eq 1 1)"), true);
    assertEquals(await evaluate("(deep 1 1)"), true);
    const equalData = await parseExpression("(deep left right)");
    const sameIdentity = await parseExpression("(eq left right)");
    const left = {
      list: [1, 2],
      map: new Map([["a", 1], ["b", 2]]),
      set: new Set(["a", "b"]),
      timestamp: new Date("2026-01-02T03:04:05.000Z"),
    };
    const right = {
      timestamp: new Date("2026-01-02T03:04:05.000Z"),
      set: new Set(["b", "a"]),
      map: new Map([["b", 2], ["a", 1]]),
      list: [1, 2],
    };
    assertEquals(
      await runtime.evaluate(equalData, { left, right }),
      true,
    );
    assertEquals(
      await runtime.evaluate(sameIdentity, { left, right }),
      false,
    );
    assertEquals(
      await runtime.evaluate(equalData, { left: -0, right: 0 }),
      true,
    );
    assertEquals(
      await runtime.evaluate(equalData, { left: NaN, right: NaN }),
      true,
    );
    await assertRejects(
      () => evaluate("(echo 1)"),
      ReferenceError,
      "unknown reference: echo",
    );
  },
);

Deno.test(
  "req:application-shell-010 unknown names in domain and config pattern projections fail checking",
  async () => {
    const path = "examples/domain/counter.clsw";
    const source = await Deno.readTextFile(path);
    const parsed = await parseApplicationSource(
      source.replace(
        "(add state.fields.count input.by)",
        "(console.log input.by)",
      ),
      path,
    );
    if (!parsed.ok) throw new Error(parsed.failure.message);
    const expressionDiagnostics = validateDeclarativeDomain(parsed.syntax);
    assertEquals(
      expressionDiagnostics.some((diagnostic) =>
        diagnostic.code === "UNKNOWN_EXPRESSION_REFERENCE" &&
        diagnostic.message.includes("console")
      ),
      true,
    );

    const projectedConfig = await parseApplicationSource(
      source.replace(
        'mode: ("api");',
        "mode: (string -> (echo _));",
      ),
      path,
    );
    if (!projectedConfig.ok) {
      throw new Error(projectedConfig.failure.message);
    }
    const patternDiagnostics = validateDeclarativeDomain(
      projectedConfig.syntax,
    );
    assertEquals(
      patternDiagnostics.some((diagnostic) =>
        diagnostic.code === "UNKNOWN_EXPRESSION_REFERENCE" &&
        diagnostic.message.includes("echo")
      ),
      true,
    );
  },
);

Deno.test(
  "req:application-shell-010 native expressions in grammar-extracted patterns are rejected",
  async () => {
    const path = "examples/domain/counter.clsw";
    const parsed = await parseApplicationSource(
      await Deno.readTextFile(path),
      path,
    );
    if (!parsed.ok) throw new Error(parsed.failure.message);
    const nativeExpression: Expression = {
      kind: ExpressionKind.Native,
      fn: () => undefined,
    };
    const declarations = parsed.syntax.declarations.map((declaration) => {
      if (declaration.kind !== "config") return declaration;
      return {
        ...declaration,
        settings: declaration.settings.map((setting) => {
          if (setting.kind !== "setting" || setting.name !== "mode") {
            return setting;
          }
          const pattern: Pattern = {
            kind: PatternKind.Projection,
            pattern: setting.pattern,
            expression: nativeExpression,
          };
          return { ...setting, pattern };
        }),
      };
    });
    const diagnostics = validateDeclarativeDomain({
      ...parsed.syntax,
      declarations,
    });
    assertEquals(
      diagnostics.some((diagnostic) =>
        diagnostic.code === "NATIVE_EXPRESSION_UNSUPPORTED"
      ),
      true,
    );
  },
);

Deno.test(
  "req:application-shell-010 invalid pattern references and non-data types fail checking",
  async () => {
    const path = "examples/domain/counter.clsw";
    const source = await Deno.readTextFile(path);
    const unbound = await parseApplicationSource(
      source.replace('mode: ("api");', "mode: ($missing);"),
      path,
    );
    if (!unbound.ok) throw new Error(unbound.failure.message);
    assertEquals(
      validateDeclarativeDomain(unbound.syntax).some((diagnostic) =>
        diagnostic.code === "UNKNOWN_PATTERN_REFERENCE"
      ),
      true,
    );

    const nonData = await parseApplicationSource(
      source.replace('mode: ("api");', "mode: (function);"),
      path,
    );
    if (!nonData.ok) throw new Error(nonData.failure.message);
    assertEquals(
      validateDeclarativeDomain(nonData.syntax).some((diagnostic) =>
        diagnostic.code === "NON_DATA_PATTERN_TYPE"
      ),
      true,
    );
  },
);

Deno.test(
  "req:application-shell-010 check and run reject unsafe expressions before startup",
  async () => {
    const source = await Deno.readTextFile("examples/domain/counter.clsw");
    const invalidSource = source.replace(
      "(add state.fields.count input.by)",
      "(Deno.env)",
    );
    const path = `bin/domain-invalid-${crypto.randomUUID()}.clsw`;
    await Deno.mkdir("bin", { recursive: true });
    await Deno.writeTextFile(path, invalidSource);
    try {
      assertEquals(await executeCli(["check", path]), 1);
      assertEquals(await executeCli(["run", path]), 1);
    } finally {
      await Deno.remove(path);
    }
  },
);
