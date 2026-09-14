/**
 * Generated from the authored schema — do not edit.
 *
 * Run `pnpm --filter @deploy-pad/schemas run build` to regenerate; CI fails on a
 * diff, which is how a schema and its types are kept from drifting apart.
 */

export type Step = ActionStep | WorkflowStep;
/**
 * Step id. If omitted, the engine derives a default
 * (the segment after the LAST dot for an FQ-id `action`, the bare token
 * for an aliased `action` or a `workflow`). Must be unique within the
 * enclosing workflow — set explicitly when defaults would collide (e.g.
 * two steps referencing the same action under different generations, or
 * two steps using the same alias).
 *
 */
export type StepId = string;
/**
 * This interface was referenced by `Mappings`'s JSON-Schema definition
 * via the `patternProperty` "^[a-zA-Z][a-zA-Z0-9_]*$".
 *
 * This interface was referenced by `Mappings`'s JSON-Schema definition
 * via the `patternProperty` "^builtin\.[A-Z][A-Z0-9_]*$".
 */
export type MappingValue = SimpleSource | [Source, ...Source[]] | MappingSpec;
/**
 * Step output ref (dotted, optionally indexed "stepId.OUTPUT[0]" when
 * the source output is array: true) or bare-name rename. No ${...}
 * syntax.
 *
 */
export type SimpleSource = string;
export type Source =
  | SimpleSource
  | {
      from: SimpleSource;
      pick?: PickIndex;
      transform?: EncodingChain;
    };
/**
 * Element index to extract from an array-valued source. The index sugar
 * "stepId.OUTPUT[i]" desugars to { from: "stepId.OUTPUT", pick: i }.
 *
 */
export type PickIndex = number;
export type EncodingChain = EncodingTransform | [EncodingTransform, ...EncodingTransform[]];
/**
 * Encoding transform (1->1). salt: 0x+64hex verbatim, else
 * keccak256(string). keccak256: keccak256 of the value.
 *
 */
export type EncodingTransform = "salt" | "keccak256";

/**
 * Map of workflow ID to a Workflow definition (or a WorkflowVariant).
 * The reserved top-level `version` key declares the config format
 * version (engine errors on mismatch at load time unless
 * `--ignore-version` is passed, which downgrades it to a warning);
 * every other top-level key is a workflow ID.
 * A Workflow is an ordered composition of steps. Each step references
 * EITHER an action (the `action` field — an FQ id
 * repoId.generationId.actionId, or the action's bare `alias`) OR
 * another workflow (the `workflow` field — a workflow id). The two
 * references live in separate fields, so an action alias and a
 * workflow id may share a name without ambiguity — there is no shared
 * namespace and no cross-file uniqueness rule between them. A step
 * must set exactly one of `action` / `workflow`. The plan, not the
 * workflow, selects which release pin a generation runs from.
 *
 * A WorkflowVariant (`variantOf`) is a deploy-strategy re-skin of another
 * workflow: same steps and data wiring, different per-step deploy methods
 * (`methods`), CREATE3 factory flavors (`factories`), and/or signing-key
 * slots (`keys`), overridden chain-agnostically and/or per chain
 * (`chains.<c>.methods` / `chains.<c>.factories` / `chains.<c>.keys`).
 * Deploy methods and factory flavors are resolved entirely in this file —
 * the plan cannot change them; key slots are names resolved against the
 * plan's secrets.
 *
 * Schema-level checks cover SHAPE only, including exactly-one-of
 * `action`/`workflow` (via oneOf), exactly-one-of `steps`/`variantOf`
 * at the workflow level, and rejecting `method` on a `workflow` step.
 * Referential integrity (action/workflow existence, mapping-output
 * validity, cycle detection, forward-reference detection, alias
 * uniqueness within actions.yaml, variant step-id/chain-name validity,
 * variantOf targeting a plain workflow) is enforced by the
 * loader/validator.
 *
 */
