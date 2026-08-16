# Workflows

Ordered compositions of steps. Each step references either an [action](actions.md) or another workflow. This is where deployment order, parameter wiring, and reuse live.

> **Naming.** *Workflow* is the v2 name for what v1 called a *complex target*. It also resolves the v1 "pipeline" overload — *pipeline* was both the colloquial name for a complex target **and** the name of the execution-config field pointing at one; in v2 the noun is *workflow* and the plan field is `workflow`. The full v1 → v2 terminology map lives in [naming.md](naming.md).

## Purpose

An action is one deployable thing. A real protocol launch is **many things in a specific order**, where later steps consume addresses produced by earlier ones, and parameters get aliased and remapped along the way.

Workflows capture that:

- **Order** — steps run sequentially, top to bottom.
- **Wiring** — `mappings` declares "this step's input X comes from that step's output Y" or "this step's input X is locally called Z (read it from constants under that name)."
- **Composition** — a workflow can include another workflow as a step, so common deployment fragments (e.g. "deploy a CREATE3 deployer + factory") can be reused. Nested workflows are flattened by the engine; from the execution side they look like one step but their internals still execute one action step at a time.

The plan picks **one workflow** by id (the `workflow` field) and runs it on each configured chain. The inverse also holds: a truly single-step launch (transfer ownership, mint, one standalone deployment) doesn't need a workflow in this file at all — the plan's `workflow:` field can hold an **inline step object** (same grammar as a step here) naming one action directly. See [plans.md → Single-action plans](plans.md#single-action-plans).

On disk, a workflows file is a YAML mapping at the top level. There is one reserved `version` key; every other key is a **workflow id**, and each value is either a `Workflow` or a `WorkflowVariant` (a deploy-strategy re-skin of another workflow — per-step methods, CREATE3 factory flavors, and signing-key slots; see [Method variants](#method-variants--variantof)).

```yaml
version: 2                      # config format version — engine errors on mismatch (override with --ignore-version)

<workflowId>:                   # e.g. "aggregation-router-and-lo"
  description: "..."
  steps:
    - action: ...               # or: workflow: ...  (exactly one)
      id: ...
      mappings: ...

<variantId>:                    # method variant — same steps/wiring, different deploy strategy
  variantOf: <workflowId>
  methods: { ... }              # per-step method overrides
  factories: { ... }            # per-step CREATE3 factory-flavor overrides
  keys: { ... }                 # per-step signing-key slot overrides
  chains: { <chainName>: ... }  # the same three maps, per chain
```

The same key is what a [plan](plans.md) puts into its `workflow` field.

The reserved top-level `version` key declares which **config format version** the file is written against (current: `2`), exactly like [actions.md → Purpose](actions.md#purpose). At load time the engine compares it to the format version it supports: a **mismatch is a load-time error** that aborts the run, unless the run passes the `--ignore-version` CLI flag (which downgrades it to a warning and lets loading proceed); a **missing** `version` is always a warning recommending the key be added. See [engine-internals.md → Config version check](engine-internals.md#config-version-check).

The field-by-field reference for every level lives in [Field reference](#field-reference); a full worked example in [examples/workflows.yml](examples/workflows.yml).

## Workflows — ordered compositions of steps

A workflow is the unit of "this is the ordered set of steps a launch runs." Concretely, a workflow declares:

- An optional `description` — free-form, surfaces in the editor and logs.
- A `steps` array — at least one [step](#steps--references-ids-and-deploy-method), executed in array order, top to bottom. Each step references an action or another workflow.

The top-level YAML key is the **workflow id**. It is a stable identifier: a [plan](plans.md) selects one workflow by putting this id in its `workflow` field, and result paths use it (`workspace/results/<workflow>/<deployment_id>/<chain>/`). A workflow id only needs to be unique within this file: workflow ids and action aliases live in separate step fields (`workflow` vs `action`), so they never collide — see [Step references](#step-references--action-or-workflow).

Field reference: [Field reference → `Workflow` fields](#workflow-fields).

## Steps — references, ids, and deploy method

A step is one entry in a workflow's `steps` array — a single action invocation (or a nested workflow). It names either an `action` or a `workflow` (exactly one), optionally an explicit `id`, an optional `method` (plus, for `create3` steps, an optional `factory` flavor) for contract/module steps, and optional `mappings` for wiring. The narrative below covers reference resolution, id derivation, and the per-step deploy method; per-input wiring lives in [Mappings](#mappings--the-wiring-layer).

Field reference: [Field reference → `Step` fields](#step-fields).

### Step references — `action` or `workflow`

Every step references exactly one thing, through exactly one of two mutually exclusive fields:

- `action` — an **action**, named either by its FQ id (`<repoId>.<generationId>.<actionId>`) or by the action's optional `alias` (a bare token — see [actions.md → Common fields](actions.md#common-fields--every-action)). Within `action`, a value containing a dot is an FQ id; a bare value is an alias, resolved against `actions.yaml`.
- `workflow` — another **workflow**, by its id (a top-level key in this file).

Because the two references live in **separate fields**, an action alias and a workflow id may share the same name with no ambiguity — each is resolved in its own file, and there is **no shared namespace and no cross-file uniqueness rule**. A step must set **exactly one** of `action` / `workflow`; setting both or neither is an error, enforced by the schema (see [Field reference → `Step` fields](#step-fields)).

### Step id derivation

Every step has an id used for cross-step references and result paths. If omitted, the engine derives a default from whichever reference field the step sets. Examples of how this works:


| Step reference                                | Inferred `id`           |
| --------------------------------------------- | ----------------------- |
| `action: fusion-resolver.v1.create3-deployer` | `create3-deployer`      |
| `action: cross-chain-swap.v2.true-token`      | `true-token`            |
| `workflow: aggregation-executors`             | `aggregation-executors` |


The default is the segment after the last dot (for an FQ-id `action`), or the bare token itself (for an aliased `action` or a `workflow`). Two consequences:

- If you list the same action twice in one workflow, you must give at least one of them an explicit `id`. (An aliased `action`'s default id is the alias itself, so two steps using the same alias also collide.)
- **If you reference the same `actionId` under two different generations** (e.g. `cross-chain-swap.v1.escrow-factory` and `cross-chain-swap.v2.escrow-factory`), the defaults collide on `escrow-factory` — set explicit ids like `escrow-factory-v1` and `escrow-factory-v2`. See [Cross-generation composition](#cross-generation-composition).

### Per-step `method`

Each contract/module step declares its deployment method directly on the step via `method` — the design-time default for that contract. A workflow can therefore mix strategies per step:

```yaml
- action: cross-chain-swap.v2.escrow-factory
  id: escrow-factory-v2
  method: create3            # deterministic cross-chain address
- action: cross-chain-swap.v2.escrow-migrator
  id: escrow-migrator
  method: create             # plain CREATE — nothing deterministic needed
```

`method` is optional. **When it is omitted (and no variant override resolves), the method defaults to `create`** — plain CREATE needs no salt or factory, so a contract step with nothing specified just deploys with CREATE.

**The method is decided entirely in this file.** The plan has no say: it supplies only the data the non-`create` methods need (per-step CREATE3 factories and salts — `deploy.salts.<stepId>` / `deploy.factories.<stepId>`; see [plans.md → Deploy parameters](plans.md#deploy-parameters-deploy-block)). When the same step set must deploy with different methods — a plain-CREATE staging run, a chain with no CREATE3 factory — you declare a **method variant** of the workflow instead of editing the plan. See [Method variants](#method-variants--variantof) below.

**Salt and factory are not set on the step** — they live in the plan, keyed by step id: `deploy.salts.<stepId>` and `deploy.factories.<stepId>`. So a step that deploys the same contract twice gets a distinct address by giving each step a distinct salt entry in the plan (a step with no explicit salt falls back to the plan's `saltBase` with a warning). See [plans.md → Salt resolution and fallbacks](plans.md#salt-resolution-and-fallbacks).

### CREATE3 factory flavors — `factory`

`create3` is not a single contract — several factory implementations exist, with different interfaces, different address-derivation formulas, and different front-running protection models. A `create3` step picks its implementation with the optional `factory` field (default: `oneInch`):

```yaml
- action: cross-chain-swap.v2.escrow-factory
  method: create3
  factory: createx             # canonical CreateX singleton — no factory address needed
```

Like `method`, the flavor is **structural and decided entirely in this file** (overridable only by a [method variant](#method-variants--variantof), never by the plan) — the plan supplies only the factory *address* for the flavors that need one. Very briefly, the three flavors:

- **`oneInch`** (default) — the 1inch `Create3Deployer` (`deploy(bytes32, bytes)`). Needs a per-chain factory address from the plan (`deploy.factories.<stepId>`). Front-running protection is **ownership-based**: only the factory owner can deploy through it, and the resulting address depends only on factory + salt — **not on the caller**. A vanity address can therefore be mined once and deployed from any owner wallet.
- **`createx`** — the canonical [CreateX](https://github.com/pcaversaccio/createx) singleton (`deployCreate3(bytes32, bytes)`), same address (`0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed`) on the 100+ chains where it is deployed — **no factory entry in the plan**. Front-running protection is **salt-based**: sender (and cross-chain redeploy) protection is encoded in the salt bytes, so the address depends on the deployer wallet — mining a vanity salt requires knowing the exact caller address beforehand. Not literally universal (e.g. zkSync Era's different address derivation excludes it) — on such chains, switch the flavor or clamp the method via a chain-aware [method variant](#method-variants--variantof).
- **`solady`** — a factory built on Solady's `CREATE3` library. Needs a per-chain factory address from the plan, like `oneInch`. Front-running protection is **salt-based**, same model as CreateX (caller-namespaced salt): the address is tied to the deployer wallet, so vanity-salt mining is done for a wallet known in advance.

The key contrast: **1inch protects via ownership and decouples the address from the calling wallet; CreateX and Solady protect via the salt and couple the address to a specific, pre-known deployer wallet.** A detailed comparison — address-derivation formulas, salt-guarding mechanics, per-chain availability, how to choose — is planned for the user guide.

> **`factory` (flavor) vs `deploy.factories` (addresses).** The step's `factory` says *which factory implementation* a `create3` step deploys through; the plan's `deploy.factories.<stepId>` supplies *that factory's address* per chain, for the flavors that need one (`oneInch` / `solady` — `createx` is address-canonical). Same concept, two layers: the workflow picks the kind, the plan supplies the data.

`factory` is valid only on a step whose `method` is `create3` (any other combination is a load-time error). When a variant clamps such a step to a different method on some chain, the flavor is simply unused there — same rule as the plan's unused salt/factory entries.

## Method variants — `variantOf`

A workflow's structure — steps, order, wiring — plus each step's `method` fully determines how a launch deploys. Sometimes the *same* structure must run with a *different deploy strategy*: clamp everything to plain CREATE for a staging run, or downgrade one chain that has no CREATE3 factory. Duplicating the whole workflow for that would copy all the wiring just to flip one field.

A **method variant** solves this. It is a top-level entry in this file that points at an existing workflow via `variantOf` and overrides **only the deploy strategy** of individual steps — three per-step knobs, nothing else:

- `methods` — the deployment method (*how* a step deploys);
- `factories` — the CREATE3 factory flavor (*through which factory* a `create3` step deploys — see [CREATE3 factory flavors](#create3-factory-flavors--factory)); the typical use is chain-aware: switch a chain where the base flavor's factory doesn't exist;
- `keys` — the signing-key slot (*who* signs it). Changing the method often changes the wallet too: plain CREATE derives the address from (deployer wallet, nonce), so it may need a dedicated same-nonce wallet, while CREATE3 can sign with anything.

No steps, no data wiring: a variant never touches `mappings` beyond the step's effective `privateKey` slot. If the wiring differs, it is a different workflow, not a variant. And like the base workflow, a variant carries **names only** — the key slot is a name resolved against the plan's `secrets:`; no credential value ever appears here.

```yaml
aqua-stack:                        # the base workflow
  steps:
    - action: aqua.v2.escrow-factory
      method: create3
    - action: aqua.v2.router
      method: create2
    - workflow: create3-infra      # nested workflow

aqua-stack-plain:                  # variant: staging clamp — every step plain CREATE
  variantOf: aqua-stack
  methods:
    "*": create
  keys:
    escrow-factory: sameNonceDeployer   # CREATE address depends on the wallet — pin it
                                        # (a slot the plan defines under secrets:)

aqua-stack-zk-safe:                # variant: create3 everywhere except zksync
  variantOf: aqua-stack
  chains:
    zksync:
      methods:
        "*": create                # zksync has no canonical CREATE3 factory
      keys:
        escrow-factory: zkDeployer

aqua-stack-1inch-fallback:         # variant: CreateX everywhere, 1inch factory where CreateX is absent
  variantOf: aqua-stack
  factories:
    "*": createx                   # no factory entries needed on most chains
  chains:
    somechain:
      factories:
        "*": oneInch               # CreateX not deployed here — plan supplies the factory address
```

How it works:

- **A variant is a workflow id like any other.** A plan points at it via its `workflow` field, result paths use it (`workspace/results/<variantId>/...`), and it can be referenced as a nested `workflow:` step. It resolves to the base workflow's exact steps and wiring, with the overrides applied.
- **Overrides come in two scopes.** The chain-agnostic maps (`methods`, `factories`, `keys`) apply on every chain; `chains.<chainName>.methods` / `chains.<chainName>.factories` / `chains.<chainName>.keys` apply only on that chain. All are maps keyed by step id — dotted ids reach into nested workflows (`create3-infra.deployer`). `methods` and `factories` also accept the wildcard key `"*"` — for `methods` it targets every contract/module step (non-deployment steps are unaffected); for `factories` only the steps whose resolved method is `create3`; `keys` has no wildcard — to re-key a whole variant, bind the default `privateKey` slot to a different vault entry in the variant's plan instead.
- **Steps not mentioned keep the base behavior.** A variant overrides only what it lists; everything else inherits from the base workflow's steps.
- **Method resolution** for a contract/module step on chain `c` is, in precedence order: variant `chains.<c>.methods.<stepId>` → variant `chains.<c>.methods."*"` → variant `methods.<stepId>` → variant `methods."*"` → base step `method` → `create`. For a plain (non-variant) workflow only the last two apply. Resolution is fully static: given a workflow id and a chain, the method of every step is known at load time, before the plan is consulted.
- **Factory-flavor resolution** is analogous and equally static: variant `chains.<c>.factories.<stepId>` → variant `chains.<c>.factories."*"` → variant `factories.<stepId>` → variant `factories."*"` → base step `factory` → `oneInch`. It applies only to steps whose resolved method on that chain is `create3`; for any other resolved method the flavor is ignored.
- **Key-slot resolution** is analogous: variant `chains.<c>.keys.<stepId>` → variant `keys.<stepId>` → the base step's `mappings.privateKey` rename → the default `privateKey` slot. The resolved slot is looked up in the plan's `chains.<c>.secrets` like any other secret rename; a missing slot is the usual "secret X not found" error — surfaced at static planning for deploying steps, at step input resolution for other key consumers.
- **The plan follows the variant.** Which salt/factory data a step needs is computed per chain *after* method and factory-flavor resolution — a step clamped to `create` on one chain simply doesn't need its salt or factory entries there, and a step resolved to `factory: createx` needs no factory-address entry at all (unused entries are harmless). Since plans are per-workflow files, a variant gets its own plan (`workspace/configs/plans/<variantId>.yaml`), which must define whatever key slots the variant names.
- **When you do (and don't) need `keys`.** Key *values* always live in the plan, per chain — so "the variant signs with a different wallet everywhere" needs no `keys` at all: bind the same slot names to different vault entries in the variant's plan. `keys` exists for the per-step case the plan cannot express: steps that share a slot in the base (e.g. the default `privateKey`) but must diverge in the variant because one step's new method demands its own wallet.

Field reference: [Field reference → `WorkflowVariant` fields](#workflowvariant-fields). Validation: [Method variants](#method-variants) under validation rules. The secret model behind slots: [secrets.md](secrets.md#multi-pk-via-named-secrets).

## Mappings — the wiring layer

Per-step `mappings` is the wiring layer that decides where each of a step's inputs resolves. Most mapping values are a **simple source** in one of **two forms**, distinguished purely by whether the value contains a `.`:


| Form                      | Detection                                                                                            | Meaning                                                                                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Step output reference** | Mapping value contains a `.` (e.g. `"router.AGGREGATION_ROUTER_V6_ADDRESS"`)                     | Wires this input to a previously-executed step's output. The part before the dot is a sibling step's id; the part after is the output's **declared name** on the source action. An array-valued output may carry an index suffix (`"deploy-oracles.DEPLOYED_ORACLES[0]"`) to extract one element — see [Splitting arrays](#splitting-arrays-pick--index-access). |
| **Rename**                | Mapping value has no `.` (a bare identifier, e.g. `"FEE_TAKER_OWNER_ADDRESS"`, `"privateKey1"`). | The engine looks up `<value>` instead of `<key>` on the appropriate side of the plan. Use it when one shared address has different meanings to different steps (e.g. owner vs treasurer), or to address a per-step secret slot.          |


The mapping is purely a renaming layer — it never carries values, env refs, vault refs, or `${...}` substitution syntax of any kind. Where the renamed name resolves depends on the mapping **key**, not on the value:


| Key kind                                                 | Looked up under                | Example                                                                |
| -------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| Ordinary declared input (in the action's `inputs` array) | `chains.<c>.constants.<value>` | `mappings: { OWNER_ADDRESS: FEE_TAKER_OWNER_ADDRESS }`         |
| Built-in parameter (`builtin.<NAME>`, declared by the action type — see [actions.md → Built-in parameters](actions.md#built-in-parameters)) | `chains.<c>.constants.<value>` | `mappings: { builtin.CALL_ADDRESS: escrow-factory.ESCROW_FACTORY_ADDRESS }` |
| Secret-targeted (`privateKey`)                           | `chains.<c>.secrets.<value>`   | `mappings: { privateKey: privateKey1 }`                                |


**No mapping for a key** = look up by its **original name** in the appropriate place (`constants` for ordinary inputs; for a built-in, the literal `builtin.<NAME>` constant key; for the implicit `privateKey`, use the default `secrets.privateKey`).

Important details:

- Step output references can also reach into **nested workflows**, using a dotted path: `"create3-deployer.CREATE3_DEPLOYER_ADDRESS"` works whether `create3-deployer` is an action step or a nested workflow step.
- Step output references must point at a **prior** step. Forward references are validation errors.
- Rename values are bare identifiers matching `^[a-zA-Z][a-zA-Z0-9_]*$` (SCREAMING_SNAKE_CASE conventional for constants; camelCase for secret slots like `privateKey1`). They are not `${...}` references — substitution syntax does not apply here.
- Per-step deployment strategy is **not** a mapping in v2 — it is the step's `method`, optionally overridden by a [method variant](#method-variants--variantof). The plan never changes it.
- **Built-in parameter keys behave exactly like ordinary input keys.** A `builtin.<NAME>` key accepts step output references (the typical pattern on a `contract-call` step: `mappings: { builtin.CALL_ADDRESS: escrow-factory.ESCROW_FACTORY_ADDRESS }` wires the just-deployed address into the call), bare renames, and full production-pipeline values (`transform` / `combine` / `pick`). Per-step renames are how two steps of the same action target different contracts:

```yaml
- id: set-fee
  action: resolver.v1.set-fee            # type: contract-call
  mappings:
    builtin.CALL_ADDRESS: ESCROW_FACTORY_ADDRESS       # rename → plan constant
    FEE_BPS: DEFAULT_FEE_BPS
- id: set-fee-old
  action: resolver.v1.set-fee            # same action, different target
  mappings:
    builtin.CALL_ADDRESS: ESCROW_FACTORY_ADDRESS_OLD   # different constant
    FEE_BPS: DEFAULT_FEE_BPS
```

  The unmapped fallback (`constants` key `builtin.CALL_ADDRESS`) is **shared** — every unmapped step of the type reads the same key — so per-step differentiation always happens here, in the workflow (rename or step output ref).
- Secret renames are how multi-PK workflows distinguish per-step keys without baking values into the workflow. See [secrets.md → Multi-PK via named secrets](secrets.md#multi-pk-via-named-secrets) for the full three-layer flow (vault → plan secrets → workflow rename). A [method variant](#method-variants--variantof) can override this rename per step (its `keys` map) — e.g. when flipping a step's method also demands a different wallet.
- There is no private-key input name to map — the key is engine-injected from `secrets:` and never appears in an action's `inputs`. Use the `privateKey` mapping key to rename to a different secret slot. (A v1-style `OPS_PRIVATE_KEY` mapping key has no special meaning in v2 — it would refer to an ordinary input of that name, never the signing key.)
- **The rename takes a name, not a value.** A workflow mapping like `privateKey: privateKey1` says "for this step, read `chains.<c>.secrets.privateKey1` instead of the default `chains.<c>.secrets.privateKey`." The credential value itself is **only** authored in the plan (typically as a `${vault.X}` ref). There is no syntax for putting a literal, an `${env.X}` ref, a `${vault.X}` ref, or a `${secret.X}` ref directly in a workflow mapping. This separation is intentional: it lets one workflow be reused unchanged across many plans that wire a different physical key per step (e.g. dev vs prod, regular-deployer vs same-nonce-deployer) by editing the plan alone.
- Inputs the action marks as `inputConstants` are **not** valid mapping keys — they're hard constants on the action. Attempting to map them is a validation error.

### Production pipeline: transforms, combine, and split

The two simple forms above wire **one source to one input, unchanged**. When an input needs its value *transformed*, *assembled from several sources*, or *extracted from an array*, a mapping value can instead be a **list** or an **object** — the production pipeline. This is where the transform axes live (the encoding axis is shared with actions; see [actions.md → Input shape](actions.md#input-shape-arity-and-encoding-transforms)). For *why* it is designed this way, see [design-decisions.md → Value transforms](design-decisions.md#value-transforms).

```yaml
mappings:
  # List sugar — assemble an array from several sources (= combine: array).
  CONNECTORS: [WETH_ADDRESS, USDC_ADDRESS, DAI_ADDRESS]

  # Object form — explicit `from` (+ optional per-source `transform`) and `combine`.
  ORACLE_TYPES:
    from:
      - { from: UNIV3_TYPE_LABEL, transform: [keccak256] }   # constant, hashed
      - chainlink-oracle.ORACLE_ADDRESS                       # step output, as-is
    combine: array

  # Scalar object form — a single source with an adaptation transform.
  POOL_SALT:
    from: POOL_LABEL
    transform: [keccak256]

  # Split — extract one element of an array-valued source (index sugar / pick).
  PRIMARY_ORACLE: deploy-oracles.DEPLOYED_ORACLES[0]
```

Each **source** is itself a simple source (a step output ref or a bare-name rename), optionally wrapped as `{ from: <ref|rename>, pick?, transform: [..] }` to carry its own extraction and encoding. Sources never use `${...}` — the same rule as the simple forms.

**Three axes, applied in a fixed order.** For an input `K`, the final value is:

```
final = actionTransform( combine( perSourceTransform( pick(source_i) ) ) )
```

1. **Per-source `pick` (structural, 1→1 extraction, split).** If the source resolves to an **array** (an `array: true` step output, or a plan constant holding a JSON array), `pick` extracts one element before anything else runs. The index sugar `stepId.OUTPUT[i]` is shorthand for `{ from: stepId.OUTPUT, pick: i }`. `pick` is the dual of `combine`: `combine` merges N sources into one value, `pick` splits one array value out to an element. See [Splitting arrays](#splitting-arrays-pick--index-access).
2. **Per-source `transform` (encoding, 1→1, adaptation).** Each source's encoding chain (`salt`, `keccak256`) runs next, on the (possibly picked) scalar. It exists to *adapt* an incoming value into the shape the action expects — it can never override the action's own declared `transform` (see [actions.md → Input shape](actions.md#input-shape-arity-and-encoding-transforms)). Per-source transforms are **independent**: in one `combine: array` you can hash some elements and pass others through, mixing step outputs and constants freely.
3. **`combine` (structural, N→1, assembly).** Groups the resolved sources into one parameter. Workflow-only (only the workflow knows the multiple sources), one per mapping:


| `combine`                                 | Output       | What it produces                                                                                          |
| ----------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| `array`                                   | array        | The sources as a list. The bare list form `[a, b, ...]` is sugar for this. Target input must be `array: true`. |
| `abiEncode("type1,type2,...")`            | scalar `bytes` | `abi.encode` of the sources by the given types (positional).                                              |
| `abiEncodePacked("type1,type2,...")`      | scalar `bytes` | `abi.encodePacked` (non-standard tightly-packed encoding).                                                |
| `abiEncodeWithSignature("fn(type1,...)")` | scalar `bytes` | 4-byte selector (from the signature) + `abi.encode` of the args — i.e. calldata, e.g. a proxy `initData`. |


4. **Action `transform` (authoritative, applied last).** If the consuming input declares a `transform`, the engine applies it to the produced scalar value at the very end — even after a `bytes`-producing combine (so `keccak256(abiEncode(...))` is expressible). It is never removed by the workflow.

**Why the encode variants take an argument.** Mapping values flow through deploy-pad as untyped strings, and the destination `bytes` input is opaque — neither the source nor the action carries the ABI types. So the type list (or full signature, which also yields the selector) must be given on the `combine` itself. See [engine-internals.md → Transforms](engine-internals.md#transforms) for how the engine parses it and encodes via ethers.

**Worked example — proxy `initData`.** Assemble calldata from several sources, hashing one of them first, then encode with the initializer's signature:

```yaml
- action: my-proxy.v1.transparent-proxy
  id: proxy
  mappings:
    IMPLEMENTATION: oracle-impl.ORACLE_IMPL_ADDRESS
    PROXY_INIT_DATA:
      from:
        - OWNER_ADDRESS                                  # constant, as-is
        - { from: NAMESPACE_LABEL, transform: [keccak256] }  # constant, hashed to bytes32
      combine: abiEncodeWithSignature("initialize(address,bytes32)")
```

### Splitting arrays: `pick` / index access

`combine` merges N values into one; **`pick` is its dual** — it splits one element out of an array-valued source. It exists for steps whose actions declare `array: true` **outputs** ([actions.md → Output shape](actions.md#output-shape-names-and-arity)): a batch deployment reports `DEPLOYED_ORACLES=["0x..","0x.."]`, and a downstream step needs one element in a scalar input.

Two equivalent spellings:

```yaml
mappings:
  # Index sugar on a step output ref — the common case.
  PRIMARY_ORACLE: deploy-oracles.DEPLOYED_ORACLES[0]

  # Object form — required when chaining an encoding transform after the pick.
  ORACLE_SALT:
    from: deploy-oracles.DEPLOYED_ORACLES
    pick: 1
    transform: [keccak256]
```

Rules:

- `pick` (and the `[i]` sugar) is valid only on a source that resolves to an **array**: a step output declared `array: true`, or a plan constant holding a JSON-array value. Picking from a scalar source is a validation error.
- The index is a non-negative integer **literal** — no expressions, no references. Arity (array vs scalar) is checked at validation time; an index beyond the array's actual length is a resolution-time error naming the step, the output, the index, and the actual length (array lengths are generally known only at run time).
- The picked value is a **scalar**: it feeds a scalar input directly, passes through per-source `transform` like any scalar, and can be one source among several in a `combine`.
- An array-valued source wired to a **scalar** input without a `pick` is an error — the dual of "scalar source into an `array: true` input with no `combine`."
- `pick` extracts **one element per source**. To take several elements, reference the same array source multiple times with different indexes (`...[0]`, `...[1]`). There is no slice or multi-element form; assembling a new array from picked elements is an ordinary `combine: array` of indexed sources.
- Like all mapping machinery, `pick` is pure shaping: it does not affect the aggregated interface of nested workflows and never appears in an action definition.

**Validation:**

- The `combine` output type must match the consuming input's declared arity/type: `array` requires `array: true`; the `abiEncode*` variants target a **scalar `bytes`** input (`array: false`).
- The `combine` argument's type/arg count must match the number of sources in `from`.
- A bare list / `combine: array` into a non-`array` input, or a scalar source into an `array: true` input with no `combine`, is an error.
- `pick` / `[i]` on a non-array source is an error; an array source into a scalar input without `pick` is an error; a `pick` index must be a non-negative integer literal (out-of-range is a resolution-time error).
- Per-source `transform` (and any action `transform`) is an **encoding** transform only — you cannot nest a `combine` inside a single source (no arrays-of-arrays / encode-of-encode).

## Nesting and the aggregated interface

When a step has a `workflow` field, the engine **flattens** it at execution time — every nested action step becomes a sibling of the parent's other steps, with its id prefixed by the nesting step id (`outer.inner` etc.). Mappings set on the nesting step are passed down into the nested steps — see [Value resolution](#value-resolution) for how that works, with a worked example.

From the **outside**, a nested workflow looks like one step with a single input set and a single output set. This view is the **aggregated interface**:

- **Aggregated inputs** = the minimal set of external parameters the nested workflow needs. Inputs that are wired internally (one nested step's output feeding another's input) are not external. Multiple internal inputs aliased to the same external name appear once. Private keys are not aggregated as inputs in v2 — they're sourced from `${secret.privateKey}` per chain ([secrets.md](secrets.md)).
- **Aggregated outputs** = every output produced by every nested action step, with hierarchical step ids (`stepId.nestedStepId.OUTPUT_NAME`).

For a **production-pipeline** mapping (list/object value), each source is classified independently: a constant **rename** source contributes its external name as an aggregated input, while a **step output** source is internal wiring and contributes nothing external. The pipeline's destination input is not itself an aggregated input — only its leaf rename sources are. (Per-source `pick`, `transform`, and `combine` are pure shaping; they do not add or remove external names.)

The editor uses this for step-card summaries and parameter analysis; the engine uses it for "virtual step" representations.

## Value resolution

Every step input ends up with a value in two stages. First, mappings from parent workflows are folded into each step. Then each input is looked up. The rules below cover every way an input can get its value.

### Per-step lookup

Each input on a step is resolved on its own. For an input named `K`:

1. **If the step has a mapping for `K`** (`mappings: { K: V }`):
   - **`V` is a string** → read by the dot rule: a value containing a `.` points at a prior step's output (`stepId.OUTPUT`, optionally with an index suffix `stepId.OUTPUT[i]` on an array output; works for nested workflows too — a missing step/output is an error); a value with no `.` is a **rename** (read the constant named `V` instead of `K`, or for `privateKey` the secret named `V`). See [Mappings](#mappings--the-wiring-layer) for which side of the plan each key reads from.
   - **`V` is a list or an object** → it's a **production pipeline**: resolve each source, apply per-source `pick`, then per-source `transform`, then `combine`, then the action's own `transform`. See [Production pipeline](#production-pipeline-transforms-combine-and-split). Each source inside still follows the string dot rule above.
2. **If the step has no mapping for `K`** → the engine reads the constant named `K` (the input's own name); the action's declared `transform`, if any, still applies.
3. **Constant lookup** reads the chain's constants (the active preset's `defaults.constants` plus the chain's own preset values, with the chain winning), after preset selection, overrides, and all `${...}` references have been resolved. A name that isn't there is an error (`Constant 'X' not found`).

Built-in parameter keys (`builtin.<NAME>`, e.g. `builtin.CALL_ADDRESS`) follow the same rule (a dotted value points at a prior step's output; a bare value is a rename); with no mapping, the engine reads the constant under the literal `builtin.<NAME>` key, falling back to the type-declared default for optional built-ins. See [actions.md → Built-in parameters](actions.md#built-in-parameters).

### How nesting composes

When a workflow is nested, the mappings on the nesting step are folded into the nested steps before lookup runs, so each step ends up with one final mapping. Two rules drive this:

- **External name.** Each input has a name the enclosing workflow sees from the outside — its *external name*. That's the input's rename target if it has one, otherwise the input's own name. (This is the name shown in the aggregated interface.)
- **Parent override.** If a nested input's external name matches a key in the parent's mappings, the parent's value wins. Renames therefore chain together: an inner rename followed by a parent rename collapses into a single lookup, and chains of any depth collapse to the outermost value.

Two things to keep in mind:

- **References to a prior step's output are never replaced** by a parent rename. They're only re-pointed at the right step after flattening.
- **A parent rename can reach an input the nested workflow didn't rename.** Since an un-renamed input's external name is just its own name, a parent mapping keyed on that name still applies. The flip side: the parent must use the **external** name — if a nested step renamed its input to `EXECUTOR_OWNER_ADDRESS`, the parent keys on `EXECUTOR_OWNER_ADDRESS`, not on the original input name.

### Worked example (fan-out across a nesting boundary)

Say one **protocol owner** address should own both the aggregation router and the (nested) execution layer. The router is a direct action step; the executors live in a nested workflow that exposes its owner input under its own name. A single plan constant drives both.

```yaml
# workflows.yaml — the nested workflow
aggregation-executors:
  steps:
    - action: aggregation-executors.v1.simple
      id: simple
      mappings:
        # `simple`'s OWNER_ADDRESS is exposed externally as EXECUTOR_OWNER_ADDRESS
        OWNER_ADDRESS: EXECUTOR_OWNER_ADDRESS

# workflows.yaml — the parent
aggregation-router-and-lo:
  steps:
    - action: aggregation-router.v1.router
      id: router
      mappings:
        OWNER_ADDRESS: PROTOCOL_OWNER_ADDRESS          # router owner ← shared constant
    - workflow: aggregation-executors
      mappings:
        EXECUTOR_OWNER_ADDRESS: PROTOCOL_OWNER_ADDRESS  # nested owner ← same shared constant
```

```yaml
# plan — the active preset's per-chain values
chains:
  mainnet:
    constants:
      PROTOCOL_OWNER_ADDRESS: "0x1111111254EEB25477B68fb85Ed929f73A960582"
```

Resolution:

- `router.OWNER_ADDRESS` → rename → `constants.PROTOCOL_OWNER_ADDRESS`.
- The nested step's `{ EXECUTOR_OWNER_ADDRESS: PROTOCOL_OWNER_ADDRESS }` is pushed into `simple`. `simple`'s input `OWNER_ADDRESS` has external name `EXECUTOR_OWNER_ADDRESS`, which is a parent key — so its mapping collapses from `OWNER_ADDRESS → EXECUTOR_OWNER_ADDRESS` to **`OWNER_ADDRESS → PROTOCOL_OWNER_ADDRESS`** → `constants.PROTOCOL_OWNER_ADDRESS`. After flattening, that step's id is `aggregation-executors.simple`.

So a **single** plan constant `PROTOCOL_OWNER_ADDRESS` fans out to both the router's owner and the executor's owner (through the nested workflow). To give them different owners later, rename each to its own constant (e.g. `ROUTER_OWNER_ADDRESS` and `EXECUTOR_OWNER_ADDRESS`) and author two constants — no workflow edit beyond the rename.

## Cross-generation composition

A workflow can include steps from **different generations of the same repo** in the same run — a capability unlocked by the `repo → generation → { releases, actions }` structure (see [actions.md](actions.md#generations--the-stable-interface)).

Typical use cases:

- Migration deployments: deploy a v2 contract that needs to know the v1 contract's address.
- Side-by-side comparison or canary deployments.
- Bridging old and new versions of a protocol from a single workflow.

```yaml
escrow-migration:
  description: "Deploy v2 escrow factory and a migrator that knows the v1 address."
  steps:
    - action: cross-chain-swap.v1.escrow-factory
      id: escrow-factory-v1                     # explicit id required (collides with v2 default)
    - action: ccs-escrow                        # action alias for cross-chain-swap.v2.escrow-factory
      id: escrow-factory-v2                     # explicit id (alias default would be 'ccs-escrow')
    - action: cross-chain-swap.v2.escrow-migrator
      mappings:
        OLD_FACTORY_ADDRESS: escrow-factory-v1.ESCROW_FACTORY_ADDRESS
        NEW_FACTORY_ADDRESS: escrow-factory-v2.ESCROW_FACTORY_ADDRESS
```

The second step uses the action **alias** `ccs-escrow` in its `action` field (declared on `cross-chain-swap.v2.escrow-factory` in [actions.md](actions.md#full-example)) instead of the full FQ id. Because an aliased `action`'s default step id is the alias itself, an explicit `id` is still needed here. The plan picks which release pin each generation deploys from — `v1` and `v2` resolve independently (see [plans.md → Release selection](plans.md#release-selection)).

How the engine handles this, with no special-casing required by the author:

- Each step is checked out into its own per-pin workspace directory (e.g. `workspace/repos/cross-chain-swap/v1/<releaseId>/` and `.../v2/<releaseId>/`, where `<releaseId>` is the pin the plan selected for that generation); v1 and v2 builds don't contaminate each other.
- Step output references resolve by step id, not by output name — so `escrow-factory-v1` and `escrow-factory-v2` both producing `ESCROW_FACTORY_ADDRESS` is unambiguous.
- ABI capture is step-scoped (`artifacts/escrow-factory-v1/EscrowFactory.abi.json` vs. `artifacts/escrow-factory-v2/...`); no collision.
- Each step's recorded reference (`action` / `workflow`) in `result.yaml` carries the generation id, and the run records the selected release pin (and its resolved commit), so "which version produced this address" is recoverable from the result alone.

## Relationships to other configs


| Other config                   | Relationship                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [actions.md](actions.md)       | Steps reference actions via the `action` field — by FQ id (`<repoId>.<generationId>.<actionId>`) or by the action's optional `alias`. The action's `inputs` define what `mappings` keys are valid; its `outputs` (declared names, scalar or `array: true`) define what `<stepId>.<outputName>` refs other steps can use (array outputs also allow indexed refs `<stepId>.<outputName>[i]`). The plan (not the workflow) selects which release pin a generation runs from — see [plans.md → Release selection](plans.md#release-selection). |
| [plans.md](plans.md)           | Each plan's `workflow` field is a workflow id from this file. The workflow's leaf-level (post-flatten) inputs are what the plan must supply via `constants` (after applying mappings).                                                                                                                                                                                                                                                        |
| [references.md](references.md) | The `${...}` substitution system **does not apply** inside a workflow. `mappings` values are step output refs, bare-name renames, or production-pipeline lists/objects (`from` + `transform` + `combine`) — never `${...}`. The transform/combine machinery is a separate wiring-layer mechanism from `${...}` (see [references.md → Transforms](references.md#transforms-vs--substitution)). References live one layer up, in plan constants and secrets.                                                                                                                                                                                                               |


## Validation rules & common errors

Most checks are enforced by the workflow loader at config load. The schema can validate **shape** (required fields, types, exactly-one-of `action`/`workflow`, mapping value form) but cannot validate **referential integrity** — that the referenced `action` or `workflow` exists, that mappings reference a prior step, that there are no cycles, that mapping output names match the source step's declared outputs. Those are the loader's job.

### Workflow and step shape

- **Unknown `action`** — error. An `action` value must resolve to an action FQ id or an `alias` declared in `actions.yaml`.
- **Unknown `workflow`** — error. A `workflow` value must be a workflow id (a top-level key in this same file).
- **Duplicate step ids** — error. Within one workflow, every step id (explicit or derived) must be unique.
- **A `method` on a non-contract/module `action`** — error. The loader rejects `method` on an `action` whose type isn't `forge-contract` / `hardhat2-contract` / `hardhat3-contract` / `hardhat3-module`.
- **A `factory` on a step whose `method` isn't `create3`** — error. The flavor selects a CREATE3 factory implementation; it has no meaning for `create` / `create2`. (Rejected on a `workflow` step by the schema, same as `method`.)
- **`create3` on a `hardhat3-contract` / `hardhat3-module` step** — error before anything runs (Ignition has no create3 strategy): at load for the step's own `method`, at static planning for a variant override that resolves to `create3` on such a step.

### Method variants

- **`variantOf` references an unknown workflow id** — error.
- **`variantOf` references another variant** — error. Variants are one level deep: the target must be a plain workflow (an entry with `steps`). This keeps every variant's full override map readable in one place.
- **A `methods`, `factories`, or `keys` key (chain-agnostic or per-chain) names a step id that doesn't exist** in the base workflow (dotted ids resolve through nested workflows) — error.
- **A `methods` key names a non-contract/module step** — error, same rule as `method` on the step itself. (The `"*"` wildcard is exempt — it targets only contract/module steps and skips the rest.)
- **A `factories` key names a step whose method can never resolve to `create3`** on any chain of the variant — error, same rule as `factory` on the step itself. (The `"*"` wildcard is exempt — it targets only steps resolving to `create3` and skips the rest.) Values must be one of `oneInch` / `createx` / `solady`.
- **A `keys` key names a step that consumes no private key** (not a deploying step and not a `mode: send` `contract-call`) — error. There is no key to re-slot.
- **A `keys` value that isn't a bare slot name** (matching `^[a-z][a-zA-Z0-9]*$`) — error. Slot values are names resolved against the plan's `secrets:` — never `${vault.X}` / `${env.X}` / literal credentials, same rule as the `privateKey` mapping. (A slot the plan doesn't define fails later with the usual "secret X not found" — at static planning for deploying steps, at step input resolution otherwise.)
- **A variant with no overrides at all** (no `methods`, no `factories`, no `keys`, no `chains.<c>` entry) — error. An empty variant is an alias, not a variant; point the plan at the base workflow instead.
- **A `chains` key that isn't a chain name from `known-chains.yaml`** — error.

### Mapping references and renames

- **Forward step output ref** — error. A mapping value `"futureStep.SOME_OUTPUT"` where `futureStep` appears later in the array is rejected.
- **Unknown step output ref** — error. The source step id must exist in this workflow.
- **Output not produced** — error. The output name in `"sourceStep.OUTPUT_NAME"` must be among the source action's declared outputs.
- **Index on a scalar output** — error. `"sourceStep.OUTPUT_NAME[i]"` is valid only when the source action declares that output `array: true`. See [Splitting arrays](#splitting-arrays-pick--index-access).
- **Self reference** — error. A step whose `workflow` equals the enclosing workflow id.
- **Cycle through nested workflows** — error. The loader walks nested workflow includes and rejects any cycle.
- **Mapping a `builtin.` key the step's action type does not declare** (e.g. `mappings: { builtin.CALL_ADDRESS: ... }` on anything but a `contract-call` step) — error. Each type's built-in set is known to the engine, so an undeclared name is always an authoring mistake.
- **Renaming an input that is set as `inputConstants` on the consuming action** — error. The input is a hard constant of the action; renaming it is forbidden.
- **No implicit private-key mapping key** — the v1 `OPS_PRIVATE_KEY` name has no special meaning in v2; a mapping with that key refers to an ordinary declared input (or fails as an unknown input like any other). Use the `privateKey` mapping key to rename to a different secret slot.

### Production pipeline (list / object mapping values)

- **`combine` output type vs. input arity** — error. `array` (and the bare list form) requires the consuming input to be `array: true`; the `abiEncode*` variants require a **scalar `bytes`** input (`array: false`).
- **Source count vs. `combine` argument** — error. The number of sources in `from` must match the type list / signature arg count of `abiEncode` / `abiEncodePacked` / `abiEncodeWithSignature`.
- **Scalar into an `array: true` input with no `combine`** — error. An array input must be fed a list (`[a, b]`) or an object with a list `from` + `array` combine.
- **Nesting a `combine` inside a single source** — error. A source's `transform` is an **encoding** transform only (`salt` / `keccak256`); structural combines apply once, at the mapping level.
- **`${...}` inside a `from` source** — error. Sources are step output refs or bare-name renames, same as the simple forms.
- **Unknown `combine` op or malformed argument** — error (schema/loader): the value must be `array` or `abiEncode(...)` / `abiEncodePacked(...)` / `abiEncodeWithSignature(...)` with a parenthesized type-list / signature.

### Common authoring mistakes

- Expecting a templated or renamed output key (a v1-ism — `expected`/`as` output mapping is gone in v2). A step output ref always uses the output's **declared name** exactly as it appears in the source action's `outputs`.
- Listing the same action twice with no explicit `id` — derived ids collide.
- Expecting a `method` field on the consuming `forge-contract` / `hardhat2-contract` / `hardhat3-contract` action. There is no such field on the action in v2 — the deployment strategy is the step's `method` here, overridable only by a [method variant](#method-variants--variantof) (never by the plan).
- Trying to map `OPS_PRIVATE_KEY` expecting it to carry the signing key — a v1-ism; in v2 the name is just an ordinary input name with no private-key meaning. Use `mappings: { privateKey: <secretSlot> }` to rename to a different `secrets.<slot>` entry.
- Renaming to a name that the plan doesn't define. The engine errors at step input resolution: "constant X not found" (for ordinary inputs / built-in parameters) or "secret X not found" (for secret-targeted inputs).
- Adding a `verify` mapping. It isn't an input — it's an action-level deployment field, set on the action itself ([actions.md → Deployment fields](actions.md#deployment-fields--when-deploys-true)).
- Trying to rename an input that the action marks as `inputConstants`. The whole point of `inputConstants` is that the value is fixed by the action — overriding it is rejected.

## Field reference

The field-by-field tables for every level of the file. The conceptual narrative lives in the body sections above — [Workflows](#workflows--ordered-compositions-of-steps), [Steps](#steps--references-ids-and-deploy-method), [Method variants](#method-variants--variantof), and [Mappings](#mappings--the-wiring-layer).

### Top-level fields

A workflows file is a YAML mapping at the top level. There is one reserved `version` key; every other key is a **workflow id** (matching `^[a-z][a-z0-9-]*$`), and each value is either a `Workflow` (has `steps`) or a `WorkflowVariant` (has `variantOf`). The same key is what a [plan](plans.md) puts into its `workflow` field.


| Field     | Type    | Required              | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------- | ------- | --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version` | integer | no (warns if missing) | —       | Config format version this file is written against (current: `2`). A value that differs from the engine's supported format version is a load-time **error** unless `--ignore-version` is passed (which downgrades it to a warning and proceeds). A **missing** `version` is always a warning recommending the key be added. See [engine-internals.md → Config version check](engine-internals.md#config-version-check). |


Every other top-level key is a workflow id mapping to a `Workflow` or a `WorkflowVariant`.

### `Workflow` fields


| Field         | Type     | Required | Default | Description                                      |
| ------------- | -------- | -------- | ------- | ------------------------------------------------ |
| `description` | string   | no       | —       | Free-form, surfaces in editor and logs.          |
| `steps`       | `Step[]` | yes      | —       | At least one step. Steps execute in array order. |


### `WorkflowVariant` fields

A deploy-strategy re-skin of another workflow — same steps, same data wiring; different per-step methods, CREATE3 factory flavors, and/or signing-key slots. See [Method variants](#method-variants--variantof).


| Field         | Type                                          | Required                                      | Default | Description                                                                                                                                                                                                                                                                                             |
| ------------- | --------------------------------------------- | ---------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description` | string                                        | no                                             | —       | Free-form, surfaces in editor and logs.                                                                                                                                                                                                                                                                 |
| `variantOf`   | string                                        | yes                                            | —       | Id of the base workflow (a top-level key in this file that has `steps` — a variant cannot point at another variant).                                                                                                                                                                                    |
| `methods`     | map<stepId \| `"*"`, method>                  | at least one of `methods` / `factories` / `keys` / `chains`  | `{}`    | Chain-agnostic method overrides. Keys are step ids of the base workflow (dotted for steps inside nested workflows, e.g. `create3-infra.deployer`) or the wildcard `"*"` (every contract/module step). Values: `create` / `create2` / `create3`. Steps not mentioned keep the base step's `method`.       |
| `factories`   | map<stepId \| `"*"`, flavor>                  | at least one of `methods` / `factories` / `keys` / `chains`  | `{}`    | Chain-agnostic CREATE3 factory-flavor overrides. Keys are step ids of the base workflow (dotted for nested steps) or the wildcard `"*"` (every step whose resolved method is `create3`; other steps are skipped). Values: `oneInch` / `createx` / `solady`. Steps not mentioned keep the base step's `factory` (default `oneInch`). Ignored for a step whose resolved method on the chain isn't `create3`. Maps flavors, not addresses — the per-step factory *addresses* live in the plan's `deploy.factories`. See [CREATE3 factory flavors](#create3-factory-flavors--factory). |
| `keys`        | map<stepId, slotName>                         | at least one of `methods` / `factories` / `keys` / `chains`  | `{}`    | Chain-agnostic signing-key slot overrides for steps that consume a private key. Keys are step ids (dotted for nested steps); values are bare slot names (`^[a-z][a-zA-Z0-9]*$`) resolved against the plan's `secrets:` — never `${...}` refs or literal credentials. Overrides the step's effective `privateKey` rename. No `"*"` wildcard — to re-key a whole variant, bind the default `privateKey` slot in the variant's plan instead. |
| `chains`      | map<chainName, { methods?: ..., factories?: ..., keys?: ... }> | at least one of `methods` / `factories` / `keys` / `chains`  | `{}`    | Per-chain overrides; the same `methods` / `factories` / `keys` shapes inside (each chain entry must set at least one of the three). Chain names must exist in `known-chains.yaml`. On that chain these win over the chain-agnostic maps; per-step keys win over `"*"` within each scope. Full precedence: [Method variants](#method-variants--variantof).  |


### `Step` fields


| Field      | Type                                  | Required                           | Default  | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------- | ---------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `action`   | string                                | exactly one of `action`/`workflow` | —        | References an **action** to run. Either an FQ id (`<repoId>.<generationId>.<actionId>`) or the action's optional `alias` (a bare token — see [actions.md → Common fields](actions.md#common-fields--every-action)); a value with a dot is an FQ id, a bare value is an alias resolved in `actions.yaml`. Mutually exclusive with `workflow`. See [Step references](#step-references--action-or-workflow).                                                                                         |
| `workflow` | string                                | exactly one of `action`/`workflow` | —        | References another **workflow** by id (a top-level key in this file) to nest and flatten. Mutually exclusive with `action`; a step must set exactly one. `method` is not allowed on a `workflow` step. See [Step references](#step-references--action-or-workflow).                                                                                                                                                                                                                               |
| `id`       | string                                | no                                 | derived  | Step id used for cross-step references and result paths. If omitted, the engine derives it — for an FQ-id `action`, the **last segment** (the actionId after the final dot); for an aliased `action` or a `workflow`, the bare token itself. **Within a single workflow, step ids must be unique** — when this default would collide (e.g. two steps referencing the same action under different generations), set `id` explicitly. See [Step id derivation](#step-id-derivation). |
| `method`   | string (`create`/`create2`/`create3`) | no                                 | `create` | Deployment method for a contract/module **`action`** step (`forge-contract`, `hardhat2-contract`, `hardhat3-contract`, `hardhat3-module`); rejected on a `workflow` step (schema) and on a non-contract/module `action` (loader). **Defaults to `create` when omitted** (and no variant override resolves). Only this file decides the method — a [method variant](#method-variants--variantof) can override it (globally or per chain); the plan never can. Per-step salt and factory live in the plan, not here. See [Per-step `method`](#per-step-method).  |
| `factory` | string (`oneInch`/`createx`/`solady`) | no                                 | `oneInch` | CREATE3 factory flavor — which factory implementation a `create3` step deploys through. Valid only when `method` is `create3` (error otherwise); rejected on a `workflow` step (schema). **Defaults to `oneInch` when omitted** (and no variant override resolves). `oneInch` and `solady` read their per-chain factory address from the plan (`deploy.factories.<stepId>`); `createx` uses the canonical singleton and needs no factory-address entry. Overridable only by a [method variant](#method-variants--variantof) (`factories` maps); the plan never can. See [CREATE3 factory flavors](#create3-factory-flavors--factory). |
| `mappings` | map<string, MappingValue>             | no                                 | `{}`     | Per-input wiring. Keys are either: (a) one of the consuming step's input names (the names declared by the action), (b) a **built-in parameter** of the step's action type (`builtin.<NAME>`, e.g. `builtin.CALL_ADDRESS` on `contract-call` — a `builtin.` key the type doesn't declare is an error), or (c) for steps that consume a private key, the special key `privateKey` (renames it to a different `secrets.<name>` slot in the plan). A `MappingValue` is a simple **string** (step output ref — optionally indexed, `stepId.OUTPUT[i]` — or bare-name rename), a **list** of sources (sugar for `combine: array`), or an **object** `{ from, pick?, transform?, combine? }` (the production pipeline — see [Production pipeline](#production-pipeline-transforms-combine-and-split)). Deployment method is not a mapping — it is the step's `method`. See [Mappings](#mappings--the-wiring-layer).                                   |


The machine-readable schema is [schemas/workflows.schema.yaml](schemas/workflows.schema.yaml).

## Full example

See [examples/workflows.yml](examples/workflows.yml) for a worked catalog: a leaf workflow, a reusable nested workflow, a parent that composes them with step-output and rename mappings, and a top-level entry point demonstrating per-step PK rename and parent-level mappings, with inline commentary on notable behaviors.