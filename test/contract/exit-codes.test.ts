/**
 * The exit codes are a contract with CI: they never shift (FR-CLI-005). So the
 * enum is asserted against the table in the spec rather than against itself —
 * this is the test that catches a code being added in one place only.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXIT_CODE_LABELS, ExitCode } from '../../packages/engine/src/contracts/index.ts';
import { repoPath } from '../support/paths.ts';

/** The table under `### Exit codes`, as `code -> the label before the em dash`. */
function documentedExitCodes(): Record<string, string> {
  const spec = readFileSync(repoPath('docs/specs/cli.md'), 'utf8');
  const start = spec.indexOf('### Exit codes');
  expect(start, 'cli.md has no "### Exit codes" section').toBeGreaterThan(-1);

  const section = spec.slice(start, spec.indexOf('\n### ', start + 1));
  const documented: Record<string, string> = {};

  for (const line of section.split('\n')) {
    const row = /^\|\s*`(?<code>\d+)`\s*\|\s*(?<meaning>.+?)\s*\|$/u.exec(line);
    if (row?.groups === undefined) continue;
    documented[row.groups['code'] as string] = (row.groups['meaning'] as string).split(' — ')[0] as string;
  }

  return documented;
}

describe('the exit-code table', () => {
  it('[FR-CLI-005] matches cli.md code for code', () => {
    expect(EXIT_CODE_LABELS).toEqual(documentedExitCodes());
  });

  it('[FR-CLI-005] names every documented code', () => {
    expect(Object.values(ExitCode).map(String).sort()).toEqual(
      Object.keys(documentedExitCodes()).sort(),
    );
  });

  it('[FR-CLI-005] keeps the waiting state distinct from success, so CI can tell pending from done', () => {
    expect(ExitCode.MultisigWaiting).toBe(10);
    expect(ExitCode.MultisigWaiting).not.toBe(ExitCode.Success);
  });
});
