/**
 * Generated from the authored schema — do not edit.
 *
 * Run `pnpm --filter @deploy-pad/schemas run build` to regenerate; CI fails on a
 * diff, which is how a schema and its types are kept from drifting apart.
 */

/**
 * Per-workflow runtime parameters: which workflow to run, on which chains,
 * with which presets/constants/secrets. One file per workflow, lives at
 * workspace/configs/plans/<workflow>.yaml.
 *
 * The `workflow` field takes two forms: a STRING (a workflow id resolved in
 * workflows.yaml — the normal case) or an OBJECT (an inline step — a
 * SINGLE-ACTION PLAN: the plan's workflow is that one step, written in the
 * same grammar as a workflows.yaml step; see
 * docs/specs/plans.md#single-action-plans).
 *
 * The base plan is structural (workflow, chains, selectors); presets are the
 * only value layer. There is no deployment_id field: deployment identity is
 * resolved at run time (CLI --deployment-id, else derived from the selected
 * preset's name) — see docs/specs/plans.md#deployment-id--re-runs.
 *
 */
export interface Plan {
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
   * The plan's launch target — one field, two forms:
   *
   * STRING: a workflow id (key in workflows.yaml) — a plain workflow or a
   * method variant.
   *
   * OBJECT: an inline step (single-action plan) — the same grammar as a
   * workflows.yaml step, restricted to `action` (required), `method`, and
   * `factory`. The engine treats it as a one-step workflow whose step id
   * is the action's default step id (last FQ segment, or the alias); that
   * id keys deploy.salts/factories and the per-step result paths. Results
   * are keyed by the fully-qualified action id in place of the workflow
   * id. Inputs resolve from preset constants only (no mappings surface);
   * built-ins from their builtin.<NAME> constants; the signing key from
   * secrets.privateKey. See docs/specs/plans.md#single-action-plans.
   *
   */
  workflow: string | InlineStep;
  /**
   * Preset applied when the CLI passes no --preset. If absent and the plan
   * has exactly one preset, that preset is used; with several presets and
   * no selection, the engine errors at load.
   *
   */
  default_preset?: string;
  /**
   * Miss behavior for ${...} references. true (default): every namespace
   * throws on miss at its resolution step. false: ${global.X} / ${system.X}
   * / ${env.VAR} misses in plan values (constants, deploy, secrets values)
   * are left in place and reported as one aggregated warning pass; a step
   * consuming an unresolved token still errors at step input resolution.
   * ${vault.X} lookups and known-chains connection fields are always
   * strict. See docs/specs/references.md#overview.
   *
   */
  strict?: boolean;
  /**
   * Per-generation release-pin selector. Keys are <repoId>.<generationId>
   * (never an action alias, never a bare releaseId); values are a releaseId
   * defined under that generation in actions.yaml. Generations not listed
   * use the pin flagged `latest`. Referential integrity (the generation and
   * releaseId exist; a default pin exists when needed) is the loader's job.
   *
   */
  releases?: {
    /**
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "^[a-z][a-z0-9-]*\.[^.]+$".
     */
    [k: string]: string;
  };
  /**
   * The value layer — named, self-contained parameter sets. At least one
   * preset must be present; exactly one is active per run.
   *
   */
  presets: {
    [k: string]: Preset;
  };
  /**
   * The chain set — NAME REFERENCES into known-chains.yaml with optional
   * profile selectors (rpc: / verifiers:), and/or a CHAIN-SET REFERENCE
   * via the reserved $set key. No connection values: chain id, RPC URLs,
   * verification endpoints and keys all live in known-chains. At least
   * one entry must be present. Keys must be chain names declared in
   * known-chains.yaml (hard error otherwise).
   *
   * $set names a set declared under sets: in known-chains.yaml (hard
   * error otherwise). At the chain-resolution step (before preset
   * selection) the set expands into its member entries; explicit chain
   * entries in this block MERGE OVER set entries by chain name (plan
   * wins per chain), and may add chains beyond the set. On resume, the
   * chain list recorded in deployment.yaml is authoritative — a grown
   * set never widens an unfinished deployment. See
   * docs/specs/plans.md#chain-sets-set. Per-chain constants/deploy/secrets
   * live in the presets' chains blocks.
   *
   */
  chains: {
    /**
     * Chain-set reference — the name of a set declared under sets: in
     * known-chains.yaml. Expands into the set's member entries (each a
     * ChainConfig with the set's selectors); explicit chain entries
     * alongside it win per chain name and may add chains beyond the
     * set. At most one set per plan.
     *
     */
    $set?: string;
    [k: string]: ChainConfig | string | undefined;
  };
}
/**
 * The inline step of a single-action plan — the plan's whole workflow.
 * Identical in grammar to a workflows.yaml step, restricted to the
 * fields meaningful without siblings: `id` is rejected (the derived
 * step id is canonical), `mappings` is rejected (no prior step to wire
 * from — inputs come from same-named preset constants), and a nested
 * `workflow` is rejected (use the string form of the plan's `workflow`
 * field instead). Promotion path: when the one-off grows a second step,
 * move this object verbatim into a workflows.yaml `steps:` list.
 *
 */
