/**
 * The one argv rewrite: `-xc` into `--exclude-chain`.
 *
 * The spec spells the flag `-xc, --exclude-chain` and commander refuses a
 * two-character short flag, so the translation happens before the parser sees
 * argv. What matters is that it translates *that token* and nothing else — a
 * rewrite that reached into operands, or invented `-x` and `--xc` along the way,
 * would be accepting spellings the spec never described.
 */
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.ts';
import { ExitCode } from '../../src/contracts/index.ts';
import { normalizeArgv, parseInvocation } from '../../src/phases/phase-1/index.ts';
import { capture } from '../support/capture.ts';

function exitOf(argv: readonly string[]): ExitCode {
  const captured = capture();

  return runCli(argv, {
    streams: captured.streams,
    color: false,
    loadEnvFile: () => {},
  });
}

function scope(argv: readonly string[]): unknown {
  const parsed = parseInvocation(argv);
  return parsed.outcome.kind === 'context' && 'chainScope' in parsed.outcome.context
    ? parsed.outcome.context.chainScope
    : parsed.outcome.kind;
}

describe('the -xc rewrite', () => {
  it('[FR-RUN-002] translates the separated form', () => {
    expect(normalizeArgv(['run', '-xc', 'zksync'])).toEqual(['run', '--exclude-chain', 'zksync']);
  });

  it('[FR-RUN-002] translates the attached form, keeping the value intact', () => {
    expect(normalizeArgv(['run', '-xc=zksync,matic'])).toEqual([
      'run',
      '--exclude-chain=zksync,matic',
    ]);
  });

  it('[FR-RUN-002] leaves every other token exactly as it was', () => {
    const argv = ['run', '-e', 'my-plan', '-c', 'mainnet', '--dry-run'];

    expect(normalizeArgv(argv)).toEqual(argv);
  });

  it('[FR-RUN-002] stops at the argv terminator, past which nothing is a flag', () => {
    expect(normalizeArgv(['run', '--', '-xc'])).toEqual(['run', '--', '-xc']);
  });

  it('[FR-RUN-002] reaches the same chain scope as the long form', () => {
    const short = scope(['run', '-e', 'my-plan', '-xc', 'zksync,matic']);

    expect(short).toEqual({ kind: 'exclude', chains: ['zksync', 'matic'] });
    expect(short).toEqual(scope(['run', '-e', 'my-plan', '--exclude-chain', 'zksync,matic']));
  });

  it('[FR-CLI-006] invents no other spelling of the flag', () => {
    expect(exitOf(['run', '-e', 'my-plan', '-x', 'zksync'])).toBe(ExitCode.Configuration);
    expect(exitOf(['run', '-e', 'my-plan', '--xc', 'zksync'])).toBe(ExitCode.Configuration);
  });
});
