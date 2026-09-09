/**
 * The `--set KEY=VALUE` shape rule.
 *
 * The check is split by kind, and the split is decided
 * ([phase 1 → Value intent](../../../../../docs/architecture/phase-1-invocation.md#value-intent)):
 * phase 1 checks the **shape** — it parses as `KEY=VALUE` and the key matches the
 * identifier rule — while the **value** is checked in phase 2, at the merge into
 * the selected preset. Checking values here would need the plan's schema, making
 * phase 1 config-aware.
 */
import type { ConstantOverride } from '../../contracts/run-context.ts';

/**
 * The identifier rule shared by action inputs, action outputs and plan constant
 * keys, from [references.md → Identifier rule](../../../../../docs/specs/references.md#identifier-rule).
 * Note it forbids dots: `builtin.<NAME>` is a separate, engine-owned key class.
 */
export const IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9_]*$/u;

export type SetArgResult =
  | { readonly ok: true; readonly override: ConstantOverride }
  | { readonly ok: false; readonly reason: string };

export function parseSetArg(argument: string): SetArgResult {
  // First `=` only: a value may legitimately contain more of them.
  const separator = argument.indexOf('=');
  if (separator === -1) {
    return { ok: false, reason: `expected KEY=VALUE, got ${JSON.stringify(argument)}` };
  }

  const key = argument.slice(0, separator);
  if (!IDENTIFIER.test(key)) {
    return {
      ok: false,
      reason: `${JSON.stringify(key)} is not a valid constant name — it must match ${IDENTIFIER.source}`,
    };
  }

  return { ok: true, override: { key, value: argument.slice(separator + 1) } };
}
