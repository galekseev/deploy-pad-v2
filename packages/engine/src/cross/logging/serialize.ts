/**
 * Turning arbitrary values into something `JSON.stringify` cannot choke on.
 *
 * The three failure modes this exists for are the ones an adopted logger would
 * have covered (stack.md §7): `JSON.stringify` throws on a circular reference,
 * and an `ethers` provider or an `execa` result is one; an error loses its
 * `cause` chain and its stack unless something walks them; and a failed
 * subprocess can carry megabytes of stderr into a log line.
 */

const MAX_DEPTH = 8;

export const MAX_STRING_LENGTH = 8_192;
export const MAX_ARRAY_LENGTH = 200;

const ERROR_OWN_KEYS = new Set(['name', 'message', 'stack', 'cause']);

export interface PlainError {
  readonly name: string;
  readonly message: string;
  readonly stack: string | null;
  readonly cause: unknown;
  /** Everything else the error carried — `execa` puts `exitCode` and `stderr` here. */
  readonly details: Record<string, unknown>;
}

export function truncate(text: string, max: number = MAX_STRING_LENGTH): string {
  if (text.length <= max) return text;
  const dropped = text.length - max;
  return `${text.slice(0, max)}… [${String(dropped)} characters truncated]`;
}

/**
 * Converts `value` into strings, numbers, booleans, `null`, arrays and plain
 * objects — nothing else. Cycles become `"[circular]"`, depth beyond
 * {@link MAX_DEPTH} becomes `"[depth limit]"`, and long strings and arrays are
 * cut with a marker saying how much went missing.
 */
export function toPlain(value: unknown): unknown {
  return convert(value, 0, new WeakSet<object>());
}

export function serializeError(value: unknown): PlainError {
  const plain = convert(value, 0, new WeakSet<object>());
  if (isPlainError(plain)) return plain;

  return {
    name: 'NonError',
    message: typeof value === 'string' ? truncate(value) : JSON.stringify(plain) ?? 'unknown',
    stack: null,
    cause: null,
    details: {},
  };
}

function isPlainError(value: unknown): value is PlainError {
  return (
    value !== null &&
    typeof value === 'object' &&
    'name' in value &&
    'message' in value &&
    'details' in value
  );
}

function convert(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  switch (typeof value) {
    case 'string':
      return truncate(value);
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
    case 'undefined':
      return value;
    case 'bigint':
      return `${value.toString()}n`;
    case 'symbol':
      return value.toString();
    case 'function':
      return `[function ${value.name || 'anonymous'}]`;
    case 'object':
      break;
  }

  if (value === null) return null;

  const object: object = value;
  if (seen.has(object)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[depth limit]';

  seen.add(object);
  try {
    return convertObject(object, depth, seen);
  } finally {
    // Siblings may legitimately share a reference; only ancestors are cycles.
    seen.delete(object);
  }
}

function convertObject(value: object, depth: number, seen: WeakSet<object>): unknown {
  if (value instanceof Error) return convertError(value, depth, seen);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp || value instanceof URL) return value.toString();
  if (value instanceof Map) return convertEntries([...value.entries()], depth, seen);
  if (value instanceof Set) return convertArray([...value], depth, seen);
  if (Array.isArray(value)) return convertArray(value, depth, seen);
  if (value instanceof Uint8Array) return `[binary ${String(value.byteLength)} bytes]`;

  const plain: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    plain[key] = readProperty(value, key, depth, seen);
  }
  return plain;
}

function convertError(value: Error, depth: number, seen: WeakSet<object>): PlainError {
  const details: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (ERROR_OWN_KEYS.has(key)) continue;
    details[key] = readProperty(value, key, depth, seen);
  }

  return {
    name: value.name,
    message: truncate(value.message),
    stack: typeof value.stack === 'string' ? truncate(value.stack) : null,
    cause: value.cause === undefined ? null : convert(value.cause, depth + 1, seen),
    details,
  };
}

function convertArray(value: readonly unknown[], depth: number, seen: WeakSet<object>): unknown[] {
  const kept = value.slice(0, MAX_ARRAY_LENGTH).map((entry) => convert(entry, depth + 1, seen));
  if (value.length > MAX_ARRAY_LENGTH) {
    kept.push(`[${String(value.length - MAX_ARRAY_LENGTH)} more entries truncated]`);
  }
  return kept;
}

function convertEntries(
  entries: readonly [unknown, unknown][],
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const plain: Record<string, unknown> = {};
  for (const [key, entry] of entries.slice(0, MAX_ARRAY_LENGTH)) {
    plain[typeof key === 'string' ? key : String(convert(key, depth + 1, seen))] = convert(
      entry,
      depth + 1,
      seen,
    );
  }
  return plain;
}

/** A getter on a third-party object may throw; a log line must not. */
function readProperty(value: object, key: string, depth: number, seen: WeakSet<object>): unknown {
  try {
    return convert((value as Record<string, unknown>)[key], depth + 1, seen);
  } catch (cause) {
    return `[unreadable: ${cause instanceof Error ? cause.message : 'unknown'}]`;
  }
}

/** `JSON.stringify` over an already-plain structure, so it cannot throw. */
export function stringifyPlain(value: unknown): string {
  return JSON.stringify(value) ?? 'null';
}
