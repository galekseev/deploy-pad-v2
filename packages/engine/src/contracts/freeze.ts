/**
 * Every phase artifact is frozen when its phase returns it — deeply, not just at
 * the top level ([artifacts.md → Conventions](../../../../docs/implementation/artifacts.md#conventions-that-apply-to-all-seven)).
 *
 * A later phase that needs a derived value produces its own artifact rather than
 * mutating the one it was handed, which is what makes "what was this
 * invocation?" answerable from one place. `Object.freeze` alone leaves nested
 * objects writable, so the guarantee needs the walk.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  // Freezing before the walk is also the cycle guard: a value already reached
  // is already frozen.
  if (Object.isFrozen(value)) return value;

  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);

  return value;
}
