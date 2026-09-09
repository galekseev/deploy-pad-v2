/**
 * Reading a table out of the doc set.
 *
 * The doc set is the source of truth (OC-1), and drift between a document and the
 * code is exactly what nobody notices. Several contract tests therefore take a
 * table in the specs as their test data rather than transcribing it — this is the
 * shared parsing.
 */

export interface MarkdownTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

function cells(line: string): readonly string[] {
  // A markdown row is delimited, not terminated: the split's first and last pieces
  // are the empty strings either side of the outer pipes.
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

/** The first table below `heading`, which ends at the first line that is not a row. */
export function tableUnder(markdown: string, heading: string, where: string): MarkdownTable {
  const start = markdown.indexOf(heading);
  if (start === -1) throw new Error(`${where} has no ${JSON.stringify(heading)} section`);

  const lines = markdown.slice(start).split('\n');
  const first = lines.findIndex((line) => line.startsWith('|'));
  if (first === -1) throw new Error(`${where} has no table under ${JSON.stringify(heading)}`);

  const after = lines.findIndex((line, index) => index > first && !line.startsWith('|'));
  const table = lines.slice(first, after === -1 ? undefined : after);

  const [header, , ...body] = table;
  if (header === undefined) throw new Error(`${where}: the table under ${heading} has no header`);

  return { header: cells(header), rows: body.map(cells) };
}
