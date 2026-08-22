import { describe, expect, it } from 'vitest';
import { SecretRegistry } from '../../src/cross/logging/index.ts';

describe('the secret registry', () => {
  it('[NFR-003] substitutes a registered value wherever it appears in a string', () => {
    const registry = new SecretRegistry();
    registry.register('0xdeadbeefkey', '[vault.deployer]');

    expect(registry.redactText('signing with 0xdeadbeefkey now')).toBe(
      'signing with [vault.deployer] now',
    );
  });

  it('[NFR-003] renders a vault-sourced fragment as its label, leaving the rest readable', () => {
    const registry = new SecretRegistry();
    registry.register('s3cr3t-alchemy-key', '[vault.alchemyKey]');

    expect(registry.redactText('https://eth-mainnet.g.alchemy.com/v2/s3cr3t-alchemy-key')).toBe(
      'https://eth-mainnet.g.alchemy.com/v2/[vault.alchemyKey]',
    );
  });

  it('[NFR-003] renders a direct-env or literal secret as a placeholder naming its slot', () => {
    const registry = new SecretRegistry();
    registry.register('literal-private-key', '[redacted: privateKey]');

    expect(registry.redactText('key=literal-private-key')).toBe('key=[redacted: privateKey]');
  });

  it('[NFR-003] replaces the longest registered value first', () => {
    const registry = new SecretRegistry();
    // A short credential that happens to be a substring of a longer one would
    // otherwise leave the longer one half-rendered.
    registry.register('abc', '[vault.short]');
    registry.register('abcdef', '[vault.long]');

    expect(registry.redactText('abcdef and abc')).toBe('[vault.long] and [vault.short]');
  });

  it('[NFR-003] replaces every occurrence, not only the first', () => {
    const registry = new SecretRegistry();
    registry.register('tok', '[vault.t]');

    expect(registry.redactText('tok tok tok')).toBe('[vault.t] [vault.t] [vault.t]');
  });

  it('[NFR-003] redacts a value nested anywhere in a structured record', () => {
    const registry = new SecretRegistry();
    registry.register('canary-value', '[vault.canary]');

    expect(
      registry.redactPlain({
        rpc: { url: 'https://host/canary-value' },
        headers: [{ Authorization: 'Bearer canary-value' }],
      }),
    ).toEqual({
      rpc: { url: 'https://host/[vault.canary]' },
      headers: [{ Authorization: 'Bearer [vault.canary]' }],
    });
  });

  it('[NFR-003] redacts a value used as an object key', () => {
    const registry = new SecretRegistry();
    registry.register('keyish', '[vault.k]');

    expect(registry.redactPlain({ keyish: 1 })).toEqual({ '[vault.k]': 1 });
  });

  it('registering the same value twice does not duplicate it', () => {
    const registry = new SecretRegistry();
    registry.register('same', '[vault.a]');
    registry.register('same', '[vault.b]');

    expect(registry.size).toBe(1);
    expect(registry.redactText('same')).toBe('[vault.b]');
  });

  it('refuses an empty value, which would match at every index', () => {
    const registry = new SecretRegistry();
    registry.register('', '[vault.nothing]');

    expect(registry.size).toBe(0);
    expect(registry.redactText('untouched')).toBe('untouched');
  });

  it('leaves output alone while nothing is registered', () => {
    const registry = new SecretRegistry();
    const record = { nested: { value: 'plain' } };

    expect(registry.redactPlain(record)).toBe(record);
  });
});
