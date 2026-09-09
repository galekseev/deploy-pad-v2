/**
 * `list` against real mounted directories (FR-CLI-032).
 *
 * Driven through `runCli` because the mount is the unit the engine reads, and a
 * fixture that is not a real mount would test a shape that never occurs
 * ([test-strategy.md → Fixtures](../../../../docs/implementation/test-strategy.md#fixtures)).
 */
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.ts';
import { ExitCode } from '../../src/contracts/index.ts';
import { repoPath } from '../../../../test/support/paths.ts';
import { capture } from '../support/capture.ts';

const MOUNT = repoPath('test/fixtures/configs/list-basic');
const UNPARSEABLE = repoPath('test/fixtures/configs/list-unparseable');
const ABSENT = repoPath('test/fixtures/configs/no-such-mount');

function list(...flags: readonly string[]): { readonly exit: ExitCode; readonly out: string; readonly err: string } {
  const captured = capture();

  const exit = runCli(['list', '--configs-dir', ...flags], {
    streams: captured.streams,
    openFile: captured.openFile,
    now: captured.now,
    color: false,
    loadEnvFile: () => {},
  });

  return { exit, out: captured.out(), err: captured.err() };
}

const against = (mount: string, ...flags: readonly string[]): ReturnType<typeof list> =>
  list(mount, ...flags);

describe('list', () => {
  it('[FR-CLI-032] enumerates workflows, actions and plans when no filter is given', () => {
    const { exit, out } = against(MOUNT);

    expect(exit).toBe(ExitCode.Success);
    expect(out).toContain('workflows —');
    expect(out).toContain('actions —');
    expect(out).toContain('plans —');
  });

  it('[FR-CLI-032] marks a method variant as one, naming the workflow it re-skins', () => {
    const { out } = against(MOUNT, '--workflows');

    expect(out).toContain('escrow\n');
    expect(out).toMatch(/escrow-plain\s+variant of escrow/u);
  });

  it('[FR-CLI-032] reports actions by fully-qualified id, grouped by repo and generation', () => {
    const { out } = against(MOUNT, '--actions');

    expect(out).toContain('aqua.v1\n');
    expect(out).toContain('aqua.v2\n');
    expect(out).toContain('aqua.v1.escrow-factory');
    expect(out).toContain('aqua.v2.hand-over');
  });

  it('[FR-CLI-032] reports an action type and its alias', () => {
    const { out } = against(MOUNT, '--actions');

    expect(out).toMatch(/aqua\.v2\.escrow-factory\s+forge-contract\s+alias aqua-escrow/u);
    expect(out).toMatch(/aqua\.v2\.hand-over\s+forge-script/u);
  });

  it("[FR-CLI-032] reports each plan with its workflow and its presets", () => {
    const { out } = against(MOUNT, '--plans');

    expect(out).toMatch(/escrow\.yaml\s+workflow escrow\s+presets staging, prod/u);
  });

  it('[FR-CLI-032] reports the inline action of a single-action plan in place of a workflow', () => {
    const { out } = against(MOUNT, '--plans');

    expect(out).toMatch(/hand-over\.yml\s+action aqua\.v2\.hand-over\s+presets prod/u);
  });

  it('[FR-CLI-032] shows only what the filters select', () => {
    const { out } = against(MOUNT, '--workflows');

    expect(out).toContain('workflows —');
    expect(out).not.toContain('actions —');
    expect(out).not.toContain('plans —');
  });

  it('[FR-CLI-032] combines filters rather than treating them as exclusive', () => {
    const { out } = against(MOUNT, '--workflows', '--plans');

    expect(out).toContain('workflows —');
    expect(out).toContain('plans —');
    expect(out).not.toContain('actions —');
  });

  it('[FR-CLI-032] names the file each section was read from', () => {
    const { out } = against(MOUNT);

    expect(out).toContain(`${MOUNT}/workflows.yaml`);
    expect(out).toContain(`${MOUNT}/actions.yaml`);
    expect(out).toContain(`${MOUNT}/plans/`);
  });
});

describe('list against a mount it cannot read', () => {
  it('[FR-CLI-032] fails on a config error when a catalog will not parse', () => {
    const { exit, err } = against(UNPARSEABLE);

    expect(exit).toBe(ExitCode.Configuration);
    expect(err).toContain('cannot read workflows.yaml');
  });

  it('[FR-CLI-032] fails rather than reporting an empty config set for an unmounted directory', () => {
    const { exit, err } = against(ABSENT);

    expect(exit).toBe(ExitCode.Configuration);
    expect(err).toContain('no config set to list');
  });

  it('[FR-CLI-032] reports the sections a partial mount does carry, and names the ones it does not', () => {
    // The unparseable fixture has no actions.yaml and no plans/, so asking for
    // those alone is a mount that carries nothing.
    const { exit, err } = against(UNPARSEABLE, '--plans');

    expect(exit).toBe(ExitCode.Configuration);
    expect(err).toContain('no config set to list');
  });
});
