/**
 * The six errors of the command line itself, one case per row of the failure-mode
 * table in
 * [phase-1-invocation.md](../../../../docs/architecture/phase-1-invocation.md#failure-modes).
 *
 * Each case asserts the diagnostic code *and* the exit code together, because the
 * requirement has two halves: the invocation is refused, and it is refused for a
 * reason the closed set can name.
 */
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.ts';
import { ExitCode } from '../../src/contracts/index.ts';
import { parseInvocation } from '../../src/phases/phase-1/index.ts';
import { capture } from '../support/capture.ts';

function refusal(argv: readonly string[]): { readonly code: string; readonly exit: ExitCode } {
  const parsed = parseInvocation(argv);
  const captured = capture();

  const exit = runCli(argv, {
    streams: captured.streams,
    openFile: captured.openFile,
    now: captured.now,
    color: false,
    cwd: '/repo',
    loadEnvFile: () => {},
  });

  return {
    code:
      parsed.outcome.kind === 'refused'
        ? (parsed.outcome.diagnostics[0]?.code ?? 'refused with no diagnostic')
        : `not refused — ${parsed.outcome.kind}`,
    exit,
  };
}

const refused = (code: string): { readonly code: string; readonly exit: ExitCode } => ({
  code,
  exit: ExitCode.Configuration,
});

describe('an unknown command or flag', () => {
  it('[FR-CLI-001] refuses a command outside the five', () => {
    expect(refusal(['deploy'])).toEqual(refused('invocation.unknown-command-or-flag'));
  });

  it('[FR-CLI-006] refuses a misspelled flag rather than ignoring it', () => {
    expect(refusal(['run', '--pln', 'my-plan'])).toEqual(
      refused('invocation.unknown-command-or-flag'),
    );
  });

  it('[FR-CLI-006] refuses a stray argument', () => {
    expect(refusal(['list', 'extra'])).toEqual(refused('invocation.unknown-command-or-flag'));
  });
});

describe('a flag that belongs to another command', () => {
  it('[FR-CLI-006] tells status --multisig from a flag that does not exist', () => {
    expect(refusal(['status', '--multisig', 'ops-main'])).toEqual(
      refused('invocation.flag-not-for-command'),
    );
  });

  it('[FR-CLI-006] tells report --restart from a flag that does not exist', () => {
    expect(refusal(['report', '-e', 'my-plan', '--restart'])).toEqual(
      refused('invocation.flag-not-for-command'),
    );
  });

  it('[FR-CLI-006] refuses a run-only flag on list', () => {
    expect(refusal(['list', '--set', 'OWNER_ADDRESS=0x1'])).toEqual(
      refused('invocation.flag-not-for-command'),
    );
  });
});

describe('a value outside an enum', () => {
  it('[FR-RUN-002] refuses a chain mode the scale does not have', () => {
    expect(refusal(['run', '-e', 'my-plan', '--chain-mode', 'fastest'])).toEqual(
      refused('invocation.invalid-enum-value'),
    );
  });

  it('[FR-CLI-004] refuses a log level outside the scale', () => {
    expect(refusal(['run', '-e', 'my-plan', '--log-level', 'chatty'])).toEqual(
      refused('invocation.invalid-enum-value'),
    );
  });
});

describe('a malformed flag argument', () => {
  it('[FR-RUN-002] refuses a --set with no =', () => {
    expect(refusal(['run', '-e', 'my-plan', '--set', 'OWNER_ADDRESS'])).toEqual(
      refused('invocation.malformed-flag-argument'),
    );
  });

  it('[FR-RUN-002] refuses a --set key that fails the identifier rule', () => {
    expect(refusal(['run', '-e', 'my-plan', '--set', '1bad-key=x'])).toEqual(
      refused('invocation.malformed-flag-argument'),
    );
  });

  it('[FR-RUN-002] refuses a chain filter that names no chain', () => {
    expect(refusal(['run', '-e', 'my-plan', '--chain', ''])).toEqual(
      refused('invocation.malformed-flag-argument'),
    );
  });

  it('[FR-CLI-002] refuses a plan argument that names no plan', () => {
    expect(refusal(['validate', '-e', ''])).toEqual(refused('invocation.malformed-flag-argument'));
  });
});

