import { assert, assertEquals } from "@std/assert";
import { relative, resolve } from "@std/path";
import { checkApplication } from "../src/application.ts";
import { executeCli } from "../src/cli.ts";
import { resolveApplicationImports } from "../src/imports.ts";
import { parseApplicationSource } from "../src/uffda.ts";

Deno.test(
  "req:application-shell-008 built-in kinds can be imported but cannot be forged",
  async () => {
    const sourcePath = "test/fixtures/metadata/app.clsw";
    const original = await Deno.readTextFile(sourcePath);
    for (const name of ["Web", "Malformed", "Forged"]) {
      const parsed = await parseApplicationSource(
        `import "./modes.ts" ${name};\n${original}`,
        sourcePath,
      );
      assert(parsed.ok);
      const imported = await resolveApplicationImports(
        parsed.syntax,
        sourcePath,
      );
      assertEquals(imported.ok, name === "Web");
      if (!imported.ok) {
        assertEquals(
          imported.diagnostics.some((diagnostic) =>
            diagnostic.code ===
              (name === "Malformed"
                ? "INVALID_HOST_EXPORT"
                : "BUILTIN_MODE_SHADOW")
          ),
          true,
        );
      }
    }
  },
);

Deno.test(
  "req:application-shell-002 req:application-shell-008 imports host metadata without constructing resources",
  async () => {
    const sourcePath = "test/fixtures/metadata/app.clsw";
    const source = await Deno.readTextFile(sourcePath);
    const parsed = await parseApplicationSource(source, sourcePath);
    assert(parsed.ok, parsed.ok ? "" : parsed.failure.message);
    const imports = await resolveApplicationImports(parsed.syntax, sourcePath);
    assert(imports.ok, imports.ok ? "" : imports.diagnostics[0]?.message);
    assert(imports.resolved.componentDescriptors.has("Probe"));
    assert(imports.resolved.symbols.has("SharedSettings"));
    assert(
      [...imports.resolved.dependencies.keys()].some((path) =>
        path.endsWith("/shared.clsw")
      ),
    );
    const checked = checkApplication(parsed.syntax, {
      importedNames: imports.resolved.names,
      importedDeclarations: imports.resolved.declarations,
      modeDescriptors: imports.resolved.modeDescriptors,
      componentDescriptors: imports.resolved.componentDescriptors,
    });
    assert(checked.ok, checked.ok ? "" : checked.diagnostics[0]?.message);
    const host = await import("./fixtures/metadata/host.ts");
    assertEquals(host.getCreateCalls(), 0);
  },
);

Deno.test(
  "req:application-shell-002 imported config is bound explicitly and private imports stay scoped",
  async () => {
    const folder = `bin/import-scope-${crypto.randomUUID()}`;
    await Deno.mkdir(folder, { recursive: true });
    const dependency = `${folder}/settings.clsw`;
    const privateModule = `${folder}/private.clsw`;
    const sourcePath = `${folder}/app.clsw`;
    const hostImport = relative(
      resolve(folder),
      resolve("test/fixtures/metadata/host.ts"),
    );
    const source = `
import "./settings.clsw" SharedSettings;
import "${hostImport}" Probe;
export mode ExampleJob: Job { jobs { Probe example; } }
export program ImportedConfig {
  config SharedSettings settings;
  mode settings.mode { "job" => ExampleJob; }
}
`;
    try {
      await Deno.writeTextFile(
        privateModule,
        'export config PrivateSettings { mode: ("private"); }',
      );
      await Deno.writeTextFile(
        dependency,
        `
import "./private.clsw" PrivateSettings;
export config SharedSettings { mode: ("job"); }
`,
      );
      await Deno.writeTextFile(sourcePath, source);
      const parsed = await parseApplicationSource(source, sourcePath);
      assert(parsed.ok);
      const imports = await resolveApplicationImports(
        parsed.syntax,
        sourcePath,
      );
      assert(imports.ok, imports.ok ? "" : imports.diagnostics[0]?.message);
      assertEquals([...imports.resolved.names].sort(), [
        "Probe",
        "SharedSettings",
      ]);
      assertEquals(imports.resolved.symbols.has("PrivateSettings"), false);
      const checked = checkApplication(parsed.syntax, {
        importedNames: imports.resolved.names,
        importedDeclarations: imports.resolved.declarations,
        componentDescriptors: imports.resolved.componentDescriptors,
      });
      assert(checked.ok, checked.ok ? "" : checked.diagnostics[0]?.message);
      assertEquals(checked.checked.config.name, "SharedSettings");
      assertEquals(await executeCli(["check", sourcePath]), 0);
      await Deno.writeTextFile(
        dependency,
        "export config SharedSettings { mode: (string -> (echo _)); }",
      );
      assertEquals(await executeCli(["check", sourcePath]), 1);
    } finally {
      for (const path of [sourcePath, dependency, privateModule]) {
        await Deno.remove(path);
      }
      await Deno.remove(folder);
    }
  },
);
