import { parse as parseJsonc } from "@std/jsonc";
import { dirname, isAbsolute, join, relative, resolve } from "@std/path";
import { JsrPackages, Lockfile } from "@justinmchase/uffda";

export interface ColeslawProject {
  readonly root: string;
  readonly path: string;
  readonly imports: ReadonlyMap<string, string>;
  readonly outDir: string;
  readonly lockfile: Lockfile;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function checkedOutDir(root: string, value: unknown): string {
  if (
    typeof value !== "string" || !value.startsWith("./") ||
    isAbsolute(value)
  ) {
    throw new Error(
      'clsw.jsonc: "outDir" must be a project-relative directory starting with "./"',
    );
  }
  const outDir = resolve(root, value);
  const fromRoot = relative(root, outDir);
  if (
    fromRoot === ".." || fromRoot.startsWith("../") ||
    fromRoot.startsWith("..\\")
  ) {
    throw new Error('clsw.jsonc: "outDir" must remain inside the project root');
  }
  return outDir;
}

function checkedImports(value: unknown): ReadonlyMap<string, string> {
  const record = asRecord(value ?? {});
  if (record === undefined) {
    throw new Error('clsw.jsonc: "imports" must be an object');
  }
  const imports = new Map<string, string>();
  for (const [name, specifier] of Object.entries(record)) {
    if (
      !name.startsWith("@") || typeof specifier !== "string" ||
      !specifier.startsWith("jsr:")
    ) {
      throw new Error(
        `clsw.jsonc: invalid import mapping for ${JSON.stringify(name)}`,
      );
    }
    imports.set(name, specifier);
  }
  for (const name of imports.keys()) {
    for (const other of imports.keys()) {
      if (other !== name && other.startsWith(`${name}/`)) {
        throw new Error(
          `clsw.jsonc: import mappings ${name} and ${other} overlap`,
        );
      }
    }
  }
  return imports;
}

export async function findColeslawProject(
  startingPath = Deno.cwd(),
): Promise<ColeslawProject> {
  let directory = startingPath;
  try {
    if ((await Deno.stat(directory)).isFile) directory = dirname(directory);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    directory = dirname(directory);
  }
  directory = resolve(directory);
  while (true) {
    const path = resolve(directory, "clsw.jsonc");
    try {
      const text = await Deno.readTextFile(path);
      let parsed: unknown;
      try {
        parsed = parseJsonc(text);
      } catch (error) {
        throw new Error(
          `${path}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      const config = asRecord(parsed);
      if (config === undefined) {
        throw new Error(`${path}: expected a project configuration object`);
      }
      const root = directory;
      const imports = checkedImports(config.imports);
      const outDir = checkedOutDir(root, config.outDir ?? "./bin");
      const lockfileResult = await Lockfile.load(resolve(root, "clsw.lock"));
      if (!lockfileResult.ok) throw new Error(lockfileResult.message);
      return {
        root,
        path,
        imports,
        outDir,
        lockfile: lockfileResult.lockfile,
      };
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(
        `Unable to find clsw.jsonc from ${startingPath}; run cslw inside a Coleslaw project`,
      );
    }
    directory = parent;
  }
}

export function projectPackages(
  project: ColeslawProject,
  options: {
    readonly registry?: URL;
    readonly fetch?: (url: URL) => Promise<Response>;
  } = {},
): JsrPackages {
  return new JsrPackages({
    cacheDir: resolve(project.outDir, ".uffda-cache"),
    lockfile: project.lockfile,
    ...options,
  });
}

export function checkedArtifactPath(
  sourcePath: string,
  project: Pick<ColeslawProject, "root" | "outDir">,
): string {
  const relativePath = relative(project.root, sourcePath);
  if (
    relativePath === ".." || relativePath.startsWith("../") ||
    relativePath.startsWith("..\\")
  ) {
    throw new Error(
      `Application source ${sourcePath} is outside project ${project.root}`,
    );
  }
  const filename = relativePath.replaceAll(/[\\/]/g, "__");
  return join(project.outDir, "checked", `${filename}.cslwc.json`);
}
