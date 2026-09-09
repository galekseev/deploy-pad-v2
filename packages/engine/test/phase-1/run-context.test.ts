/**
 * The run context, built by hand.
 *
 * NFR-060 requires that constructing invocation parameters directly bypass no
 * validation: the checks that apply to a parsed command line apply identically to
 * programmatically supplied ones. So these cases never go near argv — they call
 * the constructors, which is where the consistency rules live precisely so that
 * this path cannot skip them ([artifacts.md §1](../../../../docs/implementation/artifacts.md#1-runcontext)).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHAIN_MODE,
  DEFAULT_CONFIGS_DIR,
  DEFAULT_REPOS_DIR,
  DEFAULT_RESULTS_DIR,
} from '../../src/contracts/index.ts';
import {
  listContext,
  reportContext,
  resolvePlanPath,
  runContext,
  statusContext,
  validateContext,
} from '../../src/phases/phase-1/index.ts';

function codes(result: { readonly ok: boolean } & Record<string, unknown>): readonly string[] {
  if (result.ok) return [];
  return (result['diagnostics'] as readonly { readonly code: string }[]).map((d) => d.code);
}

describe('a context built without argv', () => {
  it('[NFR-060] carries the defaults of every root the invocation did not name', () => {
    const result = runContext({ plan: 'my-plan' });

    expect(result.ok && result.context).toMatchObject({
      command: 'run',
      configsDir: DEFAULT_CONFIGS_DIR,
      reposDir: DEFAULT_REPOS_DIR,
      resultsDir: DEFAULT_RESULTS_DIR,
      chainMode: DEFAULT_CHAIN_MODE,
      chainScope: { kind: 'all' },
      sender: { mode: 'eoa' },
      verification: 'default',
      ignoreVersion: false,
      logFile: null,
    });
  });

  it('[NFR-060] is frozen through every nested field, not only at the top', () => {
    const result = runContext({ plan: 'my-plan', chains: 'mainnet,base', sets: ['OWNER=0x1'] });
    if (!result.ok) throw new Error(codes(result).join(', '));

    const context = result.context;
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.plan)).toBe(true);
    expect(Object.isFrozen(context.chainScope)).toBe(true);
    expect(Object.isFrozen(context.overrides.sets)).toBe(true);
    expect(Object.isFrozen(context.overrides.sets[0])).toBe(true);
  });

  it('[NFR-060] accepts a chain list already split, as a caller with no command line would give it', () => {
    const result = runContext({ plan: 'my-plan', chains: ['mainnet', 'base'] });

    expect(result.ok && result.context.chainScope).toEqual({
      kind: 'include',
      chains: ['mainnet', 'base'],
    });
  });
});

describe('the consistency rules hold however the context was built', () => {
  it('[NFR-060] refuses a chain mode outside the enum', () => {
    expect(codes(runContext({ plan: 'my-plan', chainMode: 'fastest' }))).toEqual([
      'invocation.invalid-enum-value',
    ]);
  });

  it('[NFR-060] refuses a console level outside the scale', () => {
    expect(codes(listContext({ consoleLevel: 'chatty' }))).toEqual([
      'invocation.invalid-enum-value',
    ]);
  });

  it('[NFR-060] refuses an override key that fails the identifier rule', () => {
    expect(codes(runContext({ plan: 'my-plan', sets: ['1bad-key=x'] }))).toEqual([
      'invocation.malformed-flag-argument',
    ]);
  });

  it('[FR-RUN-002] splits an override at the first = only, since a value may contain more', () => {
    const result = runContext({ plan: 'my-plan', sets: ['URL=https://host/?a=b&c=d'] });

    expect(result.ok && result.context.overrides.sets).toEqual([
      { key: 'URL', value: 'https://host/?a=b&c=d' },
    ]);
  });

  it('[FR-RUN-002] accepts an empty override value, which is how a key is deliberately emptied', () => {
    const result = runContext({ plan: 'my-plan', sets: ['OWNER_ADDRESS='] });

    expect(result.ok && result.context.overrides.sets).toEqual([
      { key: 'OWNER_ADDRESS', value: '' },
    ]);
  });

  it('[NFR-060] refuses a chain scope that names nothing', () => {
    expect(codes(runContext({ plan: 'my-plan', chains: [] }))).toEqual([
      'invocation.malformed-flag-argument',
    ]);
  });

  it('[NFR-060] refuses both chain filters at once, which the artifact cannot represent', () => {
    expect(
      codes(runContext({ plan: 'my-plan', chains: 'mainnet', excludeChains: 'base' })),
    ).toEqual(['invocation.mutually-exclusive-flags']);
  });

  it('[NFR-060] refuses a missing plan', () => {
    expect(codes(runContext({}))).toEqual(['invocation.missing-required-flag']);
  });

  it('[NFR-060] refuses a cancellation with no multisig entry to cancel for', () => {
    expect(codes(runContext({ plan: 'my-plan', multisigCancel: true }))).toEqual([
      'invocation.missing-required-flag',
    ]);
  });
});

describe('the run context payloads mirror the flag matrix', () => {
  it('[FR-RUN-002] fixes every run parameter that lives outside a config file', () => {
    const result = runContext({
      plan: 'plans/one-off.yaml',
      preset: 'prod',
      sets: ['OWNER_ADDRESS=0x1', 'TAG=v2'],
      overridesFile: 'overrides.yaml',
      deploymentId: 'prod-3',
      restart: true,
      refreeze: true,
      excludeChains: 'zksync, matic',
      chainMode: 'parallel',
      multisig: 'ops-main',
      multisigCancel: true,
      verifyOnly: true,
      dryRun: true,
      skipPreflight: true,
      cleanup: true,
      reposDir: 'repos',
      resultsDir: 'results',
      configsDir: 'configs',
      ignoreVersion: true,
      logFile: 'run.json',
      consoleLevel: 'debug',
    });
    if (!result.ok) throw new Error(codes(result).join(', '));

    expect(result.context).toEqual({
      command: 'run',
      console: { level: 'debug' },
      logFile: 'run.json',
      configsDir: 'configs',
      ignoreVersion: true,
      plan: { input: 'plans/one-off.yaml', path: 'plans/one-off.yaml' },
      presetRequest: 'prod',
      overrides: {
        sets: [
          { key: 'OWNER_ADDRESS', value: '0x1' },
          { key: 'TAG', value: 'v2' },
        ],
        file: 'overrides.yaml',
      },
      identity: { deploymentIdRequest: 'prod-3', restart: true, refreeze: true },
      // Trimmed, because the flag takes a comma-separated list a human typed.
      chainScope: { kind: 'exclude', chains: ['zksync', 'matic'] },
      chainMode: 'parallel',
      sender: { mode: 'multisig', entry: 'ops-main', cancel: true },
      verification: 'only',
      dryRun: true,
      skipPreflight: true,
      cleanup: true,
      reposDir: 'repos',
      resultsDir: 'results',
    });
  });

  it('[FR-RUN-002] gives validate no deployment identity and no results directory', () => {
    const result = validateContext({ plan: 'my-plan', preset: 'prod', multisig: 'ops-main' });
    if (!result.ok) throw new Error(codes(result).join(', '));

    expect(Object.keys(result.context).sort()).toEqual([
      'chainScope',
      'command',
      'configsDir',
      'console',
      'ignoreVersion',
      'logFile',
      'multisigEntry',
      'plan',
      'presetRequest',
    ]);
  });

  it('[FR-RUN-002] lets status carry no plan at all', () => {
    const result = statusContext({});

    expect(result.ok && result.context.plan).toBeNull();
  });

  // FR-CLI-030 and FR-CLI-031 are deliberately not named here: what these cases
  // prove is the shape phase 1 hands over, not what `status` and `report` do with
  // it, and S6 delivers that. A claim earned by a test that never ran the
  // behaviour is worse than no claim.
  it("[FR-RUN-002] leaves report's default output path to the phase that knows it", () => {
    const bare = reportContext({ plan: 'my-plan' });
    const toFile = reportContext({ plan: 'my-plan', output: 'out.md' });
    const toStdout = reportContext({ plan: 'my-plan', stdout: true });

    expect(bare.ok && bare.context.output).toEqual({ kind: 'default' });
    expect(toFile.ok && toFile.context.output).toEqual({ kind: 'file', path: 'out.md' });
    expect(toStdout.ok && toStdout.context.output).toEqual({ kind: 'stdout' });
  });

  it('[FR-CLI-032] turns every list filter on when none is given', () => {
    const none = listContext({});
    const one = listContext({ actions: true });

    expect(none.ok && none.context.filters).toEqual({
      workflows: true,
      actions: true,
      plans: true,
    });
    expect(one.ok && one.context.filters).toEqual({
      workflows: false,
      actions: true,
      plans: false,
    });
  });
});

describe('the plan argument rule', () => {
  it('[FR-CLI-002] resolves a short name into the mount plans directory', () => {
    expect(resolvePlanPath('my-plan', 'workspace/configs')).toBe(
      'workspace/configs/plans/my-plan.yaml',
    );
  });

  it('[FR-CLI-002] tolerates a trailing .yaml on a short name rather than doubling it', () => {
    expect(resolvePlanPath('my-plan.yaml', 'workspace/configs')).toBe(
      'workspace/configs/plans/my-plan.yaml',
    );
  });

  it('[FR-CLI-002] tolerates a trailing .yml the same way, without changing the target', () => {
    expect(resolvePlanPath('my-plan.yml', 'workspace/configs')).toBe(
      'workspace/configs/plans/my-plan.yaml',
    );
  });

  it('[FR-CLI-002] uses a path as-is, never under the mount', () => {
    expect(resolvePlanPath('experiments/one-off.yaml', 'workspace/configs')).toBe(
      'experiments/one-off.yaml',
    );
  });

  it('[FR-CLI-002] follows the mounted config directory', () => {
    expect(resolvePlanPath('my-plan', 'other/configs')).toBe('other/configs/plans/my-plan.yaml');
  });

  it('[FR-CLI-002] records the argument as typed alongside the path it resolved to', () => {
    const result = runContext({ plan: 'my-plan.yml' });

    expect(result.ok && result.context.plan).toEqual({
      input: 'my-plan.yml',
      path: 'workspace/configs/plans/my-plan.yaml',
    });
  });
});
