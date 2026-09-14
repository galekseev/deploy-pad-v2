/**
 * Generated from the authored schema — do not edit.
 *
 * Run `pnpm --filter @deploy-pad/schemas run build` to regenerate; CI fails on a
 * diff, which is how a schema and its types are kept from drifting apart.
 */

/**
 * Three top-level sections, all optional:
 *
 * - defaults / chains: centralized chain-aware constants reusable across
 *   workflows via ${global.NAME}. Defaults provide chain-agnostic baseline
 *   values; per-chain entries override them.
 * - vault: registry mapping author-chosen secret names to ${env.VAR}
 *   references, consumed via ${vault.NAME} from plan secrets values,
 *   known-chains connection credentials (verification api_key, RPC
 *   headers), repository.auth in actions.yaml, and the multisig
 *   registry's proposer/executor. Pointers only — never literal
 *   credentials.
 *
 */
export interface GlobalParams {
  /**
   * Config format version this file is written against (current: 2).
   * The engine compares it to the format version it supports at load
   * time. A differing version is a load-time error that aborts the run
   * unless `--ignore-version` is passed, which downgrades it to a
   * warning and proceeds. A missing version is always a warning.
   *
   */
  version?: number;
  /**
   * Chain-agnostic baseline values for the constants registry.
   */
  defaults?: {
    /**
     * Map of global parameter name to constant value.
     * Keys SHOULD use SCREAMING_SNAKE_CASE.
     *
     */
    constants?: {
      /**
       * This interface was referenced by `undefined`'s JSON-Schema definition
       * via the `patternProperty` "^[A-Z][A-Z0-9_]*$".
       */
      [k: string]: string;
    };
  };
  /**
   * Per-chain overrides for the constants registry. Keys must be valid
   * chain names (lowercase, hyphenated; see known-chains.yaml).
   *
   */
  chains?: {
    /**
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "^[a-z][a-z0-9-]*$".
     */
    [k: string]: {
      constants?: {
        /**
         * This interface was referenced by `undefined`'s JSON-Schema definition
         * via the `patternProperty` "^[A-Z][A-Z0-9_]*$".
         */
        [k: string]: string;
      };
    };
  };
  /**
   * Registry mapping author-chosen secret names to ${env.VAR} references.
   * Each entry is a POINTER, never a credential. Values must be exactly
   * "${env.VAR}" — literal credentials, inline strings, and other
   * namespaces are rejected. Not chain-aware; one entry maps one name to
   * one env var globally. Per-chain wiring lives in plan
   * chains.<c>.secrets. Consumed via ${vault.NAME} from plan secrets
   * values, known-chains connection credentials, repository.auth, and
   * multisig proposer/executor. Resolved values are tagged as secrets by
   * the engine (env-only injection, log redaction by entry name).
   *
   */
  vault?: {
    /**
     * Author-chosen secret name (camelCase identifier). Value must be
     * an ${env.VAR} env ref.
     *
     *
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "^[a-z][a-zA-Z0-9]*$".
     */
    [k: string]: string;
  };
}
