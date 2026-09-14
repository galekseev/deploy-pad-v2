/**
 * Generated from the authored schema — do not edit.
 *
 * Run `pnpm --filter @deploy-pad/schemas run build` to regenerate; CI fails on a
 * diff, which is how a schema and its types are kept from drifting apart.
 */

/**
 * Canonical map of chain names to chain connection data — the single source
 * of truth for chain identity (name -> numeric id), RPC endpoints, and
 * verification (block-explorer) APIs with their credentials.
 *
 * Each chain is an object with chain_id, named RPC profiles (rpc), and
 * named verification profiles (verification). Plans reference chains by
 * name and select profiles by name (rpc: / verifiers: selectors) — they
 * never carry connection values.
 *
 * The reserved top-level key `sets:` declares named CHAIN SETS — reusable,
 * selector-carrying chain groups a plan references via `$set` in its
 * chains block. Each set member is a ChainConfig (rpc: / verifiers:
 * selectors only), identical in shape to a plan chains-block entry — a set
 * is a named, pre-authored plan chains block. See
 * docs/specs/known-chains.md#chain-sets.
 *
 * Credentials are pointers, never literal values: api_key must be a single
 * ${vault.X} (preferred) or ${env.X} token; RPC url and header values may
 * embed ${vault.X} / ${env.X} inline — each resolved ref fragment is
 * displayed as its reference label ([vault.X] / [env.VAR]) in all engine
 * output, never as the resolved value.
 *
 */
export interface KnownChains {
  /**
   * Config format version this file is written against (current: 2).
   * The engine compares it to the format version it supports at load
   * time. A differing version is a load-time error that aborts the run
   * unless `--ignore-version` is passed, which downgrades it to a
   * warning and proceeds. A missing version is always a warning.
   * `version` is a RESERVED top-level key — like `sets`, it is excluded
   * from the chain-name space (a chain cannot be named `version`).
   *
   */
  version?: number;
  /**
   * Named chain sets. `sets` is a RESERVED top-level key — never a chain
   * name. Each set maps member chain names to ChainConfig selector
   * objects (a name-only member is an empty object {}). Validated at
   * registry load, before any plan is opened: every member chain must be
   * declared in this file with a selectable RPC profile, and every
   * selector must name a profile the member chain declares. Sets cannot
   * nest — a set member is always a chain name, never another set.
   *
   */
  sets?: {
    /**
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "^[a-z][a-z0-9-]*$".
     */
    [k: string]: {
      [k: string]: ChainConfig;
    };
  };
  /**
   * This interface was referenced by `KnownChains`'s JSON-Schema definition
   * via the `patternProperty` "^(?!sets$|version$)[a-z][a-z0-9-]*$".
   */
  [k: string]:
    | {
        /**
         * Numeric EVM chain id (e.g. 1 for mainnet).
         */
        chain_id: number;
        /**
         * Named RPC profiles. The string shorthand is normalized to
         * { default: { url: <string> } } on load. The profile name
         * `default` is the reserved fallback used when a plan has no
         * explicit rpc: selector; every chain a plan runs on needs one
         * (or an explicit selector).
         *
         */
        rpc?:
          | string
          | {
              [k: string]: RpcProfile;
            };
        /**
         * Named verification profiles (several explorers and/or several
         * accounts per chain). The profile name `default` is what implicit
         * verification uses when a plan has no verifiers: selector. A chain
         * without any profiles simply cannot verify contracts.
         *
         */
        verification?: {
          [k: string]: VerificationProfile;
        };
      }
    | number
    | {
        /**
         * This interface was referenced by `undefined`'s JSON-Schema definition
         * via the `patternProperty` "^[a-z][a-z0-9-]*$".
         */
        [k: string]: {
          [k: string]: ChainConfig;
        };
      }
    | undefined;
}
/**
 * A chain-set member entry — profile selectors only, identical in shape
 * and semantics to a plan chains-block entry (plans.schema.yaml
 * ChainConfig). A name-only member is an empty object ({}).
 *
 *
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^[a-z][a-z0-9-]*$".
 */
export interface ChainConfig {
  /**
   * Name of an RPC profile declared on the member chain in this file.
   * Omitted, the chain's `default` profile is used (a chain without
   * one then fails set validation at registry load).
   *
   */
  rpc?: string;
  /**
   * Verification profile selection: one profile name, a list of names
   * (the engine verifies against EACH), or false (explicit disable).
   * Omitted, the chain's `default` verification profile is used if
   * declared; a chain without any simply has verification off.
   *
   */
  verifiers?: string | [string, ...string[]] | false;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^[a-z][a-z0-9-]*$".
 */
export interface RpcProfile {
  /**
   * RPC endpoint URL. May embed ${vault.X} / ${env.VAR} refs inline —
   * vault is the recommended form for URL-embedded credentials
   * (e.g. https://.../v2/${vault.alchemyKey}); resolved ref fragments
   * display as their reference labels in all engine output.
   *
   */
  url: string;
  /**
   * Custom HTTP headers sent on every RPC request through this profile
   * (e.g. { Authorization: "Bearer ${vault.rpcAuthToken}" }). Values may
   * embed ${vault.X} / ${env.X} inline — the documented exception to the
   * single-token vault rule; resolved ref fragments display as their
   * reference labels in all engine output.
   *
   */
  headers?: {
    [k: string]: string;
  };
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^[a-z][a-z0-9-]*$".
 */
export interface VerificationProfile {
  /**
   * API dialect — tells the verification machinery (bundled scripts,
   * forge --verifier, ...) which protocol to speak.
   *
   */
  type?: "etherscan" | "blockscout" | "sourcify";
  /**
   * Verification API base URL (e.g. https://api.etherscan.io/v2/api).
   */
  api: string;
  /**
   * API key for this profile. Exactly one ${vault.X} token (preferred)
   * or one ${env.X} token (allowed) — literals and inline mixing are
   * rejected. Omit for keyless APIs (Sourcify, open Blockscout
   * instances). Tagged as a secret and redacted.
   *
   */
  api_key?: string;
}
