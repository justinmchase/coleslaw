import type { SourcePosition, SourceSpan, SyntaxDiagnostic } from "./syntax.ts";

export function sourcePosition(
  source: string,
  offset: number,
): SourcePosition {
  const bounded = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, bounded);
  const lineStart = before.lastIndexOf("\n") + 1;
  let line = 0;
  for (let index = 0; index < lineStart; index++) {
    if (source[index] === "\n") line++;
  }
  return {
    offset: bounded,
    line,
    column: bounded - lineStart,
  };
}

export function sourceSpan(
  sourceName: string,
  source: string,
  start: number,
  end = start,
): SourceSpan {
  return {
    source: sourceName,
    start: sourcePosition(source, start),
    end: sourcePosition(source, end),
  };
}

export function formatDiagnostic(diagnostic: SyntaxDiagnostic): string {
  const where = diagnostic.span
    ? `${diagnostic.span.source}:${diagnostic.span.start.line + 1}:${
      diagnostic.span.start.column + 1
    }`
    : "coleslaw";
  return `${where}: ${diagnostic.code}: ${diagnostic.message}`;
}