export interface WorkflowsConfig {
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
   * This interface was referenced by `WorkflowsConfig`'s JSON-Schema definition
   * via the `patternProperty` "^(?!version$)[a-z][a-z0-9-]*$".
   */
  [k: string]: Workflow | WorkflowVariant | number | undefined;
}
export interface Workflow {
  description?: string;
  /**
   * @minItems 1
   */
  steps: [Step, ...Step[]];
}
export interface ActionStep {
  /**
   * The action this step runs: an FQ id
   * (`<repoId>.<generationId>.<actionId>`) or the action's bare
   * `alias`. A value containing a dot is treated as an FQ id; a bare
   * value is an alias resolved against actions.yaml (generation IDs
   * are dot-free but otherwise unrestricted; actionId/repoId/alias
   * follow lowercase-hyphenated).
   *
   */
  action: string;
  id?: StepId;
  /**
   * Deployment method for a contract/module action (forge-contract,
   * hardhat2-contract, hardhat3-contract, hardhat3-module). The loader
   * rejects this field on any other action type. Only this file decides
   * the method: a WorkflowVariant can override it (globally or per
   * chain); the plan never can. Optional: when omitted (and no variant
   * override resolves) the method defaults to `create`. create3 is not
   * supported on hardhat3-contract / hardhat3-module. Salt and factory
   * are NOT set on the step -- they live in the plan keyed by step id
   * (deploy.salts.<stepId> / deploy.factories.<stepId>).
   *
   */
  method?: "create" | "create2" | "create3";
  /**
   * CREATE3 factory flavor -- which factory implementation a create3
   * step deploys through. Valid only when `method` is create3 (loader
   * check). Optional: defaults to `oneInch` when omitted (and no
   * variant override resolves). oneInch and solady read their
   * per-chain factory address from the plan
   * (deploy.factories.<stepId>); createx uses the canonical singleton
   * and needs no factory-address entry. Only this file decides the
   * flavor: a WorkflowVariant can override it (globally or per chain,
   * via its `factories` maps); the plan never can.
   *
   */
  factory?: "oneInch" | "createx" | "solady";
  mappings?: Mappings;
}
/**
 * Per-input wiring. A mapping VALUE is one of:
 *
 *   - A simple string source — either a step output reference (contains
 *     a `.`, e.g. "stepId.OUTPUT_NAME"; an array output allows an
 *     index suffix "stepId.OUTPUT[0]" — sugar for pick) or a bare-name
 *     rename (no dot; the engine looks up `<value>` instead of `<key>`
 *     under chains.<c>.constants for ordinary inputs / built-in
 *     parameters, or chains.<c>.secrets for secret-targeted inputs like
 *     `privateKey`).
 *   - A list of sources — sugar for { from: [...], combine: array }.
 *   - An object (the production pipeline):
 *     { from, pick?, transform?, combine? }.
 *     `from` is one source or a list of sources, each source optionally
 *     wrapped as { from, pick, transform } to carry its own extraction
 *     and encoding. `pick` (extraction, array->scalar) splits one
 *     element out of an array-valued source before anything else runs.
 *     `transform` (encoding, 1->1: salt/keccak256) adapts a value; it
 *     never overrides the action's own declared transform. `combine`
 *     (structural, N->1: array / abiEncode / abiEncodePacked /
 *     abiEncodeWithSignature) assembles multiple sources into one value.
 *
 * Mapping keys are: a declared input name, a built-in parameter of the
 * step's action type (`builtin.<NAME>`, e.g. builtin.CALL_ADDRESS on
 * contract-call — the loader rejects a `builtin.` key the type does
 * not declare), or `privateKey` for the per-step secret rename.
 * Deployment method is NOT a mapping — it lives on the step. No value
 * here carries a credential, env ref, vault ref, or any ${...} syntax.
 *
 */
