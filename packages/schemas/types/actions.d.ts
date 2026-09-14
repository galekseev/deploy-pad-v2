/**
 * Generated from the authored schema — do not edit.
 *
 * Run `pnpm --filter @deploy-pad/schemas run build` to regenerate; CI fails on a
 * diff, which is how a schema and its types are kept from drifting apart.
 */

/**
 * One release pin under a generation: an immutable code point. Set at
 * most one of `branch`, `tag`, or `commit` (omit all three to track the
 * remote default branch — engine warns). Optionally flag one pin per
 * generation with `latest: true` — the default the plan uses when it
 * selects no release for the generation. All pins of a generation must
 * build the same action interface (not enforced by the engine).
 *
 *
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` ".+".
 */
export type Release = {
  /**
   * Branch to check out (mutable — pulls latest on update).
   */
  branch?: string;
  /**
   * Tag to check out (immutable; recommended for production).
   */
  tag?: string;
  /**
   * Git commit SHA (40 hex chars or short SHA; immutable).
   */
  commit?: string;
  /**
   * Marks this pin as the generation's default — used when a plan
   * selects no release for the generation. At most one release per
   * generation may set it (not enforced by the schema).
   *
   */
  latest?: boolean;
};
export type MakeAction = ActionBase & {
  type?: "make";
  /**
   * Make target name (without `make`). The target must write
   * .env.outputs itself (wrap an existing recipe in a new target
   * if it can't be modified).
   *
   */
  command: string;
} & (
    | ({
        deploys?: false;
      } & RejectsDeploymentFields)
    | ({
        deploys?: true;
      } & DeploymentFields &
        RejectsRequiresPrivateKey)
  );
export type InputEntry = string | InputSpec;
/**
 * Encoding transform (1->1 value coercion). salt: a 0x+64hex value is used
 * verbatim, any other string is keccak256(string). keccak256: keccak256 of
 * the value, always.
 *
 */
export type EncodingTransform = "salt" | "keccak256";
export type OutputEntry = string | OutputSpec;
export type Hardhat2ContractAction = ActionBase &
  DeploymentFields & {
    type?: "hardhat2-contract";
    /**
     * Hardhat contract name as registered in artifacts.
     */
    contract: string;
  };
export type Hardhat3ContractAction = ActionBase &
  DeploymentFields & {
    type?: "hardhat3-contract";
    /**
     * Hardhat contract name as registered in artifacts.
     */
    contract: string;
  };
export type Hardhat3ModuleAction = ActionBase &
  DeploymentFields & {
    type?: "hardhat3-module";
    /**
     * Path to the Ignition module file, relative to the repo root
     * (e.g. "ignition/modules/Apollo.ts").
     *
     */
    module: string;
  };
export type ForgeContractAction = ActionBase &
  DeploymentFields & {
    type?: "forge-contract";
    /**
     * Foundry contract reference, "path/to/Source.sol:ContractName".
     */
    contract: string;
  };
export type ForgeScriptAction = ActionBase & {
  type?: "forge-script";
  /**
   * Foundry script reference, "path/to/Script.s.sol:ContractName".
   * The engine wraps with `forge script ...`. The script must
   * produce .env.outputs itself (vm.writeFile).
   *
   */
  command: string;
  /**
   * Function to invoke on `command`.
   */
  function?: string;
} & (
    | ({
        deploys?: false;
      } & RejectsDeploymentFields)
    | ({
        deploys?: true;
      } & DeploymentFields &
        RejectsRequiresPrivateKey)
  );
export type Hardhat2ScriptAction = ActionBase & {
  type?: "hardhat2-script";
  /**
   * Path to the Hardhat script wrapper (e.g. "scripts/post-deploy.ts").
   * The engine wraps with `npx hardhat run` (Hardhat 2 toolchain).
   * To invoke a Hardhat task, write a wrapper that calls
   * `hre.run("<task>", ...)`. The wrapper must write .env.outputs
   * itself.
   *
   */
  command: string;
} & (
    | ({
        deploys?: false;
      } & RejectsDeploymentFields)
    | ({
        deploys?: true;
      } & DeploymentFields &
        RejectsRequiresPrivateKey)
  );