export interface InlineStep {
  /**
   * Action reference — an FQ id (<repoId>.<generationId>.<actionId>)
   * or the action's alias (a dotted value is an FQ id, a bare value is
   * an alias resolved in actions.yaml).
   *
   */
  action: string;
  /**
   * Deployment method — same semantics and validation as on a
   * workflows.yaml step. Loader-enforced: error on a
   * non-contract/module action; create3 on a Hardhat 3 type
   * (hardhat3-contract / hardhat3-module) is an error. Presets cannot
   * change it; they supply only the salt/factory-address DATA in
   * their deploy blocks, keyed by the implicit step id.
   *
   */
  method?: "create" | "create2" | "create3";
  /**
   * CREATE3 factory flavor — valid only when `method` is create3
   * (loader-enforced error otherwise). Same semantics as the workflow
   * step field: oneInch/solady read the factory address from the
   * preset's deploy.factories.<stepId>; createx uses the canonical
   * singleton and needs no factory entry.
   *
   */
  factory?: "oneInch" | "createx" | "solady";
}
/**
 * A complete, self-contained parameter set — the plan's only value
 * layer. Nothing is inherited from other presets or from the base plan
 * (chain structural fields aside); reading one preset tells you exactly
 * what a run with it uses. Within the preset, `defaults` merges into
 * each chain block at load time (chain wins per key; deploy deep-merges,
 * salts/factories by step-id key).
 *
 * If `chains` is present, only chains listed here are kept in the
 * resolved plan (acts as a chain filter). A preset cannot add a
 * chain that isn't in the base `chains` block.
 *
 */
export interface Preset {
  /**
   * Environment tag for this preset (e.g. "staging", "production").
   */
  type?: string;
  defaults?: PresetDefaults;
  chains?: {
    /**
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "^[a-z][a-z0-9-]*$".
     */
    [k: string]: {
      constants?: {
        /**
         * This interface was referenced by `undefined`'s JSON-Schema definition
         * via the `patternProperty` "^[a-zA-Z][a-zA-Z0-9_]*$".
         *
         * This interface was referenced by `undefined`'s JSON-Schema definition
         * via the `patternProperty` "^builtin\.[A-Z][A-Z0-9_]*$".
         */
        [k: string]: string;
      };
      deploy?: DeployConfig;
      secrets?: Secrets;
    };
  };
}
export interface PresetDefaults {
  /**
   * Chain-agnostic constant baseline for the preset, merged into each
   * of the preset's chains at load time (chain wins per key). Strings
   * only. Keys must match ^[a-zA-Z][a-zA-Z0-9_]*$
   * (SCREAMING_SNAKE_CASE recommended; legacy OPS_* names are accepted
   * by the same regex). May contain ${global.X}, ${system.X},
   * ${random.N}, ${env.VAR} references.
   * For an input the action declares as `array: true`, a fixed list may
   * be supplied as a JSON-array STRING (e.g. '["0x..","0x.."]'); the
   * engine parses it into a list. For lists assembled from step outputs
   * or needing per-element transforms, use a workflow `combine` instead.
   * Built-in command parameters may be supplied here under their
   * literal `builtin.<NAME>` keys (e.g. builtin.CALL_ADDRESS for
   * contract-call steps) — a shared fallback read by every unmapped
   * step of the declaring type. Deployment strategy is NOT a
   * constant — it lives in the `deploy` block — see
   * docs/specs/references.md#built-in-command-parameters-builtin-names
   * and docs/specs/plans.md#deploy-parameters-deploy-block.
   *
   */
  constants?: {
    /**
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "^[a-zA-Z][a-zA-Z0-9_]*$".
     *
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "^builtin\.[A-Z][A-Z0-9_]*$".
     */
    [k: string]: string;
  };
  deploy?: DeployConfig;
  secrets?: Secrets;
}
/**
 * Deployment-strategy DATA for contract/module steps (forge-contract,
 * hardhat2-contract, hardhat3-contract, hardhat3-module). The method
 * itself is resolved entirely in workflows.yaml (step `method`, optionally
 * overridden by a method variant — globally or per chain); the plan cannot
 * change it and carries no method fields. This block supplies only the
 * chain-specific data the resolved methods need (salts, CREATE3
 * factories, an optional salt base). Entries for steps whose resolved
 * method doesn't use them are harmless.
 *
 * Merge semantics: all merging happens within the active preset — the
 * preset's defaults.deploy deep-merges into each of the preset's chains'
 * deploy (chain wins per field; `salts`, `factories` merged by step-id
 * key), and deployment overrides merge on top the same way. There is no
 * cross-preset or base-plan layer.
 *
 * Salt resolution for a step whose workflow-resolved method is
 * create2/create3:
 *   1. salts[stepId] set -> normalize (0x + exactly 64 hex chars = bytes
 *      verbatim; malformed 0x = error; any other string = keccak256(string)).
 *      Normalization is script-side (engine passes the raw string through to
 *      the bundled deploy script). No warning.
 *   2. else saltBase set -> derive(saltBase, stepId) + validation WARNING
 *      (derived from saltBase, not a brute-forced vanity address).
 *   3. else -> default saltBase of keccak256(${random.32}), derive from it
 *      + validation WARNING that the salt is random and changes from
 *      deployment to deployment (addresses not reproducible).
 * A salt therefore always resolves. The only hard error is a create3 step
 * with the oneInch/solady flavor and no factories[stepId] entry (no
 * factory fallback; createx steps are exempt).
 *
 */
