/**
 * Generated from the authored schema — do not edit.
 *
 * Run `pnpm --filter @deploy-pad/schemas run build` to regenerate; CI fails on a
 * diff, which is how a schema and its types are kept from drifting apart.
 */

/**
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^[a-z][a-z0-9-]*$".
 */
export type MultisigEntry = {
  /**
   * Execution backend. multisend — one MultiSend batch per chain,
   * proposed to the Safe Transaction Service, signed per batch per
   * chain in the standard Safe UI. merkle — every transaction of the
   * run becomes a Merkle leaf, owners sign the root once, an executor
   * runs the leaves through the Safe's deploy module.
   *
   */
  backend: "multisend" | "merkle";
  /**
   * Delegate key for proposing batches to the Safe Transaction
   * Service (multisend backend). Queue-only — not an owner, holds no
   * approval power. Required on multisend entries; rejected on merkle.
   *
   */
  proposer?: string;
  /**
   * Key that executes on-chain: Merkle leaves (merkle backend —
   * required), or threshold-met batches when auto-execution is wanted
   * (multisend backend — optional; omit to execute from the Safe UI).
   * Pays gas only — holds no approval power.
   *
   */
  executor?: string;
  /**
   * Per-chain data. Keys must be chain names declared in
   * known-chains.yaml. Must cover every active chain of any run that
   * selects this entry (validation error otherwise).
   *
   */
  chains: {
    [k: string]: MultisigChain;
  };
};

/**
 * Registry of named multisig entries — the Safes a run can deploy through.
 * A run opts into multisig mode with the CLI selector `--multisig <name>`;
 * the named entry carries everything the mode needs: the execution backend
 * (multisend | merkle), the per-chain Safe addresses, and the credentials.
 * Plans and workflows carry no multisig data.
 *
 * Each entry is self-contained and describes exactly one backend:
 * - multisend: batches proposed to the Safe Transaction Service; requires
 *   a `proposer` delegate key; `module` is rejected.
 * - merkle: one signed root, leaves executed through a Safe module; requires
 *   an `executor` key and a per-chain `module` address; `proposer` is rejected.
 *
 * Credentials are pointers, never literal values: `proposer` / `executor`
 * must be a single ${vault.X} (preferred) or ${env.X} token. Neither is a
 * Safe owner key — the proposer only queues transactions, the executor only
 * pays gas. Owner keys never appear in deploy-pad configs.
 *
 */
export interface MultisigRegistry {
  /**
   * Config format version this file is written against (current: 2).
   * The engine compares it to the format version it supports at load
   * time. A differing version is a load-time error that aborts the run
   * unless `--ignore-version` is passed, which downgrades it to a
   * warning and proceeds. A missing version is always a warning.
   *
   */
  version?: number;
  multisigs: {
    [k: string]: MultisigEntry;
  };
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^[a-z][a-z0-9-]*$".
 */
export interface MultisigChain {
  /**
   * The Safe's address on this chain — the sender identity of every
   * planned transaction (SYS_SENDER_ADDRESS).
   *
   */
  safe: string;
  /**
   * Address of the deploy module (Sphinx-based) enabled on this Safe.
   * Required on every chain of a merkle entry; rejected on multisend
   * entries (cross-field rule enforced by the engine loader — JSON
   * Schema cannot see the entry's backend from here).
   *
   */
  module?: string;
  /**
   * Override for the Safe Transaction Service base URL (self-hosted
   * service, or a chain outside the hosted set). multisend only.
   * Omit on a chain with no service at all and rely on the offline
   * Transaction Builder export fallback.
   *
   */
  transaction_service?: string;
}
