import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIGS_DIR } from '../src/contracts/index.ts';
import { envFilePath, loadWorkspaceEnv } from '../src/cross/env-file.ts';

describe('the invocation wrapper', () => {
  it('[FR-CLI-003] sources the config mount .env into the environment', () => {
    const loaded: string[] = [];

    const outcome = loadWorkspaceEnv(DEFAULT_CONFIGS_DIR, {
      cwd: '/repo',
      exists: () => true,
      load: (path) => loaded.push(path),
    });

    expect(outcome).toEqual({ path: '/repo/workspace/configs/.env', loaded: true });
    expect(loaded).toEqual(['/repo/workspace/configs/.env']);
  });

  it('[FR-CLI-003] carries on without one, since CI exports the variables instead', () => {
    let calls = 0;

    const outcome = loadWorkspaceEnv(DEFAULT_CONFIGS_DIR, {
      cwd: '/repo',
      exists: () => false,
      load: () => {
        calls += 1;
      },
    });

    expect(outcome).toEqual({ path: '/repo/workspace/configs/.env', loaded: false });
    expect(calls).toBe(0);
  });

  it('[FR-CLI-003] follows the mounted config directory', () => {
    const outcome = loadWorkspaceEnv('fixtures/mount', {
      cwd: '/repo',
      exists: () => true,
      load: () => {},
    });

    expect(outcome.path).toBe('/repo/fixtures/mount/.env');
  });

  it('accepts an absolute config directory as given', () => {
    expect(envFilePath('/mnt/configs', '/repo')).toBe('/mnt/configs/.env');
  });
});