export interface Mappings {
  [k: string]: MappingValue;
}
/**
 * Explicit production pipeline. `from` is one source or a list of
 * sources. `pick` extracts one element when the (single) `from` source
 * resolves to an array (per-source picks on list elements live on each
 * Source). `transform` is the encoding chain for a scalar `from`
 * (per-source transforms on list elements live on each Source). `combine`
 * assembles a list `from` into one value; omitted with a list `from`
 * defaults to `array`.
 *
 */
export interface MappingSpec {
  from: Source | [Source, ...Source[]];
  pick?: PickIndex;
  transform?: EncodingChain;
  /**
   * Structural transform (N->1). One of: `array`; or
   * `abiEncode(<types>)` / `abiEncodePacked(<types>)` /
   * `abiEncodeWithSignature(<fn(types)>)` with a parenthesized type
   * list or function signature. `array` targets an `array: true` input;
   * the abiEncode* variants target a scalar `bytes` input. Output-type
   * vs. input-arity and source-count vs. arg-count are loader checks.
   *
   */
  combine?: string;
}
export interface WorkflowStep {
  /**
   * The id of another workflow (a top-level key in this file) to nest
   * and flatten. `deploy` is intentionally absent on a workflow step —
   * deployment method lives on the nested action steps.
   *
   */
  workflow: string;
  id?: StepId;
  mappings?: Mappings;
}
export interface WorkflowVariant {
  description?: string;
  /**
   * Id of the base workflow (a top-level key in this file that has
   * `steps`). A variant cannot point at another variant (loader check).
   *
   */
  variantOf: string;
  methods?: MethodOverrides;
  factories?: FactoryOverrides;
  keys?: KeyOverrides;
  /**
   * Per-chain overrides. Keys are chain names from known-chains.yaml.
   * On that chain these win over the chain-agnostic `methods` /
   * `factories` / `keys`; per-step keys win over "*" within each scope.
   *
   */
  chains?: {
    /**
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "^[a-z][a-z0-9-]*$".
     */
    [k: string]: {
      methods?: MethodOverrides;
      factories?: FactoryOverrides;
      keys?: KeyOverrides;
    };
  };
}
/**
 * Map of step id -> method. Keys are step ids of the base workflow
 * (dotted for steps inside nested workflows, e.g. create3-infra.deployer)
 * or the wildcard "*" (every contract/module step; non-deployment steps
 * are unaffected).
 *
 */
export interface MethodOverrides {
  /**
   * This interface was referenced by `MethodOverrides`'s JSON-Schema definition
   * via the `patternProperty` "^([a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*|\*)$".
   */
  [k: string]: "create" | "create2" | "create3";
}
/**
 * Map of step id -> CREATE3 factory flavor. Keys are step ids of the
 * base workflow (dotted for steps inside nested workflows) or the
 * wildcard "*" (every step whose resolved method is create3; other
 * steps are skipped). Values: oneInch (1inch Create3Deployer, factory
 * address from the plan), createx (canonical CreateX singleton, no
 * factory entry), solady (Solady-CREATE3-based factory, factory address
 * from the plan). Maps flavors, not addresses — the per-step factory
 * ADDRESSES live in the plan (deploy.factories.<stepId>). Ignored for a
 * step whose resolved method on the chain is not create3.
 *
 */
export interface FactoryOverrides {
  /**
   * This interface was referenced by `FactoryOverrides`'s JSON-Schema definition
   * via the `patternProperty` "^([a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*|\*)$".
   */
  [k: string]: "oneInch" | "createx" | "solady";
}
/**
 * Map of step id -> secret slot name. Keys are step ids of the base
 * workflow (dotted for nested steps) naming steps that consume a private
 * key; no "*" wildcard (to re-key a whole variant, bind the default
 * `privateKey` slot in the variant's plan). Values are bare slot names
 * resolved against the plan's secrets: block — never ${...} refs or
 * literal credentials. Overrides the step's effective privateKey rename.
 *
 */
export interface KeyOverrides {
  /**
   * This interface was referenced by `KeyOverrides`'s JSON-Schema definition
   * via the `patternProperty` "^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$".
   */
  [k: string]: string;
}
