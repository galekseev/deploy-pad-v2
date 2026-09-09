/**
 * Reads the flag matrix out of [cli.md](../../docs/specs/cli.md#flags-by-command).
 *
 * The point of parsing the spec rather than transcribing it: a table copied into a
 * test agrees with the document on the day it is written and never again. Here the
 * document *is* the test data, so a row added to cli.md becomes a case, and a cell
 * flipped there fails until the code follows.
 */
import { readFileSync } from 'node:fs';
import { tableUnder } from './markdown.ts';
import { repoPath } from './paths.ts';

const SPEC = 'docs/specs/cli.md';

const HEADING = '### Flags by command';

/** How the table says a command takes a flag. `optional` is `status`'s `-e`. */
const ACCEPTS = new Set(['✓', 'required', 'optional']);
const REFUSES = new Set(['—']);

export interface FlagRow {
  /** Every individual flag the row names: `-c, --chain` contributes both. */
  readonly flags: readonly string[];
  /** Keyed by command name, as the header spells it. */
  readonly accepted: ReadonlyMap<string, boolean>;
}

export interface FlagMatrix {
  readonly commands: readonly string[];
  readonly rows: readonly FlagRow[];
}

/**
 * `-e, --plan` is one option with two spellings; `` `--log-level` (and `-v,
 * --verbose` / `-q, --quiet`) / `-l, --log-file` `` is five. Both are handled by the
 * same rule: take every backticked span, split it on commas, and keep what looks
 * like a flag. The prose between the spans then needs no grammar of its own.
 */
function flagsIn(cell: string): readonly string[] {
  return [...cell.matchAll(/`(?<span>[^`]+)`/gu)]
    .flatMap((match) => (match.groups?.['span'] ?? '').split(','))
    .map((flag) => flag.trim())
    .filter((flag) => flag.startsWith('-'));
}

export function flagMatrix(): FlagMatrix {
  const table = tableUnder(readFileSync(repoPath(SPEC), 'utf8'), HEADING, SPEC);
  const commands = table.header.slice(1).map((name) => name.replaceAll('`', ''));

  const rows = table.rows.map((row): FlagRow => {
    const [label, ...marks] = row;

    return {
      flags: flagsIn(label ?? ''),
      accepted: new Map(
        commands.map((command, index) => {
          const mark = marks[index] ?? '';
          if (!ACCEPTS.has(mark) && !REFUSES.has(mark)) {
            throw new Error(
              `${SPEC}: unrecognised mark ${JSON.stringify(mark)} for ${command} in row ${JSON.stringify(label)}`,
            );
          }
          return [command, ACCEPTS.has(mark)];
        }),
      ),
    };
  });

  return { commands, rows };
}
