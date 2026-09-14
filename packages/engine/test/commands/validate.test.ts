/**
 * `validate` and `run` against real mounts — the level where the two reporting
 * modes are visible.
 *
 * The pair of them is the point: the gates are identical, so the only thing these
 * cases can be measuring is the difference between accumulating a report and
 * stopping at the first failing file. Testing either alone would prove the gates
 * and miss the contract.
 */
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.ts';
import { ExitCode } from '../../src/contracts/index.ts';
import { repoPath } from '../../../../test/support/paths.ts';
import { capture } from '../support/capture.ts';

const COMPLETE = repoPath('test/fixtures/configs/valid');
/** workflows.yaml declares format 1; global-params.yaml has a section no schema knows. */
const BROKEN = repoPath('test/fixtures/configs/stale-and-broken');
/** A workflows-only mount — trimmed, which is also what makes it an allowlist case. */
const ANCHORS = repoPath('test/fixtures/configs/yaml-anchors');
const UNPARSEABLE = repoPath('test/fixtures/configs/unparseable');
/** Valid throughout, except that workflows.yaml declares no version at all. */
const NO_VERSION = repoPath('test/fixtures/configs/no-version');

interface Outcome {
  readonly exit: ExitCode;
  readonly out: string;
  readonly err: string;
}

function invoke(...argv: readonly string[]): Outcome {
  const captured = capture();

  const exit = runCli(argv, {
    streams: captured.streams,
    openFile: captured.openFile,
    now: captured.now,
    color: false,
    loadEnvFile: () => {},
  });

  return { exit, out: captured.out(), err: captured.err() };
}

describe('validate against a config set that is right', () => {
  it('[FR-CLI-021] exits 0 and says so', () => {
    const { exit, out } = invoke('validate', '-e', 'escrow', '--configs-dir', COMPLETE);

    expect(exit).toBe(ExitCode.Success);
    expect(out).toContain('loads and matches its schema');
  });

  it('[FR-CLI-021] exits 0 in multisig mode too, where the registry joins the set', () => {
    const { exit } = invoke(
      'validate',
      '-e',
      'escrow',
      '--multisig',
      'ops-main',
      '--configs-dir',
      COMPLETE,
    );

    expect(exit).toBe(ExitCode.Success);
  });
});

describe('validate against a config set that is wrong', () => {
  it('[NFR-022] reports every failing file, not only the first', () => {
    const { err } = invoke('validate', '-e', 'escrow', '--ignore-version', '--configs-dir', BROKEN);

    expect(err).toContain('workflows.yaml');
    expect(err).toContain('global-params.yaml');
  });

  it('[FR-CLI-021] exits 1 for a file it could not understand', () => {
    const { exit, err } = invoke('validate', '-e', 'escrow', '--configs-dir', BROKEN);

    expect(exit).toBe(ExitCode.Configuration);
    expect(err).toContain('declares config version 1');
  });

  it('[FR-CLI-021] exits 2 for a file it read and found wrong', () => {
    const { exit, err } = invoke('validate', '-e', 'escrow', '--ignore-version', '--configs-dir', BROKEN);

    expect(exit).toBe(ExitCode.Validation);
    expect(err).toContain('has an unknown property "notASection"');
  });

  it('[FR-CLI-021] exits 1 when the plan the invocation named is not there', () => {
    const { exit, err } = invoke('validate', '-e', 'no-such-plan', '--configs-dir', COMPLETE);

    expect(exit).toBe(ExitCode.Configuration);
    expect(err).toContain('no plan at');
  });

  it('[FR-CFG-011] refuses a file that reuses through YAML anchors', () => {
    const { exit, err } = invoke('list', '--workflows', '--configs-dir', ANCHORS);

    expect(exit).toBe(ExitCode.Validation);
    expect(err).toContain('anchor');
    expect(err).toContain('alias');
  });

  it('[FR-CFG-010] refuses a file that is not readable as YAML', () => {
    const { exit, err } = invoke('list', '--workflows', '--configs-dir', UNPARSEABLE);

    expect(exit).toBe(ExitCode.Configuration);
    expect(err).toContain('is not readable as YAML');
  });
});