export type Hardhat3ScriptAction = ActionBase & {
  type?: "hardhat3-script";
  /**
   * Path to the Hardhat script wrapper (e.g. "scripts/post-deploy.ts").
   * The engine wraps with `npx hardhat run` (Hardhat 3 toolchain).
   * The wrapper must write .env.outputs itself.
   *
   */
  command: string;
} & (
    | ({
        deploys?: false;
      } & RejectsDeploymentFields)
    | ({
        deploys?: true;
      } & DeploymentFields &
        RejectsRequiresPrivateKey)
  );
export type ScriptAction = ActionBase & {
  type?: "script";
  deploys?: boolean;
  /**
   * Path to the script (relative to the repo root or workingDir).
   * Executed via the configured `runtime` as `<runtime> <command>`.
   * The script must write .env.outputs itself.
   *
   */
  command: string;
  /**
   * Interpreter used for `command`.
   */
  runtime?: "bash" | "node" | "tsx" | "ts-node";
} & (
    | ((
        | {
            [k: string]: unknown;
          }
        | {
            deploys?: false;
          }
      ) &
        RejectsDeploymentFields)
    | ({
        [k: string]: unknown;
      } & {
        deploys?: true;
      } & DeploymentFields &
        RejectsRequiresPrivateKey)
  );
export type ContractCallAction = ActionBase & {
  type?: "contract-call";
  /**
   * Cast-style function signature, e.g. "transfer(address,uint256)"
   * or "balanceOf(address)(uint256)". For reads, include the return
   * types — they drive decoding of the result.
   *
   */
  signature: string;
  /**
   * How the call is issued — same vocabulary as `cast`:
   * `call` (default) => static eth_call: no transaction, no private
   * key. `send` => signs and publishes a state-changing transaction;
   * the engine injects ${secret.privateKey}. Do not set
   * requiresPrivateKey — `mode` drives PK injection on this type.
   *
   */
  mode?: "call" | "send";
} & RejectsDeploymentFields;

/**
 * Per-repo catalog of actions. The reserved top-level `version` key
 * declares the config format version (engine errors on mismatch at load
 * time unless `--ignore-version` is passed, which downgrades it to a
 * warning); every other top-level key is a repository ID. Each repo declares
 * its source URI, default framework/package-manager configuration, and
 * one or more generations. A generation is one stable interface: it owns
 * a map of action ID -> Action plus a set of release pins (each an
 * immutable git ref, one optionally flagged `latest`). The plan selects
 * which release pin to run; the pin is NOT part of the fully-qualified
 * action id `<repoId>.<generationId>.<actionId>`.
 *
 * Structure: version + (repo -> generation -> { releases, actions }).
 *
 * Each action's `type` selects how the engine runs it (make,
 * forge-contract, hardhat2-contract, hardhat3-contract, hardhat3-module,
 * forge-script, hardhat2-script, hardhat3-script, script, contract-call).
 * The `deploys` behavior flag marks the action as a deploying action —
 * one that must fulfill the deployment interface (write .env.outputs,
 * drop artifacts into SYS_ARTIFACTS_DIR, verify inline when
 * SYS_VERIFY=1) and may set `verify` — instead of a non-deploying one.
 *
 */
export interface ActionsConfig {
  /**
   * Config format version this file is written against (current: 2).
   * The engine compares it to the format version it supports at load
   * time. A differing version is a load-time error that aborts the run
   * unless `--ignore-version` is passed, which downgrades it to a
   * warning and proceeds. A missing version is always a warning.
   *
   */
  version?: number;
  [k: string]: RepoConfig | number | undefined;
}
/**
 * This interface was referenced by `ActionsConfig`'s JSON-Schema definition
 * via the `patternProperty` "^(?!version$)[a-z][a-z0-9-]*$".
 */
