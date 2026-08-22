import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.ts';
import { ExitCode } from '../src/contracts/index.ts';
import { capture } from './support/capture.ts';

function invoke(argv: readonly string[]) {
  const captured = capture();
  const code = runCli(argv, {
    streams: captured.streams,
    openFile: captured.openFile,
    now: captured.now,
    color: false,
    cwd: '/repo',
    loadEnvFile: () => {},
  });
  return { code, captured };
}

describe('deploy-pad', () => {
  it('[FR-CLI-005] prints its help and succeeds', () => {
    const { code, captured } = invoke(['--help']);

    expect(code).toBe(ExitCode.Success);
    expect(captured.out()).toContain('Usage: deploy-pad');
  });

  it('[FR-CLI-005] reports the engine version and the config format it speaks', () => {
    const { code, captured } = invoke(['--version']);

    expect(code).toBe(ExitCode.Success);
    expect(captured.out()).toMatch(/^deploy-pad \d+\.\d+\.\d+ \(config format 2\)\n$/u);
  });

  it('[FR-CLI-005] refuses an invocation with no command', () => {
    const { code, captured } = invoke([]);

    expect(code).toBe(ExitCode.Configuration);
    expect(captured.err()).toContain('error: no command given');
  });

  it('[FR-CLI-005] refuses an unknown flag rather than ignoring it', () => {
    const { code, captured } = invoke(['--no-such-flag']);

    expect(code).toBe(ExitCode.Configuration);
    expect(captured.err()).toContain("unknown option '--no-such-flag'");
  });

  it('[FR-CLI-005] refuses a stray argument', () => {
    const { code } = invoke(['unexpected']);

    expect(code).toBe(ExitCode.Configuration);
  });
});

describe('the common logging flags', () => {
  it('[FR-CLI-004] rejects a --log-level outside the scale', () => {
    const { code, captured } = invoke(['--log-level', 'chatty']);

    expect(code).toBe(ExitCode.Configuration);
    expect(captured.err()).toContain("'chatty'");
  });

  it('[FR-CLI-004] refuses -v together with -q, which set the same value', () => {
    const { code, captured } = invoke(['-v', '-q']);

    expect(code).toBe(ExitCode.Configuration);
    expect(captured.err()).toContain('pass at most one');
  });

  it('[FR-CLI-004] refuses -v together with --log-level', () => {
    const { code } = invoke(['-v', '--log-level', 'debug']);

    expect(code).toBe(ExitCode.Configuration);
  });

  it('[FR-CLI-004] prints nothing at all at --log-level silent, exit code carrying the outcome', () => {
    const { code, captured } = invoke(['--log-level', 'silent']);

    expect(code).toBe(ExitCode.Configuration);
    expect(captured.out()).toBe('');
    expect(captured.err()).toBe('');
  });

  it('[FR-CLI-004] -v turns on debug detail', () => {
    const { captured } = invoke(['-v']);

    expect(captured.out()).toContain('debug: ');
  });

  it('[FR-CLI-004] -q holds everything but errors back', () => {
    const { captured } = invoke(['-q']);

    expect(captured.err()).toContain('error: no command given');
    expect(captured.out()).toBe('');
  });

  it('[FR-CLI-004] writes the structured sink at full debug detail while the console is silent', () => {
    const { captured } = invoke(['--log-level', 'silent', '-l', 'run.json']);

    expect(captured.logFilePath()).toBe('run.json');
    expect(captured.out()).toBe('');
    expect(captured.records()).toEqual(
      expect.arrayContaining([expect.objectContaining({ level: 'debug' })]),
    );
  });
});

describe('the environment wrapper', () => {
  it('[FR-CLI-003] reports the file it looked for under the mounted config directory', () => {
    const captured = capture();
    const loaded: string[] = [];

    runCli(['-v', '--configs-dir', 'other/configs'], {
      streams: captured.streams,
      color: false,
      cwd: '/repo',
      loadEnvFile: (path) => loaded.push(path),
    });

    expect(captured.out()).toContain('/repo/other/configs/.env');
    expect(loaded).toEqual([]);
  });
});
