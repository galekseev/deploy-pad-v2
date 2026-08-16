# v2 naming reference

The v1 → v2 terminology map. v2 picks short, role-descriptive nouns for the three core concepts; everything else derives from them. The rename of code, workspace configs, v1 docs, and cursor rules is deferred to the coordinated migration sweep (see [design-decisions.md → Format migration](design-decisions.md#format-migration)) — this file is the reference for that sweep.

## Core nouns

| v1 term | v2 term | Rationale |
|---|---|---|
| atomic target | **action** | One indivisible thing the engine does — a contract deployment or a script invocation. |
| complex target | **workflow** | An ordered composition of actions (and nested workflows). Resolves the v1 "pipeline" overload — *pipeline* was both the colloquial name for a complex target and the name of the execution-config field pointing at one. |
| execution config | **plan** | The launch surface: which workflow, which chains, which parameter values, which credentials. |
| run | run (unchanged) | One execution attempt of a plan on a chain. |

## Derived terms

| v1 | v2 | Notes |
|---|---|---|
| target id (`<repo_id>.<target_id>` in v1 code; `<repoId>.<generationId>.<targetId>` in these docs) | action id — FQ form `<repoId>.<generationId>.<actionId>`, or the action's optional `alias` (a bare token) | Three-segment shape; the middle segment is the **generation**, not a code pin (the plan selects the pin). An action may also carry a short unique `alias`. |
| `AtomicTarget` (type name) | `Action` | Doc-level type names; code rename deferred. |
| `ComplexTarget` (type name) | `Workflow` | |
| `ExecutionConfig` (type name) | `Plan` | |
| `ExecutionConfigDefaults` (type name) | `PresetDefaults` | The plan-level `defaults` block is removed in v2 (presets are the only value layer); the type survives only as the preset's internal chain-agnostic baseline ([plans.md → Presets](plans.md#presets)). |
| deployment-role target (`deploys: true`) | **deploying action** | Plain adjective driven by the `deploys` flag; "role" noun dropped. |
| action-role target (`deploys: false`) | **non-deploying action** | Avoids the collision with the new *action* noun. |
| `Command` / `DeploymentCommand` (field-surface layer names) | base fields / deployment fields | Implementation-flavored class names dropped from config docs; the engine's Command classes remain code-level concepts ([engine-internals.md](engine-internals.md)). |
| `hardhat-contract` (target type) | `hardhat2-contract` (action type) | Same bundled Hardhat 2 deploy scripts; renamed to make room for the Hardhat 3 types `hardhat3-contract` / `hardhat3-module` (Ignition-based, [actions.md → `hardhat3-contract`](actions.md#action-type-hardhat3-contract)). |
| `hardhat-script` (target type) | `hardhat2-script` (action type) | Same `npx hardhat run` wrapper invocation; renamed to make room for `hardhat3-script` (Hardhat 3 toolchain, [actions.md → `hardhat3-script`](actions.md#action-type-hardhat3-script)). |
| `hardhat-call` (target type) | `contract-call` (action type) | v2 performs contract calls in the engine itself (in-process, via ethers) — no bundled Hardhat script, no repo toolchain ([actions.md → `contract-call`](actions.md#action-type-contract-call)). |
| `OPS_CALL_ADDRESS` (built-in input on `hardhat-call` targets) | `builtin.CALL_ADDRESS` built-in parameter | The v1 built-in input becomes a type-declared **built-in parameter** under the `builtin.` key class, remappable per step (typically wired to a prior step's output) and suppliable as a plan constant under the literal `builtin.CALL_ADDRESS` key ([references.md → built-in command parameters](references.md#built-in-command-parameters-builtin-names)). |
| `method` field on a native target + `deployMethod` / `create2Salt` / `create3Factory` / `create3Salt` constants | workflow step `method` (+ method variants) + plan `deploy` block | Deployment strategy is no longer fixed on the action nor a flat plan constant. Method is resolved entirely in the workflows file: the step's `method`, overridable only by a **method variant** (`variantOf`, globally or per chain) — never by the plan. Per-step CREATE3 factories and salts live in the plan `deploy` block (`deploy.factories.<stepId>` / `deploy.salts.<stepId>`, with an optional `saltBase` fallback). See [workflows.md → Method variants](workflows.md#method-variants--variantof) and [plans.md → Deploy parameters](plans.md#deploy-parameters-deploy-block). |
| OutputMapping (`expected` / `as`) | *(removed)* | The v1 output mapping — a templated reported key decoupled from a stable exposed name — is gone in v2. An output is its declared name everywhere (in `.env.outputs` and in downstream refs); the multi-value use case is covered by first-class `array: true` outputs ([actions.md → Output shape](actions.md#output-shape-names-and-arity)). |

## YAML keys and fields

| v1 | v2 | Where |
|---|---|---|
| `targets:` (map under a release) | `actions:` (map under a **generation**) | actions.yaml — the key directly contains the renamed noun. |
| `pipeline:` (top-level field) | `workflow:` | plans — points at a workflow id. |
| `target:` (step field) | `action:` / `workflow:` (split) | workflows — the single overloaded `target` is replaced by two mutually-exclusive fields: `action:` (an action FQ id or `alias`) and `workflow:` (a nested workflow id). A step sets exactly one. The split keeps the two namespaces in separate files, so an alias and a workflow id can share a name with no ambiguity. |
| `active_preset:` | `default_preset:` | plans — renamed to match the semantics: the fallback preset used when the CLI passes no `--preset` ([plans.md → Preset selection](plans.md#preset-selection)). |
| `deployment_id:` / `run_id:` (plan fields) | *(removed)* | plans — deployment identity is resolved at run time: CLI `--deployment-id`, else derived from the selected preset's name ([plans.md → Deployment id & re-runs](plans.md#deployment-id--re-runs)). The *concept* keeps the name: result paths and `${system.DEPLOYMENT_ID}` are unchanged. |
| `defaults:` (plan-level) | *(removed)* | plans — presets are the only value layer; the base plan is structural. `defaults` survives only *inside* a preset as its chain-agnostic baseline ([plans.md → Presets](plans.md#presets)). |
| `type:` (plan-level) | *(removed — preset-level `type` only)* | plans — the environment tag lives on each preset. |
| `constants:` / `secrets:` / `deploy:` under base `chains.<c>` | *(moved into presets)* | plans — base chain entries are name references with profile selectors only; per-chain values live in `presets.<p>.chains.<c>`. |
| `chain_id:` / `rpc_url:` / `verification_api:` under `chains.<c>` | *(removed — moved to known-chains)* | plans — connection data lives in `known-chains.yaml` (chain identity, `rpc.<profile>.{url,headers}`, `verification.<profile>.{type,api,api_key}`); a plan chain entry carries only the `rpc:` and `verifiers:` profile selectors ([plans.md → ChainConfig fields](plans.md#chainconfig-fields)). |
| `secrets.verificationApiKey` (plan secret slot, `""` tri-state) | *(removed)* | plans — verification keys are `api_key` on verification profiles in `known-chains.yaml`; explicit disable is `verifiers: false` on the plan's chain reference ([known-chains.md](known-chains.md)). |
| `rpc_url:` / `verification_api:` / `verification_api_key:` / `rpc_headers:` (flat chain-level defaults) | `rpc.<profile>.url` / `verification.<profile>.api` / `verification.<profile>.api_key` / `rpc.<profile>.headers` | known-chains — flat per-chain defaults become named RPC / verification profiles ([known-chains.md](known-chains.md)). |

## CLI flags

The engine CLI ([cli.md](cli.md)) follows the same renames:

| v1 | v2 | Notes |
|---|---|---|
| `-e, --execution-config <nameOrPath>` | `-e, --plan <nameOrPath>` | Short letter kept; long name follows the *execution config* → *plan* rename. Short names now resolve into `plans/` ([cli.md → Plan argument resolution](cli.md#plan-argument-resolution)). |
| `-r, --run-id <id>` | `--deployment-id <id>` | Follows the `run_id` → deployment-id rename above. No short letter — an explicit id is the exception, not the rule (it normally derives from the preset name). |
| `--atomic-targets <path>` / `--complex-targets <path>` / `--global-params <path>` | `--configs-dir <path>` | Per-file path overrides collapse into one config-set root — the mounted directory is the allowlist ([cli.md → Common flags](cli.md#common-flags)). |
| *(none)* | `--multisig <name>` / `--multisig-cancel` | New in v2 — the sender-mode run parameter ([multisig.md](multisig.md)). |
| *(none)* | `--ignore-version` | New in v2 — the config-format-version escape hatch ([engine-internals.md → Config version check](engine-internals.md#config-version-check)). |
| *(none)* | `--set <KEY=VALUE>` / `--overrides <path>` | New in v2 — the CLI surface of [deployment overrides](plans.md#deployment-overrides). |
| *(none)* | `--log-level <level>` | New in v2 — one ordered console-output scale (`silent` · `error` · `warn` · `info` · `debug`); `-v` / `-q` remain as sugar for `debug` / `error` ([cli.md → Common flags](cli.md#common-flags)). |

Unchanged flags: `--preset`, `--chain` / `--exclude-chain`, `--restart`, `--dry-run`, `--skip-verify`, `--verify-only`, `--results-dir`, `--repos-dir`, and the output flags (`--verbose` / `--quiet` / `--log-file` — though `--verbose` / `--quiet` are now sugar for the new `--log-level`).

## Multisig vocabulary (new in v2)

Multisig deployment ([multisig.md](multisig.md)) has no v1 counterpart; its terms are new rather than renames:

| Term | Meaning |
|---|---|
| **sender mode** | Who signs and broadcasts a run's transactions: `eoa` (default — `${secret.privateKey}`, the behavior documented everywhere else) or `multisig` (a Gnosis Safe). A **run parameter** (`--multisig <name>`), never a plan field. |
| **multisig entry** | A named, self-contained record in `multisig.yaml`: backend + per-chain Safe addresses + credentials. What `--multisig` selects. |
| **planned transaction** | A captured-but-not-broadcast transaction (`to` / `value` / `data`) produced by the planning phase; written by commands to `.deploy-pad-transactions.json`. |
| **batch** | The ordered planned transactions of one chain between semantic boundaries. On the `multisend` backend, one batch = one Safe transaction = one signature ceremony. |
| **root** | The Merkle root over all planned transactions of a run (`merkle` backend) — the single thing owners sign. |
| **proposer / executor** | The two engine-held credentials: a Transaction Service delegate that can only queue batches, and a gas-paying key that executes. Neither is a Safe owner key. |

## Generation / release refinement

These docs originally used **release** for the middle config level (the codebase fixed point that owns actions). v2 splits that into two concepts:

| Earlier docs term | v2 term | Notes |
|---|---|---|
| release (middle level owning `actions:` + a single `ref`) | **generation** | The interface-stable container: it owns the `actions:` map and the toolchain overrides. The FQ id's middle segment. |
| `ref` (single git pin on the release) | **release** (a pin under a generation) | A *release* is now one immutable code pin (`branch`/`tag`/`commit`, one optionally flagged `latest`) under a generation. A generation can carry several. The `ref` wrapper object is gone — branch/tag/commit sit directly on the pin. |
| (none) | plan `releases:` selector | New per-generation map in the plan (`<repoId>.<generationId>: <releaseId>`) that picks which pin a generation runs from; unlisted generations use `latest`. |
| (none) | action `alias` | New optional short handle on an action, usable in a workflow step's `action` field. Unique across all actions; since it lives in a separate field from `workflow`, it may share a name with a workflow id. |

## Files

### Config files (workspace)

| v1 | v2 |
|---|---|
| `atomic-targets.jsonc` | `actions.yaml` |
| `complex-targets.jsonc` | `workflows.yaml` |
| `execution/<name>.yaml` | `plans/<name>.yaml` |
| `known-chains.yaml` | `known-chains.yaml` (unchanged) |
| `global-params.yaml` | `global-params.yaml` (unchanged) |
| *(none)* | `multisig.yaml` (new in v2 — the multisig registry; see [multisig.md](multisig.md)) |
| *(none)* | `engine.yaml` (new in v2, optional — the engine's own run-behavior config; see [engine.md](engine.md)) |

### Docs (this folder)

| Old name | New name |
|---|---|
| `atomic-targets.md` | `actions.md` |
| `complex-targets.md` | `workflows.md` |
| `execution-config.md` | `plans.md` |
| `schemas/atomic-targets.schema.yaml` | `schemas/actions.schema.yaml` |
| `schemas/complex-targets.schema.yaml` | `schemas/workflows.schema.yaml` |
| `schemas/execution-config.schema.yaml` | `schemas/plans.schema.yaml` |

### Paths

| v1 | v2 |
|---|---|
| `workspace/results/<pipeline>/<deployment_id>/<chain>/` | `workspace/results/<workflow>/<deployment_id>/<chain>/` |

## Unchanged terms

These keep their v1 names — no rename intended:

- **run**, **repo**, **step**, **preset**, **chain** (note: **release** is repurposed in v2 — see [Generation / release refinement](#generation--release-refinement))
- **deployment id** as a concept (result-path segment, `${system.DEPLOYMENT_ID}`) — but it is no longer a plan *field*; see [YAML keys and fields](#yaml-keys-and-fields)
- `mappings`, `constants`, `secrets`, `vault`
- Built-in parameter key class: `builtin.<NAME>` (e.g. `builtin.CALL_ADDRESS`; replaces the earlier reserved-constant concept — the v1 deploy-method constants `deployMethod` / `create2Salt` / `create3Factory` / `create3Salt` are **removed** in v2, see the `deploy` block in the derived-terms table above)
- All `${...}` namespaces: `global.`, `system.`, `secret.`, `vault.`, `random.`, `env.`
- Engine-internal component names (`BaseParamEnricher`, `EnvFileWriter`, Command classes, …) — code-level; they appear only in [engine-internals.md](engine-internals.md) and will be revisited in the code sweep
