import type { NamePath, SourceSpan } from "./syntax.ts";
import type {
  ConfigDiagnostic,
  PreparedConfig,
  ResolvedConfig,
} from "./config.ts";

export interface SelectedMode {
  readonly label: string;
  readonly name: NamePath;
  readonly arguments: readonly unknown[];
  readonly settings: Readonly<Record<string, unknown>>;
}

export interface ModeMapping {
  readonly label: string;
  readonly mode: NamePath;
  readonly arguments: readonly unknown[];
  readonly span: SourceSpan;
}

export type ModeSelectionResult =
  | { readonly ok: true; readonly selected: SelectedMode }
  | {
    readonly ok: false;
    readonly diagnostics: readonly ConfigDiagnostic[];
  };

export function validateModeSelections(
  selections: readonly ModeMapping[],
): readonly ConfigDiagnostic[] {
  const labels = new Set<string>();
  const diagnostics: ConfigDiagnostic[] = [];
  for (const selection of selections) {
    if (labels.has(selection.label)) {
      diagnostics.push({
        code: "DUPLICATE_MODE_LABEL",
        message: `Mode label ${
          JSON.stringify(selection.label)
        } is declared more than once`,
      });
    } else {
      labels.add(selection.label);
    }
  }
  if (selections.length === 0) {
    diagnostics.push({
      code: "MISSING_MODE_SELECTION",
      message: "Program must map at least one mode label",
    });
  }
  return diagnostics;
}

function valueAtPath(
  value: Readonly<Record<string, unknown>>,
  path: readonly string[],
): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = Reflect.get(current, segment);
  }
  return current;
}

export async function selectMode(
  config: PreparedConfig,
  selector: readonly string[],
  selections: readonly ModeMapping[],
): Promise<ModeSelectionResult> {
  const declarationProblems = validateModeSelections(selections);
  if (declarationProblems.length > 0) {
    return { ok: false, diagnostics: declarationProblems };
  }
  const resolved = await config.resolve([selector]);
  if (resolved.diagnostics.length > 0) {
    return { ok: false, diagnostics: resolved.diagnostics };
  }
  return selectResolvedMode(resolved, selector, selections);
}

export function selectResolvedMode(
  config: ResolvedConfig,
  selector: readonly string[],
  selections: readonly ModeMapping[],
): ModeSelectionResult {
  const labelValue = valueAtPath(config.values, selector);
  if (typeof labelValue !== "string") {
    return {
      ok: false,
      diagnostics: [{
        code: "INVALID_MODE_SELECTOR",
        message: `Mode selector ${
          selector.join(".")
        } must resolve to a string label`,
        path: selector.join("."),
      }],
    };
  }
  const selection = selections.find((candidate) =>
    candidate.label === labelValue
  );
  if (!selection) {
    return {
      ok: false,
      diagnostics: [{
        code: "UNKNOWN_MODE_LABEL",
        message: `No mode matches the configured selector; expected ${
          selections.map((candidate) => JSON.stringify(candidate.label)).join(
            ", ",
          )
        }`,
        path: selector.join("."),
      }],
    };
  }
  return {
    ok: true,
    selected: {
      label: selection.label,
      name: selection.mode,
      arguments: selection.arguments,
      settings: config.values,
    },
  };
}

export type JobSelectionResult =
  | { readonly ok: true; readonly job: string }
  | { readonly ok: false; readonly diagnostics: readonly ConfigDiagnostic[] };

export function selectExactlyOneJob(
  jobs: readonly string[],
  selected?: string,
): JobSelectionResult {
  if (jobs.length === 0) {
    return {
      ok: false,
      diagnostics: [{
        code: "MISSING_JOB",
        message: "Job mode declares no jobs",
      }],
    };
  }
  if (selected === undefined) {
    if (jobs.length === 1) return { ok: true, job: jobs[0] };
    return {
      ok: false,
      diagnostics: [{
        code: "MISSING_JOB",
        message: `Select one job: ${
          jobs.map((job) => JSON.stringify(job)).join(", ")
        }`,
      }],
    };
  }
  if (!jobs.includes(selected)) {
    return {
      ok: false,
      diagnostics: [{
        code: "UNKNOWN_JOB",
        message: `Unknown selected job; available jobs: ${
          jobs.map((job) => JSON.stringify(job)).join(", ")
        }`,
      }],
    };
  }
  return { ok: true, job: selected };
}
