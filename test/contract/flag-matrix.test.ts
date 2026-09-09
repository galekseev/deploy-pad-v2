/**
 * The flag matrix, driven from the document that defines it.
 *
 * FR-CLI-006 is the requirement class most easily left to a code review: a flag
 * silently ignored looks exactly like a flag that worked. So every cell of
 * [cli.md → Flags by command](../../docs/specs/cli.md#flags-by-command) is asserted
 * in both directions — accepted where the table marks it, exit `1` where it does
 * not — and the table is read out of the spec rather than copied into this file.
 */
import { describe, expect, it } from 'vitest';
import { capture } from '../../packages/engine/test/support/capture.ts';
import { COMMANDS, ExitCode } from '../../packages/engine/src/contracts/index.ts';
import {
  EXCLUDE_CHAIN_SHORT_FLAG,
  declaredFlagsByCommand,
} from '../../packages/engine/src/phases/phase-1/index.ts';
import { runCli } from '../../packages/engine/src/cli.ts';
import { flagMatrix } from '../support/flag-matrix.ts';
import { repoPath } from '../support/paths.ts';

/** A real mount, so `list` has something to enumerate on its accepted cells. */
const MOUNT = repoPath('test/fixtures/configs/list-basic');

/** Commands whose invocation is incomplete without a plan, per the matrix. */
const PLAN_REQUIRED = new Set(['run', 'validate', 'report']);

const PLAN_FLAGS = new Set(['-e', '--plan']);

/**
 * What each flag needs after it to be a well-formed invocation. Deliberately
 * exhaustive rather than defaulted: a flag with no entry here would be driven
 * without its argument and fail for the wrong reason, so the guard below insists
 * the two agree.
 */
const SAMPLE: Record<string, readonly string[]> = {
  '-e': ['a-plan'],
  '--plan': ['a-plan'],
  '--preset': ['prod'],
  '--set': ['OWNER_ADDRESS=0x1'],
  '--overrides': ['overrides.yaml'],
  '--deployment-id': ['prod-1'],
  '--restart': [],
  '--refreeze': [],
  '-c': ['mainnet'],
  '--chain': ['mainnet'],
  '-xc': ['zksync'],
  '--exclude-chain': ['zksync'],
  '--chain-mode': ['parallel'],
  '--multisig': ['ops-main'],
  '--multisig-cancel': [],
  '--skip-verify': [],
  '--verify-only': [],
  '--dry-run': [],
  '--skip-preflight': [],
  '--repos-dir': ['repos'],
  '--cleanup': [],
  '-o': ['report.md'],
  '--output': ['report.md'],
  '--stdout': [],
  '--workflows': [],
  '--actions': [],
  '--plans': [],
  '--log-level': ['debug'],
  '-v': [],
  '--verbose': [],
  '-q': [],
  '--quiet': [],
  '-l': ['run.json'],
  '--log-file': ['run.json'],
  '--configs-dir': [MOUNT],
  '--ignore-version': [],
  '--results-dir': ['results'],
};

/**
 * `--multisig-cancel` cancels the proposals of a multisig deployment, so on its own
 * it is not an invocation the matrix is describing.
 */
const COMPANIONS: Record<string, readonly string[]> = {
  '--multisig-cancel': ['--multisig', 'ops-main'],
};

/** `--help` and `--version` are not per-command flags, so the matrix does not list them. */
const NOT_IN_MATRIX = new Set(['-h', '--help', '--version']);

/**
 * `-xc` is a two-character short flag, which commander refuses to declare; it
 * reaches the parser rewritten to its long form. So it is accepted — the cells
 * below prove that — without any command declaring it.
 */
const NORMALIZED = new Set<string>([EXCLUDE_CHAIN_SHORT_FLAG]);

function invoke(argv: readonly string[]): ExitCode {
  const captured = capture();

  return runCli(argv, {
    streams: captured.streams,
    openFile: captured.openFile,
    now: captured.now,
    color: false,
    cwd: '/repo',
    loadEnvFile: () => {},
  });
}

function argvFor(command: string, flag: string): readonly string[] {
  const argv = [command];

  if (PLAN_REQUIRED.has(command) && !PLAN_FLAGS.has(flag)) argv.push('-e', 'a-plan');
  // The flag under test supplies the mount when it is the mount flag.
  if (flag !== '--configs-dir') argv.push('--configs-dir', MOUNT);

  argv.push(...(COMPANIONS[flag] ?? []), flag, ...(SAMPLE[flag] ?? []));
  return argv;
}

function verdict(command: string, flag: string): 'accepted' | 'refused' {
  return invoke(argvFor(command, flag)) === ExitCode.Configuration ? 'refused' : 'accepted';
}

function unique(flags: readonly string[]): readonly string[] {
  return [...new Set(flags)].sort();
}

const matrix = flagMatrix();
const named = matrix.rows.flatMap((row) => row.flags);

describe('the flag matrix in cli.md', () => {
  it('[FR-CLI-001] has a column for each of the five commands the engine exposes', () => {
    expect(matrix.commands).toEqual([...COMMANDS]);
  });

  it('[FR-CLI-006] names every flag the commands declare, and no flag they do not', () => {
    const fromCode = [...declaredFlagsByCommand().values()]
      .flatMap((flags) => [...flags])
      .filter((flag) => !NOT_IN_MATRIX.has(flag));

    expect(unique(fromCode)).toEqual(unique(named.filter((flag) => !NORMALIZED.has(flag))));
  });

  it('is driven with an argument for every flag it names', () => {
    expect(unique(named)).toEqual(unique(Object.keys(SAMPLE)));
  });
});

describe('flags are validated per command', () => {
  for (const command of matrix.commands) {
    it(`[FR-CLI-006] ${command} accepts exactly the flags its column marks`, () => {
      const expected: Record<string, string> = {};
      const actual: Record<string, string> = {};

      for (const row of matrix.rows) {
        for (const flag of row.flags) {
          expected[flag] = row.accepted.get(command) === true ? 'accepted' : 'refused';
          actual[flag] = verdict(command, flag);
        }
      }

      expect(actual).toEqual(expected);
    });
  }
});

describe('the flags the matrix calls out as mistakes', () => {
  it('[FR-CLI-006] refuses status --multisig before anything is read', () => {
    expect(invoke(['status', '--multisig', 'ops-main'])).toBe(ExitCode.Configuration);
  });

  it('[FR-CLI-006] refuses report --restart before anything is read', () => {
    expect(invoke(['report', '-e', 'a-plan', '--restart'])).toBe(ExitCode.Configuration);
  });
});
