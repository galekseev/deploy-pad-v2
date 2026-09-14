/**
 * Rendering diagnostics — one format, every command.
 *
 * It lives in `commands/` because that is the bucket for how an outcome is
 * rendered ([project-structure.md §3](../../../../docs/implementation/project-structure.md)),
 * and it is shared rather than per-command because an operator who learns to read
 * `validate`'s output should not have to learn `run`'s as well. CI greps this.
 *
 * Grouped by file, because that is the unit an author opens to fix something, and
 * pointer-first within a file, because the JSON Pointer is the part that says
 * *where* — ajv gives us RFC 6901 for free, so a diagnostic names the offending
 * node rather than guessing a line.
 */
import { blocksRun, type Diagnostic } from '../contracts/index.ts';
import type { Logger } from '../cross/logging/index.ts';

/** Diagnostics with no file of their own — an in-memory config source, or phase 1. */
const NO_FILE = '(invocation)';

function count(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? '' : 's'}`;
}

function severity(diagnostic: Diagnostic): string {
  return blocksRun(diagnostic) ? 'error' : 'warning';
}

function where(diagnostic: Diagnostic): string {
  const { pointer, chain, stepId } = diagnostic.location;
  const parts = [pointer, chain === null ? null : `chain ${chain}`, stepId].filter(
    (part): part is string => part !== null,
  );

  return parts.length === 0 ? '' : parts.join(' ');
}

function group(diagnostics: readonly Diagnostic[]): ReadonlyMap<string, Diagnostic[]> {
  const grouped = new Map<string, Diagnostic[]>();

  for (const diagnostic of diagnostics) {
    const file = diagnostic.location.file ?? NO_FILE;
    const into = grouped.get(file) ?? [];
    into.push(diagnostic);
    grouped.set(file, into);
  }

  return grouped;
}

export function renderDiagnostics(diagnostics: readonly Diagnostic[]): string {
  const lines: string[] = [];

  for (const [file, group_] of group(diagnostics)) {
    lines.push(file);

    const rows = group_.map((diagnostic) => [severity(diagnostic), where(diagnostic)] as const);
    const widths = [0, 1].map((column) =>
      Math.max(...rows.map((row) => (row[column as 0 | 1] ?? '').length)),
    );

    group_.forEach((diagnostic, index) => {
      const [label, at] = rows[index] ?? ['', ''];
      const columns = [label.padEnd(widths[0] ?? 0), at.padEnd(widths[1] ?? 0), diagnostic.message];
      lines.push(`  ${columns.join('  ').trimEnd()}`);
    });

    lines.push('');
  }

  const errors = diagnostics.filter(blocksRun).length;
  const warnings = diagnostics.length - errors;

  lines.push(`${count(errors, 'error')}, ${count(warnings, 'warning')}`);
  return lines.join('\n');
}

/**
 * Through `print` rather than `error`, because this is formatted human output
 * that happens to be level-gated — the same treatment the run header and the
 * summary get, and what makes `--log-level silent` suppress the lot.
 */
export function reportDiagnostics(logger: Logger, diagnostics: readonly Diagnostic[]): void {
  if (diagnostics.length === 0) return;

  const stream = diagnostics.some(blocksRun) ? 'err' : 'out';
  logger.print(renderDiagnostics(diagnostics), { level: 'error', stream });

  // The structured sink gets them one by one, with their code and requirement
  // intact — the console form is for a human, this is for whatever reads the log.
  for (const diagnostic of diagnostics) logger.debug(`diagnostic ${diagnostic.code}`, diagnostic);
}
