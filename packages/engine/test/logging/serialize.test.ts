import { describe, expect, it } from 'vitest';
import {
  MAX_ARRAY_LENGTH,
  MAX_STRING_LENGTH,
  serializeError,
  stringifyPlain,
  toPlain,
  truncate,
} from '../../src/cross/logging/index.ts';

describe('safe serialization', () => {
  it('survives a circular reference, which every provider and subprocess result is', () => {
    const provider: Record<string, unknown> = { name: 'provider' };
    provider['self'] = provider;

    expect(toPlain(provider)).toEqual({ name: 'provider', self: '[circular]' });
    expect(() => stringifyPlain(toPlain(provider))).not.toThrow();
  });

  it('keeps a shared reference that is not a cycle', () => {
    const shared = { id: 1 };

    expect(toPlain({ left: shared, right: shared })).toEqual({ left: { id: 1 }, right: { id: 1 } });
  });

  it('truncates a long string and says how much went missing', () => {
    const long = 'x'.repeat(MAX_STRING_LENGTH + 10);
    const result = truncate(long);

    expect(result).toContain('[10 characters truncated]');
    expect(result.startsWith('x'.repeat(MAX_STRING_LENGTH))).toBe(true);
  });

  it('truncates a long array', () => {
    const plain = toPlain(Array.from({ length: MAX_ARRAY_LENGTH + 5 }, (_, index) => index));

    expect(Array.isArray(plain)).toBe(true);
    expect((plain as unknown[]).at(-1)).toBe('[5 more entries truncated]');
  });

  it('follows the cause chain and keeps the stack', () => {
    const root = new Error('rpc refused the connection');
    const wrapped = new Error('preflight check failed', { cause: root });

    const plain = serializeError(wrapped);

    expect(plain.name).toBe('Error');
    expect(plain.message).toBe('preflight check failed');
    expect(plain.stack).toContain('preflight check failed');
    expect(plain.cause).toMatchObject({ message: 'rpc refused the connection' });
  });

  it('keeps the extra properties a subprocess failure carries', () => {
    const failure = Object.assign(new Error('command failed'), {
      exitCode: 4,
      stderr: 'forge: not found',
    });

    expect(serializeError(failure).details).toEqual({ exitCode: 4, stderr: 'forge: not found' });
  });

  it('truncates captured subprocess output rather than logging megabytes of it', () => {
    const failure = Object.assign(new Error('command failed'), {
      stderr: 'e'.repeat(MAX_STRING_LENGTH * 2),
    });

    expect(String(serializeError(failure).details['stderr'])).toContain('characters truncated');
  });

  it('accepts a thrown non-error', () => {
    expect(serializeError('just a string').message).toBe('just a string');
  });

  it('does not let a throwing getter take down a log line', () => {
    const hostile = {
      get boom(): never {
        throw new Error('nope');
      },
      fine: 1,
    };

    expect(toPlain(hostile)).toEqual({ boom: '[unreadable: nope]', fine: 1 });
  });

  it('converts the values JSON cannot represent', () => {
    expect(
      toPlain({
        big: 10n,
        nan: Number.NaN,
        when: new Date('2026-01-01T00:00:00.000Z'),
        pattern: /abc/u,
        set: new Set([1, 2]),
        map: new Map([['k', 'v']]),
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).toEqual({
      big: '10n',
      nan: 'NaN',
      when: '2026-01-01T00:00:00.000Z',
      pattern: '/abc/u',
      set: [1, 2],
      map: { k: 'v' },
      bytes: '[binary 3 bytes]',
    });
  });
});
