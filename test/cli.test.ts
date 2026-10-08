import { assertEquals } from "@std/assert";
import { relative, resolve } from "@std/path";
import { executeCli } from "../src/cli.ts";
import { checkedArtifactPath, findColeslawProject } from "../src/project.ts";

Deno.test(
  "req:application-shell-003 secret values are redacted from mode execution failures",
  async () => {
    const folder = `bin/secret-failure-${crypto.randomUUID()}`;
    await Deno.mkdir(folder, { recursive: true });
    const sourcePath = `${folder}/app.clsw`;
    const hostPath = `${folder}/host.ts`;
    const secret = "private-credential-123";
    const errors: string[] = [];
    const originalError = console.error;
    try {
      await Deno.writeTextFile(
        hostPath,
        `
export const SecretJob = {
  kind: "job",
  parameters: [{ name: "token", type: { kind: "string" } }],
  create(args: readonly unknown[]) {
    return { value: { run() { throw new Error("failed using " + args[0]); } } };
  },
};`,
      );
      await Deno.writeTextFile(
        sourcePath,
        `
import "./host.ts" SecretJob;
export config Settings { mode: ("job"); secret token: (string); }
export mode Batch: Job { jobs { SecretJob(settings.token) example; } }
export program Application {
  config Settings settings;
  mode settings.mode { "job" => Batch; }
}`,
      );
      console.error = (...values: unknown[]) =>
        errors.push(values.map(String).join(" "));
      assertEquals(
        await executeCli([
          "run",
          sourcePath,
          "--mode",
          "job",
          "--token",
          secret,
        ]),
        1,
      );
      assertEquals(errors.some((message) => message.includes(secret)), false);
      assertEquals(
        errors.some((message) => message.includes("[redacted]")),
        true,
        errors.join("\n"),
      );
    } finally {
      console.error = originalError;
      for (const path of [sourcePath, hostPath]) await Deno.remove(path);
      await Deno.remove(folder);
    }
  },
);

Deno.test(
  "req:application-shell-007 CLI compiles, runs, and rejects stale artifacts",
  async () => {
    const sourcePath = "examples/shell/app.clsw";
    const project = await findColeslawProject();
    const artifactPath = relative(
      Deno.cwd(),
      checkedArtifactPath(resolve(Deno.cwd(), sourcePath), project),
    );
    try {
      assertEquals(await executeCli(["parse", sourcePath]), 0);
      assertEquals(await executeCli(["check", sourcePath]), 0);
      assertEquals(await executeCli(["compile", sourcePath]), 0);
      assertEquals(
        await executeCli([
          "run",
          sourcePath,
          "--mode",
          "job",
          "--job-name",
          "example",
        ]),
        0,
      );
      assertEquals(
        await executeCli([
          "run",
          artifactPath,
          "--mode",
          "job",
          "--job-name",
          "example",
        ]),
        0,
      );
      const artifact = JSON.parse(await Deno.readTextFile(artifactPath));
      artifact.sourceSha256 = "stale";
      await Deno.writeTextFile(
        artifactPath,
        `${JSON.stringify(artifact, null, 2)}\n`,
      );
      assertEquals(await executeCli(["run", artifactPath]), 1);
    } finally {
      await Deno.remove(artifactPath).catch((error) =>
        error instanceof Deno.errors.NotFound
          ? undefined
          : Promise.reject(error)
      );
    }
  },
);

Deno.test(
  "req:application-shell-007 checked artifacts use the project output directory",
  async () => {
    const project = await findColeslawProject();
    assertEquals(
      project.imports.get("@justinmchase/uffda"),
      "jsr:@justinmchase/uffda@^0.9.1",
    );
    assertEquals(
      project.lockfile.version("jsr:@justinmchase/uffda@^0.9.1"),
      "0.9.1",
    );
    assertEquals(
      checkedArtifactPath("/workspace/src/app.clsw", {
        root: "/workspace",
        outDir: "/workspace/build/output",
      }),
      resolve("/workspace/build/output/checked/src__app.clsw.cslwc.json"),
    );
  },
);

Deno.test(
  "req:application-shell-002 req:application-shell-007 external projects compile and actual dependency changes stale artifacts",
  async () => {
    const folder = `bin/external-project-${crypto.randomUUID()}`;
    const sourcePath = `${folder}/app.clsw`;
    const hostPath = `${folder}/host.ts`;
    const projectPath = `${folder}/clsw.jsonc`;
    await Deno.mkdir(folder, { recursive: true });
    const host = `export const Noop = {
  kind: "job", parameters: [],
  create() { return { value: { run() {} } }; }
};`;
    const source = `
import "./host.ts" Noop;
export config Settings { mode: ("job"); }
export mode Batch: Job { jobs { Noop example; } }
export program Application {
  config Settings settings;
  mode settings.mode { "job" => Batch; }
}
`;
    try {
      await Deno.writeTextFile(sourcePath, source);
      await Deno.writeTextFile(hostPath, host);
      await Deno.writeTextFile(
        projectPath,
        JSON.stringify({
          imports: { "@justinmchase/uffda": "jsr:@justinmchase/uffda@^0.9.1" },
          outDir: "./build",
        }),
      );
      assertEquals(await executeCli(["compile", sourcePath]), 0);
      const project = await findColeslawProject(resolve(sourcePath));
      const artifact = checkedArtifactPath(resolve(sourcePath), project);
      assertEquals(
        artifact,
        resolve(folder, "build/checked/app.clsw.cslwc.json"),
      );
      assertEquals(await executeCli(["run", artifact, "--mode", "job"]), 0);
      await Deno.writeTextFile(hostPath, `${host}\n// changed dependency\n`);
      assertEquals(await executeCli(["run", artifact, "--mode", "job"]), 1);
      await Deno.writeTextFile(hostPath, host);
      await Deno.writeTextFile(sourcePath, `${source}\n# changed source\n`);
      assertEquals(await executeCli(["run", artifact, "--mode", "job"]), 1);
      await Deno.writeTextFile(sourcePath, source);
      await Deno.writeTextFile(
        projectPath,
        `${await Deno.readTextFile(projectPath)}\n`,
      );
      assertEquals(await executeCli(["run", artifact, "--mode", "job"]), 1);
    } finally {
      await Deno.remove(resolve(folder), { recursive: true });
    }
  },
);