describe('mutually exclusive flags', () => {
  it('[FR-RUN-002] refuses --chain together with --exclude-chain', () => {
    expect(refusal(['run', '-e', 'my-plan', '--chain', 'mainnet', '-xc', 'base'])).toEqual(
      refused('invocation.mutually-exclusive-flags'),
    );
  });

  it('[FR-RUN-002] refuses --skip-verify together with --verify-only', () => {
    expect(refusal(['run', '-e', 'my-plan', '--skip-verify', '--verify-only'])).toEqual(
      refused('invocation.mutually-exclusive-flags'),
    );
  });

  it('[FR-CLI-004] refuses -v together with --log-level, which set the same value', () => {
    expect(refusal(['run', '-e', 'my-plan', '-v', '--log-level', 'silent'])).toEqual(
      refused('invocation.mutually-exclusive-flags'),
    );
  });

  it('[FR-CLI-006] refuses -o together with --stdout, since one writes a file and the other does not', () => {
    expect(refusal(['report', '-e', 'my-plan', '-o', 'out.md', '--stdout'])).toEqual(
      refused('invocation.mutually-exclusive-flags'),
    );
  });
});

describe('a missing required flag', () => {
  it('[FR-CLI-006] refuses run without a plan', () => {
    expect(refusal(['run'])).toEqual(refused('invocation.missing-required-flag'));
  });

  it('[FR-CLI-006] refuses report without a plan', () => {
    expect(refusal(['report'])).toEqual(refused('invocation.missing-required-flag'));
  });

  it('[FR-CLI-006] refuses --multisig-cancel without the selector it cancels for', () => {
    expect(refusal(['run', '-e', 'my-plan', '--multisig-cancel'])).toEqual(
      refused('invocation.missing-required-flag'),
    );
  });

  it('[FR-CLI-006] accepts status without a plan, which reports the whole results tree', () => {
    const parsed = parseInvocation(['status']);

    expect(parsed.outcome.kind).toBe('context');
  });
});

describe('nothing is loaded and nothing is written', () => {
  it('[FR-RUN-002] refuses before opening the config mount', () => {
    const captured = capture();
    const opened: string[] = [];

    const exit = runCli(['run', '--chain-mode', 'fastest'], {
      streams: captured.streams,
      color: false,
      cwd: '/repo',
      loadEnvFile: (path) => opened.push(path),
    });

    expect(exit).toBe(ExitCode.Configuration);
    expect(opened).toEqual([]);
  });

});

describe('the report a refusal carries', () => {
  /**
   * Only rules the *constructor* owns can accumulate: commander stops at the first
   * flag it cannot parse, which is why `--chain-mode fastest` above is a single
   * diagnostic and these three are not.
   */
  it('[FR-RUN-002] names every rule the parameters broke, not only the first', () => {
    const parsed = parseInvocation([
      'run',
      '-e',
      'my-plan',
      '--set',
      'OWNER_ADDRESS',
      '--skip-verify',
      '--verify-only',
      '--multisig-cancel',
    ]);

    const codes =
      parsed.outcome.kind === 'refused' ? parsed.outcome.diagnostics.map((d) => d.code) : [];

    expect([...codes].sort()).toEqual([
      'invocation.malformed-flag-argument',
      'invocation.missing-required-flag',
      'invocation.mutually-exclusive-flags',
    ]);
  });

  it('[FR-RUN-002] attributes every phase-1 diagnostic to phase 1', () => {
    const parsed = parseInvocation(['run', '-e', 'my-plan', '--chain', '']);
    const phases =
      parsed.outcome.kind === 'refused' ? parsed.outcome.diagnostics.map((d) => d.phase) : [];

    expect(phases).toEqual([1]);
  });
});