describe('the mount is the allowlist', () => {
  it('[FR-CFG-015] reads the config set from the directory the invocation named', () => {
    // The same plan name against two mounts is two different answers, which is
    // what "a single mounted directory" has to mean to be worth stating.
    const complete = invoke('validate', '-e', 'escrow', '--configs-dir', COMPLETE);
    const elsewhere = invoke('validate', '-e', 'escrow', '--configs-dir', NO_VERSION);

    expect(complete.out).not.toContain('declares no version key');
    expect(elsewhere.out).toContain('declares no version key');
  });

  it('[FR-CFG-015] refuses a trimmed mount rather than reaching outside it for what is missing', () => {
    // A workflows-only directory. There is a perfectly good actions.yaml one
    // level up in the fixtures tree, and the engine does not go and get it.
    const { exit, err } = invoke('validate', '-e', 'escrow', '--configs-dir', ANCHORS);

    expect(exit).toBe(ExitCode.Configuration);
    expect(err).toContain('no actions.yaml under');
    expect(err).toContain('the mount is the allowlist');
  });
});

describe('--ignore-version relaxes the version gate and nothing else', () => {
  it('[FR-CFG-014] turns the mismatch into a warning', () => {
    const { err } = invoke('validate', '-e', 'escrow', '--ignore-version', '--configs-dir', BROKEN);

    expect(err).toContain('proceeding because --ignore-version was passed');
  });

  it('[FR-CFG-014] leaves the schema violation in another file untouched', () => {
    const relaxed = invoke('validate', '-e', 'escrow', '--ignore-version', '--configs-dir', BROKEN);

    // Still a failure, and still the schema's — which is the whole claim: the
    // flag moved one gate's verdict, not the outcome.
    expect(relaxed.exit).toBe(ExitCode.Validation);
    expect(relaxed.err).toContain('notASection');
  });
});

describe('the two reporting modes', () => {
  it('[NFR-022] validate collects every error across the set', () => {
    const { err } = invoke('validate', '-e', 'escrow', '--configs-dir', BROKEN);

    expect(err).toContain('workflows.yaml');
    expect(err).toContain('global-params.yaml');
    expect(err).toContain('2 errors');
  });

  it('[FR-RUN-002] run stops at the first failing file', () => {
    const { exit, err } = invoke('run', '-e', 'escrow', '--configs-dir', BROKEN);

    expect(exit).toBe(ExitCode.Configuration);
    expect(err).toContain('workflows.yaml');
    // A run is heading toward on-chain state, so it never got as far as the file
    // that `validate` went on to check.
    expect(err).not.toContain('global-params.yaml');
    expect(err).toContain('1 error');
  });

  it('[FR-RUN-002] run reaches past the gates when the set is right', () => {
    const { exit, err } = invoke('run', '-e', 'escrow', '--configs-dir', COMPLETE);

    expect(exit).toBe(ExitCode.Success);
    expect(err).toContain('not implemented past config loading yet');
  });
});

describe('warnings', () => {
  it('[FR-CLI-021] are printed but never fail validation', () => {
    const { exit, out, err } = invoke('validate', '-e', 'escrow', '--configs-dir', NO_VERSION);

    expect(exit).toBe(ExitCode.Success);
    // On stdout, not stderr: nothing failed, so nothing belongs on the stream a
    // caller reads when something did.
    expect(out).toContain('declares no version key');
    expect(out).toContain('0 errors, 1 warning');
    expect(out).toContain('loads and matches its schema');
    expect(err).toBe('');
  });

  it('[FR-CFG-013] an absent version stays a warning even under --ignore-version', () => {
    const { exit, out } = invoke(
      'validate',
      '-e',
      'escrow',
      '--ignore-version',
      '--configs-dir',
      NO_VERSION,
    );

    expect(exit).toBe(ExitCode.Success);
    expect(out).toContain('declares no version key');
  });

  it('[FR-CLI-021] do not stop a run either', () => {
    const { exit, err } = invoke('run', '-e', 'escrow', '--configs-dir', NO_VERSION);

    expect(exit).toBe(ExitCode.Success);
    expect(err).toContain('not implemented past config loading yet');
  });
});