export interface RepoConfig {
  /**
   * Default framework for all generations of this repo. Generations
   * may override via their own `framework` field.
   *
   */
  framework: "foundry" | "hardhat" | "custom" | "none";
  /**
   * Default override for the framework's install command. Generations
   * may override via their own `frameworkInstall` field.
   *
   */
  frameworkInstall?: string;
  /**
   * Default package manager for all generations of this repo.
   */
  packageManager?: "yarn" | "npm" | "pnpm" | "custom" | "none";
  /**
   * Default override for the package manager's install command.
   */
  packageManagerInstall?: string;
  repository: Repository;
  generations: {
    [k: string]: Generation;
  };
}
export interface Repository {
  /**
   * Git URI (HTTPS or SSH; HTTPS recommended). Same URI is used for
   * every generation of the repo; generations and their release pins
   * vary by ref, not by URI. Never embed a token in the URI -- use
   * `auth` instead.
   *
   */
  uri: string;
  /**
   * Credential pointer for private repos: exactly one `${vault.X}`
   * (preferred -- resolved token gets secret tagging) or `${env.X}`
   * token. Literal credentials and inline mixing are rejected. The
   * env var holds the raw token (e.g. a GitHub access token); the
   * engine injects it ephemerally at clone/fetch time. Omitted =>
   * ambient git credentials (SSH agent, credential helper).
   *
   */
  auth?: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^[^.]+$".
 */
export interface Generation {
  releases: {
    [k: string]: Release;
  };
  /**
   * Per-generation override of the repo's `framework`. Use when an
   * older generation needs a different framework version.
   *
   */
  framework?: "foundry" | "hardhat" | "custom" | "none";
  /**
   * Per-generation override of the repo's `frameworkInstall`.
   */
  frameworkInstall?: string;
  /**
   * Per-generation override of the repo's `packageManager`.
   */
  packageManager?: "yarn" | "npm" | "pnpm" | "custom" | "none";
  /**
   * Per-generation override of the repo's `packageManagerInstall`.
   */
  packageManagerInstall?: string;
  actions: {
    /**
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "^[a-z][a-z0-9-]*$".
     */
    [k: string]:
      | MakeAction
      | Hardhat2ContractAction
      | Hardhat3ContractAction
      | Hardhat3ModuleAction
      | ForgeContractAction
      | ForgeScriptAction
      | Hardhat2ScriptAction
      | Hardhat3ScriptAction
      | ScriptAction
      | ContractCallAction;
  };
}
export interface ActionBase {
  type: string;
  description?: string;
  /**
   * Optional short handle for the action, usable in a workflow step's
   * `action` field in place of the full
   * <repoId>.<generationId>.<actionId>, and surfaced in the UI editor.
   * Must be unique across all actions (enforced by the loader, not this
   * schema). Workflow steps reference actions and workflows through
   * separate fields (`action` vs `workflow`), so an alias may share a
   * name with a workflow id — there is no cross-config uniqueness rule
   * between them.
   *
   */
  alias?: string;
  /**
   * Discriminator for the deployment surface. Per-type rule:
   *   - forge-contract / hardhat2-contract / hardhat3-contract /
   *     hardhat3-module: rejected (fixed-true)
   *   - make / forge-script / hardhat2-script / hardhat3-script:
   *     required-explicit
   *   - script: defaults to false
   *   - contract-call: rejected (fixed-false)
   *
   */
  deploys?: boolean;
  /**
   * Parameters the action consumes. Each entry is either a plain string
   * (the parameter name) or an InputSpec object { name, transform?,
   * array? }. Order matters for contract types (treated as constructor
   * argument order); on hardhat3-module, inputs are passed by name as
   * Ignition module parameters and order is irrelevant.
   * SCREAMING_SNAKE_CASE is recommended; legacy OPS_* names are accepted
   * by the same regex. `transform` is the input's authoritative encoding
   * coercion (salt|keccak256, single or chain), applied last and not
   * overridable by a workflow; it is valid only on scalar inputs
   * (rejected when array: true — loader). `array: true` marks an
   * array-valued parameter (the workflow assembles it via a `combine`).
   * Structural transforms are never declared here.
   * The private key is never declared here — the engine injects it as
   * SEC_PRIVATE_KEY, sourced from ${secret.privateKey}. There are no
   * reserved private-key input names.
   * Built-in parameter names (builtin.<NAME>, e.g. builtin.CALL_ADDRESS)
   * can never appear here — the name regex forbids the dot. They are
   * declared by the action type in engine code and sourced from plan
   * constants / workflow mappings. Deployment method and CREATE3
   * factory/salt are not inputs either — method is the workflow step
   * method, factory/salt the plan deploy block.
   *
   */
  inputs: InputEntry[];
  /**
   * Hard-coded literal values for selected inputs. Each key must also
   * appear in `inputs`. Values are literal strings only (no ${...}
   * substitutions). Treated as hard constants: the plan and workflow
   * mappings cannot override them.
   *
   */
  inputConstants?: {
    /**
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "^[a-zA-Z][a-zA-Z0-9_]*$".
     */
    [k: string]: string;
  };
  outputs: OutputEntry[];
  workingDir?: string;
  /**
   * Names of additional enrichers (registered in the engine code) to
   * append after the action type's required defaults. The type defines
   * the minimal required set; author entries cannot replace it.
   *
   */
  enrichers?: string[];
  /**
   * Names of additional writers (registered in the engine code) to
   * append after the action type's required defaults. Same append-only
   * semantics as `enrichers`.
   *
   */
  writers?: string[];
  /**
   * If true, the engine skips re-execution when a prior attempt for
   * this step already succeeded under the same deployment_id and chain
   * (recorded outputs are replayed). Defaults vary by `type`:
   *   - forge-contract / hardhat2-contract / hardhat3-contract /
   *     hardhat3-module: defaults true
   *   - make / forge-script / hardhat2-script / hardhat3-script /
   *     script / contract-call: defaults false
   *
   */
  idempotent?: boolean;
  /**
   * Only valid on non-deploying actions (deploys: false). Opt-in to
   * having ${secret.privateKey} injected. On deploying actions,
   * PK is implicit and this field is rejected. Also rejected on
   * contract-call, where `mode: send` drives PK injection.
   *
   */
  requiresPrivateKey?: boolean;
}
/**
 * Object form of an input: a parameter name plus optional arity (`array`)
 * and an authoritative encoding `transform`. Structural grouping (array /
 * abiEncode / ...) is NOT declared here — it lives in workflow mappings as
 * a `combine`. The action declares only the destination arity and the
 * scalar encoding coercion.
 *
 */
export interface InputSpec {
  /**
   * Input parameter name (same regex as the plain-string form).
   */
  name: string;
  /**
   * The input's authoritative encoding coercion — a single transform
   * name or a chain (applied left to right). Applied LAST when producing
   * the value and NOT overridable by a workflow (a workflow may only add
   * adaptation transforms before it). Valid only on scalar inputs —
   * rejected when `array: true` (enforced by the loader, not this schema).
   *
   */
  transform?: EncodingTransform | [EncodingTransform, ...EncodingTransform[]];
  /**
   * Marks the parameter as array-valued (e.g. a Solidity address[]).
   * The action declares only the arity; the workflow assembles the list
   * from multiple sources via a `combine` (see workflows schema).
   *
   */
  array?: boolean;
}
/**
 * Object form of an output: a name plus optional arity (`array`).
 * Mirrors the InputSpec shape.
 *
 */
export interface OutputSpec {
  /**
   * Output name (same regex as the plain-string form).
   */
  name: string;
  /**
   * Marks the output as array-valued. The command reports it in
   * .env.outputs as a single JSON-array string (mirror of the
   * array-input serialization in .env.automation); the engine parses
   * it into a list at collect time. Downstream it feeds an
   * `array: true` input whole, or a scalar input via a workflow
   * `pick` / index ref (stepId.OUTPUT[i]).
   *
   */
  array?: boolean;
}
export interface RejectsDeploymentFields {
  [k: string]: unknown;
}
export interface DeploymentFields {
  /**
   * Master switch for verification. When false (or omitted), the
   * engine never sets SYS_VERIFY and verification never happens for
   * this action on any chain, regardless of plan or CLI flags. When
   * true, the engine passes SYS_VERIFY=1 plus the selected verification
   * profile's context (SYS_VERIFICATION_API, SYS_VERIFIER_TYPE,
   * SEC_VERIFICATION_API_KEY) to the command, provided the plan's
   * chain reference selects at least one verification profile in
   * known-chains (verifiers: not false); the command verifies inline.
   *
   */
  verify?: boolean;
  /**
   * Declares that the action's author-written command honors the
   * multisig planning contract (SYS_MULTISIG=1 => broadcast nothing,
   * simulate as SYS_SENDER_ADDRESS, write planned transactions to
   * .deploy-pad-transactions.json and predicted outputs to
   * .env.outputs). Required (true) for a deploying action of an
   * author-command type (make / forge-script / hardhat2-script /
   * hardhat3-script / script) to run in multisig mode — validation
   * fails otherwise. Irrelevant for bundled contract/module types
   * (their engine-owned machinery complies automatically). See
   * docs/specs/multisig.md#what-action-authors-must-do.
   *
   */
  supportsMultisig?: boolean;
}
export interface RejectsRequiresPrivateKey {
  [k: string]: unknown;
}
