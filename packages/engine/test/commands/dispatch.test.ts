/**
 * The five commands, and what the four without a pipeline do.
 *
 * S1's goal is that every invocation is either accepted into a run context or
 * refused with exit `1`. These cases are the accepting half: each command reaches
 * dispatch, and the four whose phases have not landed say so instead of pretending.
 */
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.ts';
import { COMMANDS, ExitCode } from '../../src/contracts/index.ts';
import { repoPath } from '../../../../test/support/paths.ts';
import { capture, type Captured } from '../support/capture.ts';

const MOUNT = repoPath('test/fixtures/configs/list-basic');

/** A complete, valid invocation of each command — the minimum each one needs. */
const INVOCATIONS: Record<string, readonly string[]> = {
  run: ['run', '-e', 'escrow'],
  validate: ['validate', '-e', 'escrow'],
  status: ['status'],
  report: ['report', '-e', 'escrow'],
  list: ['list'],
};

function invoke(argv: readonly string[]): { readonly exit: ExitCode; readonly captured: Captured } {
  const captured = capture();

  const exit = runCli([...argv, '--configs-dir', MOUNT], {
    streams: captured.streams,
    openFile: captured.openFile,
    now: captured.now,
    color: false,
    loadEnvFile: () => {},
  });

  return { exit, captured };
}

describe('the command surface', () => {
  it('[FR-CLI-001] exposes five commands, and accepts a complete invocation of each', () => {
    expect(Object.keys(INVOCATIONS).sort()).toEqual([...COMMANDS].sort());

    for (const [command, argv] of Object.entries(INVOCATIONS)) {
      expect(invoke(argv).exit, command).toBe(ExitCode.Success);
    }
  });

  it('[FR-CLI-001] describes every command in its help', () => {
    const { captured } = invoke(['--help']);

    for (const command of COMMANDS) expect(captured.out()).toContain(command);
  });
});

describe('a command whose phases have not landed', () => {
  for (const command of ['run', 'validate', 'status', 'report'] as const) {
    it(`[FR-RUN-002] ${command} accepts the invocation and warns that nothing ran`, () => {
      const { exit, captured } = invoke(INVOCATIONS[command] ?? []);

      expect(exit).toBe(ExitCode.Success);
      expect(captured.err()).toContain(`warning: ${command} is not implemented yet`);
    });
  }

  it('[FR-RUN-002] shows the run context it assembled at debug level', () => {
    const { captured } = invoke(['run', '-e', 'escrow', '--preset', 'prod', '-xc', 'zksync', '-v']);

    expect(captured.out()).toContain('debug: run context');
    expect(captured.out()).toContain('"presetRequest":"prod"');
    expect(captured.out()).toContain('"chainScope":{"kind":"exclude","chains":["zksync"]}');
  });

  it('[FR-RUN-002] says nothing about an unimplemented command at --log-level silent', () => {
    const { exit, captured } = invoke(['run', '-e', 'escrow', '--log-level', 'silent']);

    expect(exit).toBe(ExitCode.Success);
    expect(captured.out()).toBe('');
    expect(captured.err()).toBe('');
  });
});