export interface DeployConfig {
  /**
   * Per-step salt for create2/create3 steps. Keys are step ids (dotted for
   * nested workflow steps, e.g. outer.inner). Value normalization
   * (script-side): a value of 0x + exactly 64 hex chars is used as the salt
   * bytes verbatim (a brute-forced vanity salt); a malformed 0x value is an
   * error; any other string is keccak256(string). The engine passes the raw
   * string through; the bundled deploy script normalizes. Distinct from the
   * `salt` input transform (actions.schema.yaml InputSpec), which shares the
   * same rule. Chain-independent -> belongs in the preset's
   * defaults.deploy so CREATE3 addresses stay identical across chains.
   * Optional per step (a step without an entry falls back to saltBase).
   * May contain ${...} refs.
   *
   */
  salts?: {
    /**
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$".
     */
    [k: string]: string;
  };
  /**
   * Per-step CREATE3 factory address. Keys are step ids. Required for every
   * step that resolves to create3 with the oneInch or solady flavor (no
   * derivation or default; a missing entry is a validation error); unused
   * for createx steps (canonical singleton, address known to the engine).
   * Lets one workflow use several factories. Lives per chain, or in the
   * preset's defaults.deploy when identical everywhere. May be a
   * ${global.X} / ${system.X} / ${env.X} reference.
   *
   */
  factories?: {
    /**
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$".
     */
    [k: string]: string;
  };
  /**
   * Optional base from which the engine derives each step's salt as
   * derive(saltBase, step.id), used ONLY for create2/create3 steps that
   * have no explicit salts[stepId] entry. Falling back to it emits a
   * validation warning. Chain-independent so derived CREATE3 addresses
   * stay stable across chains and unique per step. May contain ${...}
   * references.
   *
   */
  saltBase?: string;
}
/**
 * Credential registry. Carries private keys and any author-defined named
 * secrets (multi-PK setups via per-step renames in workflows). Consumed
 * by the engine via the ${secret.NAME} namespace; never authored as
 * ${secret.X} values inside this block. Verification API keys are NOT
 * plan secrets in v2 — they live with their verification profiles in
 * known-chains.yaml (the chain reference's verifiers: selector picks
 * them).
 *
 * Every value in this block is TAGGED as a secret regardless of form:
 * passed to commands via process env only under the SEC_ prefix (never
 * written to .env.automation or other writer output), and redacted in all
 * engine logs and reports. Value forms, in order of preference:
 *   1. ${vault.<name>} — preferred; resolves against global-params.yaml's
 *      vault: block. Preferred for its rotation/audit indirection.
 *   2. ${env.<VAR>} — allowed; reads process.env directly, skipping the
 *      vault indirection. Still tagged and redacted.
 *   3. Literal string — accepted but discouraged; still tagged and redacted
 *      in engine output, but sits in plaintext in the source YAML file,
 *      which the engine cannot scrub.
 *
 * The whole block is also redacted in config_snapshot.yaml regardless of
 * value form.
 *
 */
export interface Secrets {
  /**
   * Default deployer private key for any deploying action on this
   * chain. Resolved as ${secret.privateKey}. Required (per-chain or
   * via the preset's defaults.secrets) when the workflow contains any
   * deploying step. Preferred form is ${vault.<name>}.
   *
   */
  privateKey?: string;
  /**
   * Author-defined named secret slot (e.g. privateKey1, privateKey2,
   * create3Deployer, sameNonceDeployer). A workflow step opts in
   * via mappings.<secretInputName>: <thisName>, which renames the step's
   * secret input to read from this slot. Preferred form ${vault.<name>}.
   *
   *
   * This interface was referenced by `Secrets`'s JSON-Schema definition
   * via the `patternProperty` "^[a-z][a-zA-Z0-9]*$".
   */
  [k: string]: string | undefined;
}
/**
 * A chain reference — profile selectors only, no connection values.
 * The chain's identity and connection data (chain_id, RPC profiles,
 * verification profiles and keys) live in known-chains.yaml; the removed
 * v1-era fields (chain_id, rpc_url, verification_api) are rejected.
 * A name-only reference is an empty object ({}).
 *
 *
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^[a-z][a-z0-9-]*$".
 */
export interface ChainConfig {
  /**
   * Name of an RPC profile declared on the chain in known-chains.yaml.
   * Omitted, the chain's `default` profile is used (a chain without one
   * then fails validation).
   *
   */
  rpc?: string;
  /**
   * Verification profile selection: one profile name, a list of names
   * (the engine verifies against EACH), or false (explicit disable).
   * Omitted, the chain's `default` verification profile is used if
   * declared; a chain without any simply has verification off (warning
   * when the workflow contains verify: true steps).
   *
   */
  verifiers?: string | [string, ...string[]] | false;
}
