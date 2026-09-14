/**
 * Generated from the authored schema — do not edit.
 *
 * Run `pnpm --filter @deploy-pad/schemas run build` to regenerate; CI fails on a
 * diff, which is how a schema and its types are kept from drifting apart.
 */

/**
 * The engine's own run-behavior configuration (engine.yaml) — environment
 * policy that is neither launch data (plans), nor connection data
 * (known-chains), nor structure (actions/workflows). The file is OPTIONAL:
 * when none is mounted under --configs-dir, the engine's shipped default
 * config applies; a mounted file REPLACES the default wholesale (no merge —
 * to keep a shipped check, carry its entry).
 *
 * First tenant: the preflight-checks block (phase 5). Every check — the
 * shipped engine:* ones included — is a TypeScript script run out of
 * process under one contract (exit code 0 = pass; printed output = report
 * message; a curated, versioned context document in SYS_CHECK_CONTEXT).
 * There are deliberately no timeout/retries fields (a fixed engine
 * backstop guards against hung scripts), and no ${...} substitution
 * applies anywhere in this file — params reach scripts verbatim.
 *
 * Static checks the schema cannot see (loader's job, phase 2): every
 * engine:<name> script must name a check shipped with the engine release,
 * and every path script must resolve to a .ts file under --configs-dir.
 *
 */
export interface EngineConfig {
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
   * The preflight-checks block — the file's first tenant.
   */
  preflight?: {
    /**
     * Map of check name -> check entry. Names follow the same
     * lowercase-hyphenated grammar as chain/profile names and surface
     * in the preflight report and the run attempt record.
     *
     * DECLARATION ORDER IS MEANINGFUL: run-scope checks execute first
     * (once per invocation), then, per chain, the chain-scope checks —
     * each group in the order the entries are declared here.
     *
     * An empty or absent map runs no checks (the shipped default
     * applies only when no engine.yaml is mounted at all). Prefer
     * `enabled: false` over removal for temporary opt-outs — a
     * disabled check is reported as `disabled`; a removed one is
     * discoverable only through git history.
     *
     */
    checks?: {
      [k: string]: CheckEntry;
    };
  };
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^[a-z][a-z0-9-]*$".
 */
export interface CheckEntry {
  /**
   * The check script: `engine:<name>` for a check shipped with the
   * engine release (engine:rpc, engine:balance,
   * engine:create3-factory), or a path to a .ts file resolved
   * relative to --configs-dir. Checks run before any repository
   * exists, so operator scripts ship with the config set — never
   * inside cloned repos. Resolution is validated statically at load
   * (unknown engine: names and unresolvable paths are validation
   * errors).
   *
   */
  script: string;
  /**
   * Disable-without-removal switch. A disabled check does not run
   * and is reported as `disabled` in the preflight report and the
   * run attempt record — a visible, auditable opt-out.
   *
   */
  enabled?: boolean;
  /**
   * error — a failure aborts the run with exit code 6, after every
   * enabled check has run (failures are aggregated and reported
   * together, validate-style). warn — a failure is printed and
   * recorded, and the run proceeds.
   *
   */
  severity?: "error" | "warn";
  /**
   * chain — runs once per chain this invocation will attempt (the
   * resolved scope after CLI filters; the frozen chain list on
   * resume; minus chains already complete). run — runs once per
   * invocation, before the chain-scope checks.
   *
   */
  scope?: "chain" | "run";
  /**
   * Free-form YAML object passed to the script VERBATIM inside the
   * check context (context.params). The engine never interprets it
   * and no ${...} substitution applies — each check documents its
   * own params (engine:balance reads gasPerDeployment / gasPerCall /
   * safetyFactor / minimums; the other shipped checks read none).
   *
   */
  params?: {};
}
