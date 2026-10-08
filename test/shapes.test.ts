import { assert, assertEquals } from "@std/assert";
import { resolve, toFileUrl } from "@std/path";
import { executeCli } from "../src/cli.ts";
import { resolveApplicationImports } from "../src/imports.ts";
import { parseApplicationSource } from "../src/uffda.ts";
import {
  createDomainExpressionRuntime,
  validateDeclarativeDomain,
} from "../src/domain-runtime.ts";
import { shapeDefinitionsFromDeclarations } from "../src/shapes.ts";
import { PatternKind } from "@justinmchase/uffda/pattern";

Deno.test(
  "req:application-shell-001 req:application-shell-002 req:application-shell-004 imported shapes and mode parameters are validated before factories",
  async () => {
    const folder = `bin/shaped-mode-${crypto.randomUUID()}`;
    const app = `${folder}/app.clsw`;
    const shapesPath = `${folder}/shapes.clsw`;
    const hostPath = `${folder}/host.ts`;
    await Deno.mkdir(folder, { recursive: true });
    const source = `
import "./shapes.clsw" Label;
import "./host.ts" Probe;
export config Settings { mode: ("job"); }
export mode Batch(jobName: (string), label: (Label)): Job {
  jobs { Probe(label) example; Probe("unused") unused; }
}
export program Application {
  config Settings settings;
  mode settings.mode { "job" => Batch("example", "valid"); }
}
`;
    try {
      await Deno.writeTextFile(
        shapesPath,
        "shape Private = (string); export shape Label = (Private);",
      );
      await Deno.writeTextFile(
        hostPath,
        `
const calls: unknown[] = [];
export function snapshot() { return calls.slice(); }
export const Probe = {
  kind: "job", parameters: [{ name: "label", type: { kind: "string" } }],
  create(args: readonly unknown[]) {
    calls.push(["create", args[0]]);
    return { value: { run(label: string) { calls.push(["run", label]); } } };
  },
};`,
      );
      await Deno.writeTextFile(app, source);
      assertEquals(await executeCli(["check", app]), 0);
      const host = await import(toFileUrl(resolve(hostPath)).href);
      assertEquals(host.snapshot(), []);
      assertEquals(await executeCli(["run", app, "--mode", "job"]), 0);
      assertEquals(host.snapshot(), [["create", "valid"], ["run", "valid"]]);

      const parsed = await parseApplicationSource(source, app);
      assert(parsed.ok);
      const imported = await resolveApplicationImports(parsed.syntax, app);
      assert(imported.ok);
      assertEquals(imported.resolved.names.has("Private"), false);
      const definitions = shapeDefinitionsFromDeclarations([
        ...imported.resolved.declarations.values(),
      ]);
      const shape = definitions.get("Label");
      assert(shape);
      assertEquals(
        (await createDomainExpressionRuntime(definitions).match(
          shape.pattern,
          123,
        )).matched,
        false,
      );
      for (
        const invalid of [
          source.replace('Batch("example", "valid")', 'Batch("example", 123)'),
          source.replace('Batch("example", "valid")', 'Batch("example")'),
          source.replace(
            'Batch("example", "valid")',
            'Batch("example", "valid", "extra")',
          ),
          source.replace("label: (Label)", "jobName: (Label)"),
          source.replace("Probe(label)", "Probe(unbound)"),
        ]
      ) {
        await Deno.writeTextFile(app, invalid);
        assertEquals(await executeCli(["run", app, "--mode", "job"]), 1);
        assertEquals(host.snapshot(), [["create", "valid"], ["run", "valid"]]);
      }
    } finally {
      for (const path of [app, shapesPath, hostPath]) await Deno.remove(path);
      await Deno.remove(folder);
    }
  },
);

Deno.test(
  "req:application-shell-001 named regex shapes preserve Uffda patterns and config remains independent",
  async () => {
    const parsed = await parseApplicationSource(
      "export shape Code = (string); config Settings { mode: (Code); }",
      "shape-regex.clsw",
    );
    assert(parsed.ok);
    const definitions = shapeDefinitionsFromDeclarations(
      parsed.syntax.declarations,
    );
    const runtimeDefinitions = new Map(definitions);
    runtimeDefinitions.set("Code", {
      name: "Code",
      pattern: {
        kind: PatternKind.RegExp,
        pattern: /^[a-z]+$/,
      },
    });
    const code = definitions.get("Code");
    assert(code);
    const runtime = createDomainExpressionRuntime(runtimeDefinitions);
    const config = parsed.syntax.declarations.find((declaration) =>
      declaration.kind === "config"
    );
    assert(config?.kind === "config");
    const setting = config.settings[0];
    assert(setting.kind === "setting");
    const reference = setting.pattern;
    assertEquals((await runtime.match(reference, "abc")).matched, true);
    assertEquals((await runtime.match(reference, "123")).matched, false);
    assertEquals(
      validateDeclarativeDomain(parsed.syntax).some((problem) =>
        problem.code === "INVALID_NAMED_SHAPE" &&
        problem.message.includes("Code")
      ),
      true,
    );
  },
);
