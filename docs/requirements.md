# Deploy-Pad v2 Engine — Business Requirements Document

**Status:** Draft, derived from this design set. **Sources:** all specification documents under [specs/](specs/) and [architecture/](architecture/). **Requirement style:** hybrid — narrative context followed by numbered, traceable requirements.

---

## Table of contents

1. [Introduction](#1-introduction)
2. [Business context and vision](#2-business-context-and-vision)
3. [Domain model and terminology](#3-domain-model-and-terminology)
4. [Configuration surfaces](#4-configuration-surfaces)
   - 4.1 [General configuration requirements](#41-general-configuration-requirements)
   - 4.2 [The chain connection registry (known-chains)](#42-the-chain-connection-registry-known-chains)
   - 4.3 [Global parameters and the vault](#43-global-parameters-and-the-vault)
   - 4.4 [Actions — the catalog of deployment units](#44-actions--the-catalog-of-deployment-units)
   - 4.5 [Workflows — composition and wiring](#45-workflows--composition-and-wiring)
   - 4.6 [Plans — the launch surface](#46-plans--the-launch-surface)
   - 4.7 [The multisig registry](#47-the-multisig-registry)
5. [Value resolution and references](#5-value-resolution-and-references)
6. [Secrets management](#6-secrets-management)
7. [Execution lifecycle](#7-execution-lifecycle)
8. [Command-line interface](#8-command-line-interface)
9. [Non-functional requirements](#9-non-functional-requirements)
10. [Open items and assumptions](#10-open-items-and-assumptions)
11. [Traceability appendix](#11-traceability-appendix)

---

## 1. Introduction

### 1.1 Purpose of this document

This document states the complete set of business requirements for the **deploy-pad v2 engine** — the command-line system that deploys smart contracts and runs related operational tasks across many blockchain networks in a repeatable, auditable way. It is derived from, and traceable to, the v2 design documentation in this folder.

The document serves three audiences:

- **Business analysts and product owners**, who need to understand what the engine must do and why, without reading engine code.
- **Engineers**, who will implement or verify the engine against a numbered, citable requirements catalog.
- **Reviewers and auditors**, who need to trace a behavior back to a stated requirement and its design source.

### 1.2 Scope

**In scope:** everything the engine itself must do — the configuration files it reads and validates, the value-resolution and secret-handling rules it enforces, the execution lifecycle it runs, the records it produces, and the command-line surface it exposes. Multisig (Gnosis Safe) deployment support is in scope as an engine capability. Also in scope, as a quality requirement rather than a deliverable: the engine's **internal separation between the command line and the run itself** (NFR-060), which is what keeps a future non-CLI caller possible.

**Out of scope:** the visual editor application (except where a requirement notes an editor-facing consequence), any **published programmatic interface (SDK)** and the user interface that would consume it (the boundary is required, the API is not offered — see NFR-060 and OI-17), the migration mechanics from v1 configuration formats to v2 (deferred by design), editor-specific configuration (`editor-settings.yaml`, project metadata), and any change to the engine's source-code organization. Also out of scope: the **pipeline mechanics** around an unattended invocation — how a CI system persists the results tree between runs is documented operational guidance, not engine behavior (see NFR-043 and FR-CLI-041). These follow the same scope boundary the design documentation itself declares.

### 1.3 How to read this document

Each chapter opens with a short narrative that explains the concept in plain language, then lists numbered requirements. Requirement identifiers follow the pattern `FR-<AREA>-NNN` for functional requirements and `NFR-NNN` for non-functional ones. The area codes are:

| Code | Area |
|---|---|
| CFG | Configuration files in general (format, versioning, schemas) |
| CHN | Chain connection registry (`known-chains.yaml`) |
| GLB | Global parameters and the vault (`global-params.yaml`) |
| ACT | Actions catalog (`actions.yaml`) |
| WFL | Workflows (`workflows.yaml`) |
| PLN | Plans (`plans/<workflow>.yaml`) |
| MSG | Multisig registry and multisig mode (`multisig.yaml`) |
| REF | The `${...}` reference and substitution system |
| SEC | Secrets management |
| RUN | Run-level execution lifecycle |
| STP | Step-level execution lifecycle |
| CLI | Command-line interface |

Statements use two complementary phrasings. *Capability* requirements describe what a user must be able to do ("The user shall be able to override a parameter for a single chain…"); *behavior* requirements describe what the engine guarantees ("The engine shall reject an unknown chain name with an error…"). Both are business requirements; the phrasing follows whichever perspective carries the requirement most naturally.

Words are used with their usual requirements meaning: **shall** marks a mandatory requirement, **should** a strong recommendation, **may** an allowed option.

Requirements marked **[Open item: OI-x]** depend on an unresolved design question listed in [Chapter 10](#10-open-items-and-assumptions).

---

## 2. Business context and vision

### 2.1 The problem

Launching a smart-contract protocol is rarely one transaction. A real launch is a **sequence of deployments and calls, in a specific order, on many chains at once**: deploy a factory, deploy a router through it, transfer ownership, configure fees — and repeat the same sequence on ten networks, with per-network addresses, keys, and explorer accounts. Done by hand, this process is error-prone (wrong constructor argument, stale address copied between terminals), unrepeatable (nobody can say precisely what was run three months ago), and hard to audit (credentials and values scattered across shell histories and ad-hoc scripts).

Deploy-pad exists to turn that process into **configuration plus a single command**. Teams describe *what* can be deployed (actions), *in what order and with what wiring* (workflows), and *with which concrete values* (plans). The engine takes it from there: it prepares source code, resolves every parameter, executes the steps chain by chain, records everything immutably, and can resume exactly where it stopped.

### 2.2 The vision for v2

Version 2 reorganizes the configuration model around one principle, stated everywhere in the design and adopted by this document as the organizing frame:

> **Action = interface. Workflow = structure. Plan = values.**

An *action* declares the interface of one indivisible deployable unit — what it consumes and produces. A *workflow* declares structure — the order of steps, the wiring between their inputs and outputs, and the deployment strategy of each step. A *plan* supplies values — concrete constants, credentials, and per-launch data — and never changes structure. Everything else in this document is a consequence of keeping those three layers clean:

- Chain connectivity is **infrastructure**, so it moves out of plans into a central registry (known-chains).
- Credentials are **pointers, never literals**, routed through a vault with universal tagging and redaction.
- The deployment method of a step is **structural**, so it lives in the workflow and can be varied only by explicitly declared workflow variants — never silently by a plan.
- Launch values live in **presets** — complete, self-contained parameter sets that make each launch auditable in isolation.
- Deployment through a **multisig (Gnosis Safe)** is a run-time choice, not a config change: the same plan launches from a single key on staging and through a Safe on production.

### 2.3 Actors

| Actor | Role |
|---|---|
| **Action author** | An engineer who onboards a repository and describes its deployable units (actions) and their interfaces. |
| **Workflow author** | An engineer who composes actions into ordered, wired workflows and their deploy-strategy variants. |
| **Release operator** | The person (or CI job) who prepares a plan preset, runs the engine, retries failures, and reads the reports. |
| **Multisig owner** | A Gnosis Safe owner who reviews proposal reports and signs batches or roots outside the engine. |
| **Security reviewer / auditor** | Reads plans, presets, and deployment records to answer "what ran, with what values, signed by whom." |
| **CI system** | Runs the engine unattended; relies on exit codes, mounted config allowlists, and environment-provided secrets. |

### 2.4 Key business goals

The requirements in this document collectively serve five goals:

1. **Repeatability** — the same configuration produces the same deployment; every launch is reproducible from its recorded results alone.
2. **Auditability** — immutable per-deployment records; every value, code pin, and sender identity recoverable after the fact; secrets never in records.
3. **Safety** — everything that can fail statically fails before the first on-chain transaction; no silent overrides; humans decide anything that changes what owners sign.
4. **Reusability** — one workflow runs unchanged against many plans; one plan runs unchanged as EOA or multisig, staging or production.
5. **Operability** — resumable runs, clear exit codes, and secret handling that works identically on a laptop and in CI.

---

## 3. Domain model and terminology

### 3.1 Core concepts

The v2 vocabulary renames the v1 nouns to short, role-descriptive terms. This document uses only the v2 terms; the v1 → v2 mapping is recorded in [specs/naming.md](specs/naming.md).

| Term | Definition | v1 name |
|---|---|---|
| **Action** | One indivisible thing the engine can do — a contract deployment or a script/call invocation. Declared in `actions.yaml`. | atomic target |
| **Workflow** | An ordered composition of steps, each referencing an action or another workflow. Declared in `workflows.yaml`. | complex target |
| **Plan** | The launch surface for one workflow: which chains, which parameter values, which credentials. One file per workflow under `plans/`. | execution config |
| **Single-action plan** | A plan whose `workflow:` field holds an inline step object naming one action (instead of a workflow id); the engine runs it as a one-step workflow — for one-off tasks like ownership transfers or standalone deployments. | (new concept) |
| **Preset** | A named, complete, self-contained parameter set inside a plan. Exactly one preset is active per run. | preset |
| **Deployment** | One logical launch of a plan — potentially spanning several chains and several engine invocations. Identified by a deployment id. | (run id concept) |
| **Run / invocation** | One engine execution attempt. A deployment accumulates one run record per invocation. | run |
| **Repo** | One git remote plus its build toolchain defaults. | repo |
| **Generation** | An interface-stable era of a repo's codebase; owns the actions defined against that interface and a set of release pins. | (new concept) |
| **Release** | One immutable code pin (branch/tag/commit) under a generation; interchangeable implementations of the same interface. | (refined from `ref`) |
| **Step** | One entry in a workflow's `steps` array — a single action invocation or a nested workflow. | step |
| **Method variant** | A workflow entry that re-skins an existing workflow with different per-step deployment strategy (methods, CREATE3 factory flavors, signing-key slots) — never different wiring. | (new concept) |
| **Chain** | One blockchain network, identified by a stable lowercase name declared in `known-chains.yaml`. | chain |
| **Vault** | The registry in `global-params.yaml` mapping stable secret-role names to environment-variable pointers. | (new concept) |
| **Sender mode** | Who signs a run's transactions: `eoa` (default) or `multisig` (a Gnosis Safe). A run parameter, never a plan field. | (new concept) |

Multisig mode adds its own vocabulary: a **multisig entry** (a named record in `multisig.yaml`), a **planned transaction** (captured but not broadcast), a **batch** (the ordered planned transactions of one chain between semantic boundaries), a **root** (the Merkle root owners sign once on the merkle backend), and the **proposer / executor** credentials (engine-held keys that respectively queue and execute — never Safe owner keys).

### 3.2 Identifiers and naming rules

Identifiers are load-bearing: workflows reference actions, plans reference workflows and chains, results are keyed by ids. The engine enforces a small set of naming rules so that references stay unambiguous.

- **FR-CFG-001.** The engine shall identify every action by the fully-qualified id `<repoId>.<generationId>.<actionId>` (e.g. `aqua.v1.deploy-router`). The release pin shall not be part of the action id; the plan selects the pin.
- **FR-CFG-002.** The engine shall allow an action to declare an optional short `alias` (matching `^[a-z][a-z0-9-]*$`), unique across all actions, usable in workflow step references in place of the fully-qualified id.
- **FR-CFG-003.** The engine shall enforce the author-declared identifier rule `^[a-zA-Z][a-zA-Z0-9_]*$` for action input names, action output names, plan constant keys, and workflow mapping keys. `SCREAMING_SNAKE_CASE` is the recommended style; legacy `OPS_*` names remain valid with no special meaning.
- **FR-CFG-004.** The engine shall treat keys of the form `builtin.<NAME>` (grammar `^builtin\.[A-Z][A-Z0-9_]*$`) as a separate, engine-owned key class — **built-in command parameters** declared by action types. Because user identifiers cannot contain a dot, the two classes shall be structurally disjoint: a built-in key can never collide with or shadow a user name.
- **FR-CFG-005.** The engine shall never require or accept author-chosen names for engine-managed values. Engine context shall be exposed only through namespaced references (`${system.*}`) and credentials only through `${secret.*}`; neither shall appear as an action input or a constant key.
- **FR-CFG-006.** Chain names and profile names shall match `^[a-z][a-z0-9-]*$` (lowercase, hyphenated when multi-word) and shall be treated as stable identifiers with wide blast radius on rename.
- **FR-CFG-007.** The engine shall inject values into command environments under three role-based prefixes: `SEC_` for secrets, `SYS_` for engine system context, and `OPS_` for author-declared parameters and remaining engine-managed deployment parameters.
- **FR-CFG-008.** When converting output names to JSON keys in deployment results, the engine shall strip a leading `OPS_` prefix and a trailing `_ADDRESS` suffix and camelCase the remainder (e.g. `OPS_THING_ADDRESS` → `thing`); for non-prefixed names only the `_ADDRESS` suffix shall be dropped.

### 3.3 File inventory

The engine reads one mounted configuration set. The files and their roles:

| File | Role |
|---|---|
| `known-chains.yaml` | Chain identity plus named RPC and verification profiles — the single source of truth for all chain connection settings. |
| `global-params.yaml` | Chain-aware shared constants (`${global.*}`) and the vault registry (`${vault.*}`). |
| `actions.yaml` | Per-repo catalog of actions, nested repo → generation → releases + actions. |
| `workflows.yaml` | Workflows, nested workflows, and method variants. |
| `plans/<workflow>.yaml` | One plan per workflow: chain references, presets, release selection. A plan may instead target a single action (a single-action plan — FR-PLN-070). |
| `multisig.yaml` | Registry of named multisig (Gnosis Safe) entries. |

Results are written under `workspace/results/<workflow>/<deployment_id>/<chain>/` (for a single-action plan, the fully-qualified action id takes the workflow's place).

---

## 4. Configuration surfaces

This chapter walks through the configuration files in dependency order — from the infrastructure registries that everything else references (chains, globals, vault), through the catalogs that define what can run (actions) and in what order (workflows), to the launch surface that supplies values (plans), and finally the multisig registry that changes who signs. Each section states the requirements for authoring, validating, and consuming that file.

### 4.1 General configuration requirements

All v2 configuration shares one format discipline, chosen so that configs stay reviewable by humans, parseable by any standard tool, and validatable against schemas.

- **FR-CFG-010.** All v2 configuration files shall be YAML, and the engine shall refuse — as a load-time error naming the file — any configuration file it cannot parse as YAML.
- **FR-CFG-010a.** Configuration files shall be authored as UTF-8 with LF line endings and two-space indentation, and shall not be written as JSON or JSONC. This is an **authoring convention rather than an engine check**, and deliberately so: YAML 1.2 is a superset of JSON, so a JSON file *is* valid YAML and no YAML parser can refuse it, while line endings and indentation are invisible once a document is parsed. Conformance is carried by review and editor configuration (NFR-050), the way the [ci.md](specs/ci.md) persistence pattern is carried by documentation (FR-CLI-041) — the split exists so that a claim against FR-CFG-010 means something a test can check.
- **FR-CFG-011.** Configuration files shall use only plain mappings, sequences, scalars, and comments. YAML anchors, aliases, the merge key (`<<:`), and custom tags shall not be used; reuse shall be expressed exclusively through the `${...}` substitution system.
- **FR-CFG-012.** Each configuration file shall be validatable against a published JSON Schema (Draft 2020-12, authored in YAML form), and every example file shall carry a `yaml-language-server` schema header so that editors provide autocomplete and inline validation.
- **FR-CFG-013.** The actions and workflows files shall carry a reserved top-level `version` key declaring the config format version (currently `2`). At load time the engine shall compare it against the format version it supports: a mismatch shall be a load-time error naming the file and both versions, downgradable to a warning by the `--ignore-version` flag; a missing `version` shall always be a warning recommending the key be added.
- **FR-CFG-014.** The version comparison shall be exact (the engine supports exactly one format version at a time), and `--ignore-version` shall affect only the version-mismatch gate — never schema validation or any other check.
- **FR-CFG-015.** The engine shall load its configuration set from a single mounted directory (`--configs-dir`, default `workspace/configs`). Mounting a trimmed directory shall act as an allowlist: the engine shall be able to use only what is mounted.

### 4.2 The chain connection registry (known-chains)

Chain connectivity — RPC endpoints, block-explorer verification APIs, and their credentials — is environment infrastructure, not launch data. The same endpoint serves every workflow, so v2 concentrates all of it in `known-chains.yaml` and removes every connection field from plans. Plans reference chains **by name only** and select named profiles — individually, or wholesale via a named **chain set** — so changing an endpoint, rotating an explorer key, or growing the fleet never touches a plan.

#### Structure and identity

- **FR-CHN-001.** The engine shall read chain identity and all chain connection settings exclusively from `known-chains.yaml`. Each entry shall map a chain name to an object with `chain_id` plus optional named `rpc` and `verification` profiles.
- **FR-CHN-002.** The engine shall normalize the string RPC shorthand (`rpc: "<url>"`) to a single `default` RPC profile.
- **FR-CHN-003.** Each RPC profile shall carry a required `url` (which may embed `${env.VAR}` references inline) and optional `headers` — custom HTTP headers sent on every request through that profile.
- **FR-CHN-004.** Each verification profile shall carry a required `api` (the verification API base URL), an optional `type` declaring the API dialect (`etherscan` — the default, `blockscout`, or `sourcify`), and an optional `api_key`.
- **FR-CHN-005.** The profile name `default` shall be the reserved fallback: a plan that selects no profile shall receive the `default` profile. Every chain a plan runs on shall need a selectable RPC profile (a `default` one, or one the plan names explicitly).

#### Selection semantics

- **FR-CHN-010.** The user shall be able to select, per chain in a plan, which RPC profile a run uses (`rpc: <profileName>`) and which verification profile or profiles it verifies against (`verifiers: <name> | [names] | false`).
- **FR-CHN-011.** Chain resolution shall be a **pure lookup plus selection** — never a merge. A plan shall carry no connection values of its own (no chain id, URL, endpoint, or key), and there shall be no plan-side override surface for connection data. One-off endpoint changes shall go through CLI/deployment overrides, never plan fields.
- **FR-CHN-012.** An unknown chain name referenced by a plan, an unknown RPC profile named by the `rpc:` selector, or an omitted selector on a chain with no `default` RPC profile shall each be a hard load-time error.
- **FR-CHN-013.** An unknown verification profile named by `verifiers:` shall be an error. An omitted selector on a chain with no verification profiles shall not be an error — verification is simply off — but shall produce a validation warning when the workflow contains steps with `verify: true`. The user shall be able to silence that warning deliberately with `verifiers: false`.
- **FR-CHN-014.** When several verification profiles are selected for one chain, the engine shall verify each deployed contract against **each** selected profile.

#### Connection credentials

- **FR-CHN-020.** Connection credentials shall be pointers, never literals: a verification profile's `api_key` shall be exactly one `${vault.X}` or `${env.X}` token (literals and inline mixing rejected by schema); RPC header values may embed `${vault.X}` / `${env.X}` **inline** — the one documented exception to the single-token vault rule — because every header value is tagged as a secret wholesale (the entire resolved string is redacted).
- **FR-CHN-021.** Resolved connection credentials shall be tagged as secrets: injected to the verification machinery under the `SEC_` prefix and redacted in all engine output and records.

#### Chain sets

- **FR-CHN-030.** The user shall be able to declare **named chain sets** under the reserved top-level `sets:` key of `known-chains.yaml`. Each set shall map member chain names to selector entries of the same shape as a plan chain entry (`rpc:` / `verifiers:` selectors only, no connection values). `sets` shall never be usable as a chain name, and sets shall not nest.
- **FR-CHN-031.** Chain sets shall be validated at registry load, before any plan is opened: every member shall be a chain declared in `known-chains.yaml` with a selectable RPC profile, and every selector shall name a profile the member chain declares. A violation shall be a hard error.
- **FR-CHN-032.** A plan shall be able to reference one chain set via the `$set` key of its `chains` block. At the chain-resolution step (before preset selection), the set shall expand into its member entries; explicit plan chain entries shall merge over set entries by chain name (plan wins), and may add chains beyond the set. A `$set` reference naming an undeclared set shall be a hard error.
- **FR-CHN-033.** For a fresh deployment, the engine shall record the chain provenance in `deployment.yaml`: the referenced set name (when `$set` was used) and the resolved chain list at deployment creation.
- **FR-CHN-034.** A resumed deployment shall run against the chain list recorded in its `deployment.yaml`, never against a re-expansion of the set. A chain added to the set after the deployment started shall be skipped with a warning; the user shall be able to include it deliberately via an explicit `--chain <name>` scope. The run header and `--dry-run` output shall print the expanded chain list alongside the set name.

### 4.3 Global parameters and the vault

Two registries prevent the two classic sources of config drift: well-known addresses copied between files, and credentials referenced by raw environment-variable names everywhere. `global-params.yaml` holds both.

#### Global constants

- **FR-GLB-001.** The user shall be able to define shared, chain-aware constants once — a chain-agnostic default in `defaults.constants` plus optional per-chain overrides in `chains.<name>.constants` — and reference them from any plan via `${global.NAME}`.
- **FR-GLB-002.** Global constant resolution shall be chain-aware: the consuming chain's override wins; otherwise the default applies. The chain context shall come from the plan block that contains the reference.
- **FR-GLB-003.** Global constant values shall be plain strings only. The substitution system shall not recurse into globals: a global value cannot itself contain `${...}` references.
- **FR-GLB-004.** A `${global.NAME}` reference with no per-chain override and no default for an active chain shall be a hard error at plan load by default (see the strict-miss rule, FR-REF-020).
- **FR-GLB-005.** A chain key in `global-params.yaml` that is missing from known-chains shall produce a warning (dead data), not an error.

#### The vault

- **FR-GLB-010.** The engine shall provide a **vault**: a flat registry mapping author-chosen secret-role names (camelCase, `^[a-z][a-zA-Z0-9]*$`) to environment-variable references. Vault values shall be exactly one `${env.VAR}` token — literal credentials, inline strings, and any other namespace shall be rejected by schema.
- **FR-GLB-011.** The vault shall not be chain-aware: one entry maps one role to one env var globally. Per-chain key wiring shall be expressed in plan `secrets:` blocks, not in the vault.
- **FR-GLB-012.** Vault entries shall be consumable, via `${vault.NAME}`, from exactly four sites: plan preset `secrets:` values, known-chains connection credentials (`api_key`, RPC `headers`), `repository.auth` in the actions file, and multisig registry credentials (`proposer` / `executor`).
- **FR-GLB-013.** A `${vault.NAME}` reference to an entry not declared in the vault shall always be a hard error at load, regardless of the plan's `strict` setting.
- **FR-GLB-014.** Rotating a credential shall require at most an environment change plus one vault line — never a plan, workflow, or action edit. The vault shall serve as the single audit surface for "which env var feeds which role."

### 4.4 Actions — the catalog of deployment units

An action is the engine's per-step recipe: where the source code lives, which point in its history to build, how to prepare it, what to invoke, and what the step consumes and produces. Actions are deliberately **declarative and stateless** — no chain context, no values, no env vars — so that one catalog serves every plan.

#### Repos, generations, and releases

- **FR-ACT-001.** The actions file shall organize its content in four nested levels: **repo** (one git remote plus default build toolchain), **generation** (one interface-stable era owning its `actions` and `releases`), **release** (one immutable code pin), and **action** (one per-step recipe).
- **FR-ACT-002.** A repo shall declare its git URI and build defaults (`framework`: `foundry` / `hardhat` / `custom` / `none`; optional install-command and package-manager overrides). A generation may override any of these for its era.
- **FR-ACT-003.** Each generation shall own its actions exclusively. Reusing an action under a changed interface shall require copying it into a new generation; the engine shall never share action definitions across generations.
- **FR-ACT-004.** A release pin shall set at most one of `branch`, `tag`, `commit`; setting two or more shall be a validation error. Omitting all three shall be allowed for development convenience: the engine shall then track the remote default branch and warn that the pin is not reproducible.
- **FR-ACT-005.** At most one release per generation shall be flaggable `latest: true` — the default pin used when a plan selects none.
- **FR-ACT-006.** Every release pin shall be checked out into its own directory (`workspace/repos/<repoId>/<generationId>/<releaseId>/`), so that generations and pins never share working trees, build caches, or dependency installations.
- **FR-ACT-007.** All pins of a generation are expected to build the same action interface. This is an author responsibility the engine does not currently verify. **[Open item: OI-9]**

#### Private repository access

- **FR-ACT-010.** The user shall be able to grant the engine access to a private repository by pointing the repo's optional `repository.auth` field at a credential — exactly one `${vault.X}` (preferred) or `${env.X}` token. Literal tokens and inline mixing shall be rejected. Omitting `auth` shall fall back to ambient git credentials (SSH agent, credential helper).
- **FR-ACT-011.** The engine shall inject the repository credential **ephemerally**, per git process, via environment-based git configuration: the token shall never persist in `.git/config`, the remote URL, any checkout file, or process argv, and shall be redacted in logs.
- **FR-ACT-012.** Access scoping shall be per repo: different repos may point at different vault entries (different tokens, different scopes).

#### Action types

- **FR-ACT-020.** The engine shall support ten action types in six families:
  - contract deployments — `forge-contract`, `hardhat2-contract`, `hardhat3-contract` (engine-owned deployment machinery; inputs in constructor-argument order);
  - module deployments — `hardhat3-module` (deploys an authored Hardhat Ignition module; inputs passed **by name**; outputs equal the module's return-object keys);
  - framework scripts — `forge-script`, `hardhat2-script`, `hardhat3-script`;
  - make recipes — `make`;
  - generic scripts — `script` (runtime one of `bash` / `node` / `tsx` / `ts-node`, default `bash`);
  - contract calls — `contract-call` (performed by the engine in-process via its RPC client; no framework, no subprocess).
- **FR-ACT-021.** For `contract-call`, the user shall declare a cast-style `signature` (return types included for reads) and a `mode`: `call` (static read, default, no key) or `send` (signed transaction; the engine injects the private key; the key never leaves the engine process). Read return values shall map positionally to declared outputs; `send` actions shall declare `outputs: []` (a mined transaction cannot return a function value) and surface results via events or a follow-up read step.
- **FR-ACT-022.** The target address of a `contract-call` shall not be an input; it shall come from the type-declared built-in parameter `builtin.CALL_ADDRESS` (required), typically wired per step from a prior deployment's output.
- **FR-ACT-023.** Engine-native action types shall declare their **built-in parameters** in engine code (name, required/optional, optional default). Built-ins shall resolve through the ordinary input pipeline and never appear in an action's `inputs` (structurally impossible — the input regex forbids the dot).

#### The `deploys` flag and behavior flags

- **FR-ACT-030.** Every action shall have an effective `deploys` value that controls exactly three things: (1) the private key is always injected on deploying steps (non-deploying steps opt in with `requiresPrivateKey: true`; the field is rejected on deploying actions and on `contract-call`, where `mode` plays that role); (2) deploying steps receive a per-step artifacts directory whose contents the engine persists after success; (3) the `verify` field is available only on deploying actions.
- **FR-ACT-031.** The schema shall fix `deploys` where the type's role is unambiguous: always `true` for contract and module types (field rejected if set), always `false` for `contract-call` (rejected if set), required-explicit for `make` and the framework script types, and default `false` for `script`.
- **FR-ACT-032.** Every action shall have an effective `idempotent` value controlling re-run behavior, defaulting by type: `true` for contract/module types (deterministic engine-owned machinery), `false` for all script/make types and `contract-call`. Explicit values shall override; the engine shall not validate that an author's `idempotent: true` assertion is actually safe.
- **FR-ACT-033.** The action's `verify: true` flag shall be the only action-side verification opt-in. There shall be no plan-level or CLI switch that turns verification **on** for an action that does not declare it.

#### Inputs, outputs, and shapes

- **FR-ACT-040.** An input entry shall be a plain name or an object `{ name, transform?, array? }`; an output entry a plain name or `{ name, array? }`. `array: true` declares list arity. Output names shall be plain identifiers — templates and `${...}` references are not supported (the v1 `expected`/`as` output mapping is removed; multi-value outputs are covered by first-class arrays).
- **FR-ACT-041.** An input's declared `transform` (encoding coercion: `salt` or `keccak256`, single or chained) shall be **authoritative and not overridable**: a workflow may add adaptation transforms before it but can never remove or replace it, and it is always applied last. A `transform` on an `array: true` input shall be rejected (there is no single value to coerce).
- **FR-ACT-042.** For contract types and `contract-call`, input order shall be significant (constructor/call argument order); for `hardhat3-module`, inputs shall be passed by name and order shall be irrelevant.
- **FR-ACT-043.** The user shall be able to fix selected inputs as hard constants of the action via `inputConstants`: every key must also appear in `inputs`, values are literal strings only (no substitution), and neither the plan nor workflow mappings shall be able to override them — an attempt shall be an explicit error, never a silent win.
- **FR-ACT-044.** Array-valued outputs shall be reported in `.env.outputs` as a single JSON-array string, mirroring how array inputs are serialized; the engine shall parse them into lists at collect time and fail the step on malformed JSON.
- **FR-ACT-045.** After a step finishes, **every declared output must have been produced**; a missing output shall fail the step with an error naming the output and the step.
- **FR-ACT-046.** Every action may carry a free-form `description` (surfaced in tooling and logs) and a `workingDir` (the subdirectory of the repo where the command runs; default: the repo root). Type-specific fields (e.g. `contract`, `module`, `command`, `function`, `runtime`, `signature`, `mode`) shall be accepted only on their declaring type and rejected elsewhere.

#### Extension points

- **FR-ACT-050.** Each action type shall select a minimal required set of enrichers, writers, and a command class in engine code. The user shall be able to **append** additional registered enrichers/writers per action, but never remove, reorder, or replace the type defaults. Unknown component names shall be validation errors.

### 4.5 Workflows — composition and wiring

Where actions declare single steps, workflows declare launches: order, wiring, nesting, and per-step deployment strategy. The `${...}` substitution system does not apply inside workflows — they are pure wiring, and all values live one layer up, in plans.

#### Structure and steps

- **FR-WFL-001.** A workflow shall be a top-level entry in the workflows file with an ordered `steps` array (at least one step); steps shall execute in array order.
- **FR-WFL-002.** Every step shall reference exactly one of: an `action` (by fully-qualified id or alias — a dotted value is an FQ id, a bare value an alias) or a `workflow` (a nested workflow id). Setting both or neither shall be a schema error. Because the references live in separate fields, an action alias and a workflow id may share a name without ambiguity.
- **FR-WFL-003.** Every step shall have an id — explicit, or derived (the last FQ-id segment, or the bare alias/workflow token). Step ids shall be unique within a workflow; a derived collision (e.g. the same action referenced under two generations) shall require explicit ids.
- **FR-WFL-004.** The user shall be able to compose steps from **different generations of the same repo** in one workflow (migration deployments, side-by-side canaries); each generation shall run from its own checkout, and results shall record which generation and pin produced each address.
- **FR-WFL-005.** Referential integrity shall be validated at load: unknown action/workflow references, duplicate step ids, forward step-output references, references to undeclared outputs, self-references, and cycles through nested workflows shall all be errors.

#### Deployment method and CREATE3 factory flavors

- **FR-WFL-010.** Each contract/module step shall declare its deployment method via an optional `method` field: `create` (default), `create2`, or `create3`. The method shall be decided **entirely in the workflows file**; the plan shall have no surface to change it.
- **FR-WFL-011.** `method` shall be rejected on non-contract/module action steps and on nested-workflow steps. A method resolving to `create3` on a Hardhat 3 step (`hardhat3-contract` / `hardhat3-module`) shall be an error (Ignition has no create3 strategy).
- **FR-WFL-012.** A `create3` step shall select its factory implementation via an optional `factory` field: `oneInch` (default; ownership-protected; needs a per-chain factory address from the plan; address independent of the caller), `createx` (canonical CreateX singleton; salt-protected/caller-namespaced; **no** factory entry needed), or `solady` (factory address needed; salt-protected like CreateX). `factory` shall be valid only when the method is `create3`.
- **FR-WFL-013.** Salts and factory addresses shall never be set on the step — they are launch data, keyed by step id in the plan's `deploy` block.

#### Method variants

- **FR-WFL-020.** The user shall be able to declare a **method variant**: a top-level workflow entry with `variantOf` pointing at a plain workflow, overriding only per-step deploy strategy — `methods`, `factories`, and signing-key slots (`keys`) — chain-agnostically and/or per chain (`chains.<c>.…`). A variant shall never touch steps, mappings, or data wiring; a variant with no overrides at all shall be an error.
- **FR-WFL-021.** A variant shall be a first-class workflow id: plans point at it, results are keyed by it, and it can be nested as a `workflow:` step. Variants shall be one level deep — `variantOf` pointing at another variant shall be an error.
- **FR-WFL-022.** `methods` and `factories` maps shall accept a `"*"` wildcard (targeting all contract/module steps, respectively all steps whose resolved method is `create3`); `keys` shall have no wildcard (re-keying a whole variant is done by re-binding slots in the variant's plan). Map keys shall be step ids of the base workflow (dotted for nested steps); keys naming unknown steps, non-contract/module steps (for `methods`), steps that can never resolve to `create3` (for `factories`), or steps that consume no private key (for `keys`) shall be errors.
- **FR-WFL-023.** Method resolution shall be fully **static** and shall follow the precedence: variant per-chain per-step → variant per-chain wildcard → variant global per-step → variant global wildcard → base step `method` → `create`. Factory-flavor resolution shall be analogous (default `oneInch`), applying only where the resolved method is `create3`. Key-slot resolution: variant per-chain `keys` → variant global `keys` → the base step's `mappings.privateKey` rename → the default `privateKey` slot. Given a workflow id and a chain, every step's method, flavor, and key slot shall be known at load time, before the plan is consulted.
- **FR-WFL-024.** `keys` values shall be bare slot names (`^[a-z][a-zA-Z0-9]*$`) resolved against the plan's `secrets:` — never `${...}` references or literal credentials.

#### Mappings — the wiring layer

- **FR-WFL-030.** The user shall be able to wire each step input via `mappings`. A simple string value shall be interpreted by the dot rule: a value containing `.` is a **step output reference** (`stepId.OUTPUT`, optionally indexed `stepId.OUTPUT[i]` for array outputs; reaching into nested workflows via dotted paths); a bare value is a **rename** — look up that name instead of the input's own name.
- **FR-WFL-031.** Where a renamed name resolves shall depend on the mapping **key**: ordinary inputs and `builtin.<NAME>` keys read plan `constants`; the special key `privateKey` reads plan `secrets`. An unmapped input shall be looked up by its own name in the appropriate place.
- **FR-WFL-032.** Mappings shall be a pure renaming/wiring layer: mapping values shall never carry values, credentials, or `${...}` substitution syntax of any kind.
- **FR-WFL-033.** Mapping a `builtin.` key the step's action type does not declare, or mapping/renaming an input fixed by the action's `inputConstants`, shall be a validation error.
- **FR-WFL-034.** Step output references shall point only at **prior** steps and only at declared outputs of the source action.

#### The production pipeline (transforms, combine, split)

Where an input needs its value shaped — coerced, assembled from several sources, or extracted from an array — a mapping value can be a list or an object. Three orthogonal axes apply, in a fixed order: `final = actionTransform( combine( perSourceTransform( pick(source_i) ) ) )`.

- **FR-WFL-040.** The user shall be able to assemble one input from several sources with a `combine`: `array` (a bare list `[a, b, …]` is sugar for it), `abiEncode("types")`, `abiEncodePacked("types")`, and `abiEncodeWithSignature("fn(types)")` (which also yields the 4-byte selector — e.g. proxy `initData`). The encode variants shall take an explicit type list / signature, because values flow as untyped strings and the destination `bytes` input is opaque.
- **FR-WFL-041.** The user shall be able to extract one element of an array-valued source with `pick` (index sugar `stepId.OUTPUT[i]`). `pick` shall be valid only on array-valued sources; the index shall be a non-negative integer literal; an out-of-range index shall fail at resolution time naming step, output, index, and actual length.
- **FR-WFL-042.** Each source inside a `combine` shall be able to carry its own independent encoding chain (heterogeneous per-source transforms — hash some elements, pass others through, mixing step outputs and constants freely). A `combine` shall not nest inside a single source.
- **FR-WFL-043.** Arity shall be validated: `combine: array` requires an `array: true` input; the `abiEncode*` variants require a scalar `bytes` input; a scalar source into an array input with no combine, or an array source into a scalar input with no pick, shall be errors; the source count shall match the combine argument's type/parameter count.
- **FR-WFL-044.** The transform/combine machinery shall be a separate mechanism from `${...}` substitution: transform values are transform names, combine values are op strings, pipeline sources are plain refs/renames — never `${...}` tokens.

#### Nesting and the aggregated interface

- **FR-WFL-050.** The engine shall flatten nested workflows at execution time: nested step ids receive dotted prefixes (`outer.inner`), and parent-level mappings compose into the nested steps by **external name** (an input's rename target, else its own name), with the parent's value winning and rename chains collapsing to the outermost value. Step output references shall never be replaced by parent renames — only re-pointed after flattening.
- **FR-WFL-051.** From the outside, a nested workflow shall present an **aggregated interface**: aggregated inputs (the minimal external parameter set — internally wired inputs excluded, duplicates by external name deduplicated, private keys excluded) and aggregated outputs (all nested outputs under hierarchical step ids). Pipeline shaping (`pick` / `transform` / `combine`) shall not add or remove external names.

### 4.6 Plans — the launch surface

A plan is where a workflow meets reality: which chains, which values, which credentials, which code pins. In v2 the plan's base level is structural only; **presets are the only value layer**, and deployment identity belongs to the invocation, not the file.

#### Plan structure

- **FR-PLN-001.** A plan shall declare: `workflow` (required — a workflow or variant id as a string, or an inline step object for a single-action plan — see FR-PLN-070), `chains` (required — name references with profile selectors, at least one), `presets` (required — at least one), and optionally `default_preset`, `releases`, and `strict`.
- **FR-PLN-002.** A plan shall carry **no** deployment id, no plan-level value defaults, no plan-level environment type, and no connection data — all removed v1 surfaces. The base plan is structural; everything a run uses as a value lives inside the selected preset.
- **FR-PLN-003.** One plan file shall exist per workflow, at `plans/<workflow>.yaml`; a method variant shall get its own plan file keyed by the variant id. A single-action plan's file shall be named freely (typically after the action or the task).

#### Presets

- **FR-PLN-010.** A preset shall be **complete and isolated**: nothing shall be inherited from another preset or from a base value layer. Reading one preset shall tell the reader exactly what a run with it uses — no mental merging, and no way for another environment's value (e.g. a production deployer key) to leak in through a forgotten override.
- **FR-PLN-011.** Within a preset, the user shall be able to define a chain-agnostic baseline (`defaults` — constants, deploy data, secrets) plus per-chain blocks; at load time defaults shall merge into each chain with the chain winning per key (`deploy` deep-merging by step-id key), after which the defaults blocks are emptied.
- **FR-PLN-012.** The user shall be able to override any parameter for a single chain by setting it in that chain's block within the preset; the chain-specific value shall take precedence over the preset's defaults.
- **FR-PLN-013.** A preset with a `chains` block shall act as a **chain filter**: only the listed chains remain in the resolved plan. A preset shall not be able to add a chain absent from the base `chains` block.
- **FR-PLN-014.** Each preset may carry a free-form `type` tag (e.g. `staging`, `production`) that becomes the resolved plan's environment tag.
- **FR-PLN-015.** Exactly one preset shall be active per run, resolved in order: CLI `--preset` → the plan's `default_preset` → the plan's only preset. With several presets and no selection, the engine shall error at load.
- **FR-PLN-016.** A new launch shall be captured as a **new preset** (kept in the file as the historical record), not by editing an existing preset in place.

#### Release selection

- **FR-PLN-020.** The user shall be able to select, per generation, which release pin the launch runs from via the plan's `releases:` map (`<repoId>.<generationId>: <releaseId>`). Unlisted generations shall use the pin flagged `latest`.
- **FR-PLN-021.** An unknown generation key or release id shall be a load-time error. A generation in use with several pins, none flagged `latest`, and no plan selection shall be a load-time error.
- **FR-PLN-022.** The selected pin and its resolved commit shall be recorded in the launch's results, so "what code produced this address" stays recoverable from the result alone.

#### Deployment identity and re-runs

- **FR-PLN-030.** The deployment id shall be resolved at run time: the CLI `--deployment-id` if given, else the **selected preset's name**. The id shall key the results tree and resolve `${system.DEPLOYMENT_ID}`.
- **FR-PLN-031.** Under the resolved id, an unfinished deployment shall be **resumed automatically** (the invocation becomes another run attempt; idempotent steps replay; only incomplete work executes). A resume shall run against the deployment's records: the recorded chain list, the frozen parameter set (FR-RUN-005b), and the recorded structure (FR-RUN-005c). `--restart` shall opt out, leaving the unfinished deployment's records immutable and starting fresh. When all deployments under the id are complete (or none exist), a fresh deployment shall start; a taken id shall receive an ordinal suffix (`<id>-2`, `<id>-3`, …).
- **FR-PLN-032.** The concrete (possibly suffixed) id shall be fixed **before** plan resolution consumes it, and recorded in `deployment.yaml`.

#### Deployment overrides

- **FR-PLN-040.** The user shall be able to apply one-off, last-mile parameter overrides at launch time without editing the plan file: `--set KEY=VALUE` (repeatable, flat constants) and `--overrides <path>` (a full Preset-shaped object). Overrides shall **merge on top** of the selected preset — merge, never replace.
- **FR-PLN-041.** Applied overrides shall be recorded in `deployment.yaml` so the launch stays reproducible. (Overrides are recorded unredacted; credentials therefore never belong in overrides — see FR-SEC-014.)

#### Secrets in the plan

- **FR-PLN-050.** Each preset's `secrets:` blocks shall carry the launch's credentials as named slots: the built-in `privateKey` (required on every active chain whenever the workflow contains deploying steps — waived in multisig mode) plus arbitrary author-named slots (`^[a-z][a-zA-Z0-9]*$`) for multi-key setups.
- **FR-PLN-051.** Secret values shall be, in order of preference: a single `${vault.X}` token (preferred), a single `${env.X}` token (allowed), or a literal (accepted but discouraged — it sits in plaintext in the YAML). All three forms shall be tagged and redacted identically.
- **FR-PLN-052.** Verification API keys shall not be plan secrets (the v1 `verificationApiKey` slot and its `""` tri-state are removed); they live on verification profiles in known-chains, and explicit disable is `verifiers: false`.

#### The `deploy` block — salts and factories

- **FR-PLN-060.** The preset's `deploy` block shall carry per-launch deployment-strategy **data** only (never the method): `salts.<stepId>`, `factories.<stepId>`, and an optional `saltBase`. Values may embed `${global.X}` / `${system.X}` / `${random.N}` / `${env.VAR}` references.
- **FR-PLN-061.** Salt normalization shall follow one rule: a value of `0x` + exactly 64 hex characters is used as the salt bytes verbatim (a mined vanity salt); a malformed `0x` value is an error; any other string is `keccak256(string)`. Normalization shall happen script-side in the bundled deploy machinery so the reported address matches what the script computed.
- **FR-PLN-062.** For a step whose resolved method is `create2` or `create3`, the salt shall resolve by the ladder: explicit `salts[stepId]` (no warning) → derived from `saltBase` per step id (validation warning) → derived from a random default base (stronger warning that addresses are not reproducible). A salt shall therefore always resolve.
- **FR-PLN-063.** A step resolving to `create3` with `factory: oneInch` or `solady` and no `factories[stepId]` entry shall be a hard validation error (no factory fallback). A `createx` step shall need no factory entry (canonical singleton known to the engine). Entries unused by a step's resolved method or flavor shall be harmless.
- **FR-PLN-064.** Salt derivation from `saltBase` shall be deterministic and chain-independent, so derived CREATE3 addresses are identical across chains and distinct steps never collide.
- **FR-PLN-065.** For an `array: true` input supplied as a static plan value, the user shall be able to give the whole list as a JSON-array-string constant, which the engine parses into a list at input resolution.

#### Single-action plans

Some launches are genuinely one step — transfer ownership, mint an NFT, deploy one standalone contract — run once on one, several, or all chains. A single-action plan lets the user run one action without authoring a one-step workflow: the plan's `workflow` field takes an **inline step object** instead of a workflow id.

- **FR-PLN-070.** The `workflow` field shall accept two forms: a **string** (a workflow or variant id resolved in the workflows file) or an **object** — an inline step in the same grammar as a workflow step, restricted to `action` (required), `method`, and `factory`. The inline `action` shall be resolved by the same rules as a workflow step's `action` field (FQ id or alias); an unresolvable reference shall be a load-time error.
- **FR-PLN-071.** The engine shall run the inline step as a **one-step workflow**: the step id shall be the action's default step id (the last FQ-id segment, or the alias), keying `deploy.salts` / `deploy.factories` entries and the per-step result and artifact paths exactly as an authored step would.
- **FR-PLN-072.** The inline step's `method` (default `create`) and `factory` flavor (`create3` only, default `oneInch`) shall carry workflow-step semantics and validation verbatim: `method` on a non-contract/module action, `factory` without `create3`, and `create3` on a Hardhat 3 type shall all be errors. The method-placement rule (FR-WFL-010) shall be preserved — the method lives on a step (here written inline in the plan file), and presets shall have no surface to set or change it; presets supply only the salt/factory-address data.
- **FR-PLN-073.** The inline step shall accept **no other step fields**: `id` (the derived step id is canonical), `mappings` (no wiring surface — no prior step exists), and a nested `workflow` reference (use the string form) shall all be schema errors. Every declared input shall resolve from the preset constant of the same name, required built-in parameters from their `builtin.<NAME>` constants, and the signing key from `secrets.privateKey` (multi-PK renames shall not apply).
- **FR-PLN-074.** Results of a single-action deployment shall be keyed by the **fully-qualified action id** in place of the workflow id (`workspace/results/<repoId>.<generationId>.<actionId>/<deployment_id>/<chain>/`), regardless of whether the plan referenced the action by FQ id or alias.
- **FR-PLN-075.** Everything else shall behave identically to a workflow plan: preset selection and isolation, deployment overrides, release selection for the action's generation, chain scope and chain modes, the salt resolution ladder, idempotency and flag-less resume, dry run, verification gating, deployment records, and **multisig mode** (the planning contract, `supportsMultisig` requirement, waiting state, and post-execution pass apply unchanged).

### 4.7 The multisig registry

Some launches must be signed by a Gnosis Safe rather than a single key — the Safe owns the factory, or policy requires N-of-M approval. In v2 that is a **run parameter**: the same plan deploys as EOA on staging and through a Safe on production, with zero config edits. The registry of available Safes lives in its own file so that an environment can be provisioned with only the multisigs it is allowed to use — the mounted file *is* the allowlist.

- **FR-MSG-001.** The engine shall read multisig configuration from `multisig.yaml`: a `multisigs:` map of named, self-contained entries. Entry names shall match `^[a-z][a-z0-9-]*$`; chain keys shall be known-chains names.
- **FR-MSG-002.** Each entry shall declare a `backend` (`multisend` or `merkle`) and per-chain data: a required `safe` address on every chain; for `merkle`, a required per-chain `module` address (the Sphinx-based deploy module enabled on the Safe); for `multisend`, an optional per-chain `transaction_service` URL override. Fields of the other backend shall be rejected by schema.
- **FR-MSG-003.** Entry credentials shall follow the standard secret rules — a single `${vault.X}` or `${env.X}` token, tagged and redacted: `proposer` (required on multisend; a Transaction Service delegate that can only queue), `executor` (required on merkle; optional on multisend for auto-execution at threshold; pays gas, holds no approval power). Safe **owner keys shall never appear anywhere in deploy-pad**.
- **FR-MSG-004.** A selected entry shall be required to cover every active chain of the run; a gap shall be a validation error naming the chain and the entry.
- **FR-MSG-005.** Nothing multisig-related shall live in a plan, workflow, or action (except the `supportsMultisig` author opt-in flag on author-command deploying actions, FR-MSG-014).

The multisig **execution model** (planning, batching, backends, waiting/resume) is specified with the execution lifecycle in [Chapter 7](#76-multisig-execution) since it modifies the run lifecycle rather than the configuration surface.

---

## 5. Value resolution and references

The previous chapter described where values are *declared*. This chapter describes how they are *resolved*: the `${...}` substitution system that turns names into values at plan load, and its strict boundary with the workflow-side transform machinery. The design principle is a **closed set of explicit namespaces** — a reader can always tell where a value comes from by its prefix, and a typo can never silently resolve against the wrong source.

### 5.1 The namespace system

- **FR-REF-001.** The engine shall support exactly six reference namespaces, each written as `${<namespace>.<name>}` inside a string value: `global.` (the globals registry), `system.` (engine system variables), `secret.` (the credentials registry — engine-injected, never authored), `vault.` (the vault registry), `random.` (fresh random strings), and `env.` (process environment variables).
- **FR-REF-002.** Explicit namespacing shall be mandatory: every `${...}` token must start with one of the six prefixes. Bare `${VAR}` (the v1 form) shall be rejected by schema, with `${env.VAR}` as the replacement. The six namespaces are a closed set — no others exist.
- **FR-REF-003.** Every namespace shall support the **exact** form (the whole value is one reference) and, except `${vault.X}` (single-token outside the RPC-header exception), the **inline** form (the reference embedded in a larger string, e.g. `"deploy_${random.16}_${system.CHAIN_ID}"`).
- **FR-REF-004.** References shall be resolved at plan **load time**, per namespace, in a fixed order (FR-REF-030). Step input resolution (mappings, transforms) happens later and is a separate mechanism.

### 5.2 Where each namespace is valid (scoping)

- **FR-REF-010.** The engine shall enforce a scoping matrix — each configuration location accepts only its listed namespaces; everything else is rejected or left literal:

| Location | Accepted references |
|---|---|
| global-params `constants.*` | none — pure strings (globals are leaves; no recursion) |
| global-params `vault.*` | `${env.VAR}` only, single token |
| preset `defaults.constants` / `chains.<c>.constants` | `${global}`, `${system}`, `${random}`, `${env}` (inline ok) |
| preset `deploy.{salts,factories,saltBase}` | `${global}`, `${system}`, `${random}`, `${env}` (inline ok) |
| preset `secrets.*` values | `${vault}` or `${env}`, single token (literal accepted, discouraged) |
| plan chain selectors (`rpc:` / `verifiers:`) | none — bare profile names / `false` |
| known-chains `rpc.<p>.url` | `${env}` only (inline ok) |
| known-chains `rpc.<p>.headers` values | `${vault}` / `${env}`, **inline allowed** (tagged secret wholesale) |
| known-chains `verification.<p>.api_key` | `${vault}` or `${env}`, single token, no literal |
| actions `repository.auth` | `${vault}` or `${env}`, single token |
| multisig `proposer` / `executor` | `${vault}` or `${env}`, single token |
| action bodies (`inputs`, `outputs`, `command`, `contract`, …) | none — actions are pure declarations |
| workflow `mappings` (incl. pipeline sources) | none — refs/renames only, never `${...}` |

- **FR-REF-011.** Actions shall remain pure declarations: no namespace shall be valid inside an action body. Chain-specific or runtime values shall be threaded to actions via plan constants and workflow mappings.
- **FR-REF-012.** Workflow mappings shall never be interpolated strings; the `${...}` system shall not apply to them (see FR-WFL-032).

### 5.3 Namespace-specific semantics

- **FR-REF-015.** `${global.NAME}` shall resolve chain-aware against `global-params.yaml` (per-chain override wins over the default), with the chain context taken from the surrounding plan block.
- **FR-REF-016.** `${system.NAME}` shall expose engine execution context. Five names shall have a reference form, being single-valued per chain: `CHAIN_ID`, `CHAIN_NAME`, `NETWORK` (a legacy alias of `CHAIN_NAME`), `RPC_URL` (the selected RPC profile's resolved URL), and `DEPLOYMENT_ID`. Two further members shall be **command-env-only** because they vary per step: `VERIFY` and `ARTIFACTS_DIR` — they reach the command solely as `SYS_VERIFY` / `SYS_ARTIFACTS_DIR`, and writing them as `${system.X}` shall be a miss like any other. The engine shall inject all system variables into every deploying step's command environment under the `SYS_` prefix. The v1 one-off `${chain}` template shall not exist in v2 — commands build chain-aware paths from `SYS_CHAIN_NAME` themselves.
- **FR-REF-017.** `${secret.NAME}` shall be engine-injected only: authors never write it as a config value. It shall resolve per chain from the resolved plan `secrets:` (chain block winning over preset defaults), with the exception of `${secret.verificationApiKey}`, which the engine sources from the selected verification profile's `api_key` in known-chains (one verification pass per selected profile, each with its own key; keyless profiles inject nothing).
- **FR-REF-018.** `${random.N}` shall generate a fresh random alphanumeric string (charset `a-z A-Z 0-9`) of length `N` (a positive integer) on **every plan load**, by design and without any persistence, replay, or seeded form — it is a test-only convenience for throwaway uniqueness and shall not be used for anything requiring determinism across runs (production salts, audited identifiers). Malformed forms (`${random.0}`, `${random.abc}`) shall be schema errors.
- **FR-REF-019.** `${env.VAR}` shall resolve against `process.env` (names matching `[A-Za-z_][A-Za-z0-9_]*`), last among the namespaces, and its output shall never be re-processed for further references.

### 5.4 Miss behavior and the `strict` flag

Unresolved references are dangerous — a token that silently resolves to an empty string can deploy a contract with a zero-address constructor argument. v2 therefore makes misses **hard errors by default**, with a narrow, transitional opt-out.

- **FR-REF-020.** By default (plan `strict: true`), every namespace shall throw on a failed lookup at its own resolution step, aborting the plan load with an error naming the token and its location. Nothing shall be left in place and nothing shall silently resolve to an empty string.
- **FR-REF-021.** With plan `strict: false`, load-time misses of `${global.X}`, `${system.X}`, and `${env.VAR}` inside **plan values** (the selected preset's constants, deploy values, and secrets values) shall leave the token in place, with one aggregated post-resolution warning pass reporting every unresolved token. A step that actually **consumes** an input still containing an unresolved token shall remain a hard error at step input resolution — non-strict tolerates unused placeholders; it never lets an unresolved token reach a command. **[Open item: OI-3]**
- **FR-REF-022.** The following shall be **always strict**, regardless of the flag: `${vault.X}` lookups, known-chains connection fields (`url`, `headers`, `api_key`), `repository.auth`, and `${secret.X}` at step input resolution.
- **FR-REF-023.** Intentional empties shall be explicit (`KEY: ""`), never a dangling reference. Non-selected presets may hold not-yet-resolvable references (only the selected preset is resolved). A reference in a preset's `defaults.constants` must resolve on **every** active chain (defaults merge into each chain before resolution); chain-asymmetric globals belong in per-chain blocks.

### 5.5 Resolution order

- **FR-REF-030.** Plan loading shall resolve substitutions in this fixed order: (1) load raw YAML; (2) resolve chain references against known-chains — pure lookup plus profile selection; (3) select the preset — its values become the plan's values, chains filtered; (4) apply deployment overrides — merge on top; (5) resolve `${global.X}` per chain, after merging preset defaults into each chain; (6) resolve `${system.X}` per chain, with `DEPLOYMENT_ID` from the run context; (7) merge preset default secrets into each chain; (8) resolve `${vault.X}` (plan secrets plus known-chains credentials), tagging results as secrets; (9) resolve `${random.N}`; (10) resolve `${env.VAR}` last.
- **FR-REF-031.** After their merge steps, the preset's `defaults.constants` and `defaults.secrets` shall be emptied; the per-chain blocks are the canonical post-load source.
- **FR-REF-032.** Each resolver shall skip tokens that are not its own namespace, so that under `strict: false` unresolved earlier tokens survive later steps as literals.

### 5.6 Built-in command parameters

- **FR-REF-040.** Built-in parameters (`builtin.<NAME>`, FR-CFG-004) shall resolve by the same ladder as declared inputs: (1) the per-step workflow mapping (step output ref, rename, or production pipeline); (2) the plan constant under the literal `builtin.<NAME>` key — a **shared** fallback read by every unmapped step of the type; (3) the type-declared default for optional built-ins; (4) otherwise, for a required built-in, a step-input-resolution error naming the parameter, step, type, and chain.
- **FR-REF-041.** Deployment strategy and the private key shall never be built-in parameters: the method belongs to the workflow (step `method` + variants), factory/salt data to the plan `deploy` block, and the key to the secrets channel. The v1 flat constants `deployMethod` / `create2Salt` / `create3Factory` / `create3Salt` shall not exist in v2.

### 5.7 Transforms versus substitution

- **FR-REF-050.** The engine shall keep its two value-shaping mechanisms strictly separate and non-overlapping in syntax: `${...}` substitution resolves **names into strings at plan load**; transforms/combines **reshape resolved values at step input resolution**. A transform value is a transform name, a combine value an op string, a pick value an integer literal, a pipeline source a bare ref — never a `${...}` token, and vice versa.

---

## 6. Secrets management

A *secret* is any credential: a deployer private key, a verification API key, an RPC bearer token, a git token, a multisig proposer or executor key. The governing principle: **committed YAML carries only pointers; the real value exists only in the environment at execute time; and everything that flows through the secret channel is tagged and redacted uniformly, regardless of how it was authored.**

### 6.1 The layered credential model

Credentials flow through up to four layers, each with exactly one job:

```
process.env → vault (role → env pointer) → plan secrets (slot → vault ref)
            → workflow mapping (per-step slot rename) → engine (${secret.X} → SEC_*)
```

- **FR-SEC-001.** The engine shall support this four-layer chain: the vault names a stable role and points it at an env var; the plan's `secrets:` declares named slots and which vault entry feeds each; a workflow step optionally renames `privateKey` to a different slot; the engine injects the resolved value at run time. Authors write `${vault.X}`; the engine runs with `${secret.X}`; authors never write `${secret.X}` themselves.
- **FR-SEC-002.** The vault shall exist as a designated indirection layer (rather than direct env references everywhere) so that future secret sources — encrypted stores, cloud secret managers — can be added behind the same `${vault.X}` references without touching any plan, workflow, or action.
- **FR-SEC-003.** The user shall be able to run different steps of one workflow with different signing keys (multi-PK) without changing the workflow's values: vault entries declare the roles, plan slots bind roles per chain, per-step `mappings.privateKey: <slot>` renames select the slot, and a method variant's `keys` map may override the rename per step. A step with no rename shall read the default `privateKey` slot.
- **FR-SEC-004.** The same workflow shall be reusable unchanged across plans that wire different physical keys per step — the rename carries a *name*, never a value.

### 6.2 Tagging and redaction

- **FR-SEC-010.** The engine shall tag as a secret **every** value resolved for the secret namespace and every connection credential — whether authored as `${vault.X}`, direct `${env.X}`, or a literal. The source shall affect only indirection (rotation/audit), never protection.
- **FR-SEC-011.** A tagged value shall receive three guarantees: (1) **excluded from all writer output** (`.env.automation`, JSON files, and every other serialized file); (2) **delivered to subprocesses via process environment only**, under the `SEC_` prefix; (3) **redacted in all logs and run records** (`run-N.yaml`, `result.yaml`, `config_snapshot.yaml`, `deployment.yaml`, structured logs) as `********` or `[redacted: <label>]`, with the label preserved for debugging (the vault entry name when one exists, else the slot name).
- **FR-SEC-012.** Tagging shall be applied at the **load layer**, before any enricher runs, so that author extensions can never propagate a derived value untagged by accident; tags shall be carried through the entire pipeline. Custom enrichers adding sensitive values shall mark them tagged; custom writers shall skip tagged keys (author obligations the engine documents but does not enforce at runtime).
- **FR-SEC-013.** The engine shall guarantee redaction for its own output and for all engine-owned commands (bundled scripts, the Ignition wrapper, in-process contract calls). For author-written commands, the engine shall hand the real credential over the `SEC_*` environment (the command needs it to sign) and can no longer police what the script does — the documentation shall state the script author's obligations (never echo, persist, or argv-pass a secret).
- **FR-SEC-014.** The engine shall inject into each step **only the secrets that step actually uses** — its resolved private key as `SEC_PRIVATE_KEY` and, when verification gates pass, `SEC_VERIFICATION_API_KEY` — never the whole `secrets:` block. Credentials shall never be passable through CLI overrides or constants: `--set` values are recorded unredacted, and `constants` are never tagged; credentials belong exclusively in `secrets:` blocks and connection-credential fields.
- **FR-SEC-015.** For in-process operations (`contract-call` with `mode: send`), the key shall never leave the engine process at all — no env handoff, no writer files, no argv.

### 6.3 Private-key requirements per step

- **FR-SEC-020.** The engine shall require a resolvable `${secret.privateKey}` (or the renamed slot) for every deploying step, per chain, at step input resolution — with the requirement waived in multisig mode, where planning signs nothing. A consumed-but-missing secret shall always be a hard error ("secret `<name>` not found for chain `<c>`"), regardless of the `strict` flag.
- **FR-SEC-021.** Non-deploying steps shall receive a key only on explicit opt-in (`requiresPrivateKey: true`); on `contract-call`, `mode: send` shall drive injection instead.

### 6.4 Connection and infrastructure credentials

- **FR-SEC-030.** Verification API keys and RPC auth tokens shall live in known-chains (per profile), git tokens in `repository.auth`, and multisig proposer/executor keys in the multisig registry — all as single-token vault/env pointers, all tagged and redacted (see FR-CHN-020/021, FR-ACT-010/011, FR-MSG-003). Different explorer accounts shall be expressed as separate verification profiles pointing at different vault entries.
- **FR-SEC-031.** No CLI flag shall ever take a credential **value**; the CLI selects names only (`--preset`, `--multisig`).

---

## 7. Execution lifecycle

With configuration and value resolution specified, this chapter covers what actually happens when the user runs the engine: the eight phases of a run, the per-step lifecycle inside phase 7, the chain execution modes, verification, idempotency, the multisig execution branch, and the records the run leaves behind. The guiding principle: **everything that can fail before the first transaction fails before the first transaction** — statically where a file can prove it, by cheap dynamic probes where it cannot — and only phase 7 changes on-chain state.

### 7.1 The eight run phases

- **FR-RUN-001.** Every `run` invocation shall pass through eight phases in order: (1) invocation & run context; (2) config load & validation; (3) workflow resolution & static planning; (4) deployment resolution (resume or fresh); (5) dynamic preflight checks; (6) eager repository prepare; (7) per-chain execution; (8) persistence & final report. Phases 1–6 shall be free of on-chain side effects.
- **FR-RUN-002.** Phase 1 shall fix all run parameters that deliberately live outside config files: the plan, the preset, deployment identity (`--deployment-id` / `--restart` / `--refreeze`), chain scope (`--chain` / `--exclude-chain`), chain execution mode (`--chain-mode`), sender mode (`--multisig`), and the escape hatches (`--ignore-version`, `--skip-verify`, `--dry-run`, overrides).
- **FR-RUN-003.** Phase 2 shall load the mounted config set and validate each file in order: config version check → schema validation → referential validation (everything a schema cannot see — cross-file references, prior-step rules, cycles, chain names, pin selectability, multisig chain coverage) → the ten-step plan value resolution (FR-REF-030). Its output shall be a fully resolved, per-chain plan with every secret tagged.
- **FR-RUN-004.** Phase 3 shall turn the selected workflow into a concrete **execution plan**: flatten nested workflows, apply variant overrides statically per chain, and run the required-data checks (CREATE3 factory coverage, salt resolution with its warning ladder, resolvable private keys — waived in multisig mode, and the multisig-mode preconditions). For a single-action plan (FR-PLN-070), phase 3 shall treat the inline step as a one-step workflow; flattening and variant application are trivially empty, and the same required-data checks apply against the inline step's method and factory flavor. The result: per chain, a flat ordered step list with resolved methods, factory flavors, key slots, and salt/factory data.
- **FR-RUN-005.** Phase 4 shall inspect the results tree under the resolved deployment id and decide resume-or-fresh per FR-PLN-031. For a fresh deployment it shall write `deployment.yaml` — the immutable launch record (selected preset, overrides, multisig entry name, resolved id, chain provenance, structural fingerprint per FR-RUN-005c) — before any execution.
- **FR-RUN-005b.** *(See [architecture/phase-4-deployment-resolution.md → The parameter freeze](architecture/phase-4-deployment-resolution.md#the-parameter-freeze-on-resume).)* At deployment creation, phase 4 shall write the **frozen parameter snapshot** (`config_snapshot.yaml`): the resolved constants and deploy data for **every chain the plan declares** (in scope or not), with `${random.N}` values generated once and persisted; **secret-tagged values shall never persist** — they re-resolve live on every invocation. A **resumed** deployment shall run with the recorded snapshot, never with a fresh resolution of the current plan; when the current plan's resolution differs (the comparison shall inject the recorded random values), the engine shall emit a **warning naming the changed keys** and proceed with the frozen set. A chain declared at launch but brought into scope later shall use its frozen values; a chain added to the plan *file* after launch shall resolve fresh on its first attempt, be appended to the snapshot, and warn. `--set` / `--overrides` on a resumed deployment shall be a load-time error unless `--refreeze` is passed. `--refreeze` shall discard the recorded set, re-resolve from scratch as a first run (current plan, this invocation's overrides, fresh randoms), rewrite the snapshot, and record the event in the attempt record; the resume semantics (idempotent replay, incomplete-work-only) shall be otherwise unchanged.
- **FR-RUN-005c.** *(See [architecture/phase-4-deployment-resolution.md → The structural fingerprint](architecture/phase-4-deployment-resolution.md#the-structural-fingerprint-no-resume-across-a-changed-shape).)* At deployment creation, `deployment.yaml` shall record a **structural fingerprint** — a hash over a canonical serialization of the execution plan's structure per chain (ordered step ids, fully-qualified action ids and their definitions, resolved methods, factory flavors, key slots, declared pin refs — excluding all values, the chain list, and resolved `branch`-pin HEADs). On resume the engine shall recompute and compare; a mismatch shall be a **hard validation error** (exit `2`) stating that the workflow or actions changed since the deployment started and recommending a new deployment under a new id (or `--restart`).
- **FR-RUN-005a.** *(See [architecture/phase-5-preflight.md](architecture/phase-5-preflight.md).)* Phase 5 shall verify the **on-chain preconditions** the run depends on — connectivity, funds, deployment infrastructure, and any operator-declared dynamic fact — before repository preparation, on every `run` invocation (fresh and resume alike; never on `validate` or `--dry-run`), by executing the **preflight checks** declared in the engine's own configuration file (`engine.yaml`). The mechanism shall be uniform, with **nothing engine-native**: every check — the shipped checks included — shall be a **TypeScript script** run out of process by the engine's TS runtime under one contract (exit code `0` = pass, the script's captured output surfaced verbatim as its report message; configurable `chain`/`run` scope, `error`/`warn` severity, `enabled`, and a free-form `params` object passed to the script verbatim; no per-check timeout or retry fields — the engine shall enforce only a fixed, generous per-check backstop limit against hung scripts), receiving the **check context** — a **curated, versioned** document (`contextVersion`, additive-only changes within a version) carrying a step view of the built execution plan (step ids, action ids, types, resolved methods and factory flavors, deploy data), the run's system variables, the per-chain **sender identity** (mode and paying *address* — never key material), and each in-scope chain's registry identity and selected RPC connection (URL, headers) — from which secret-tagged values shall never serialize (no `SEC_*` shall reach a check); operator scripts shall resolve relative to the config mount. Three checks shall ship **with the engine release** and be **enabled in the engine's default config**: `engine:rpc` (per chain, one JSON-RPC `eth_chainId` call verifying **reachability** and **identity**: the served chain id equals the registry's `chain_id`; `error`), `engine:create3-factory` (per chain, a **functional probe**: for every `create3` step, an `eth_call` to the resolved factory's address-computation view with the step's resolved salt — and the sender address for caller-namespaced flavors — proving the factory exists and answers its flavor's interface; the computed per-step deployment addresses shall be printed in the report as a pre-launch preview; trivially passing where no step is `create3`; `error`), and `engine:balance` (per chain, sender-mode aware: the payer's native balance against a requirement **estimated from the run itself** — (deployment steps × `gasPerDeployment`, default `1000000`, plus non-deployment gas-spending steps × `gasPerCall`, default `250000`) × current `eth_gasPrice` × `safetyFactor` (default `1.5`), with an optional per-chain `minimums` floor in `params`; shipped as `warn` while the heuristic earns trust). No further shipped checks are planned. The default config applies when no `engine.yaml` is mounted; a mounted `engine.yaml` shall **replace** the default wholesale (no merge). Any check shall be disableable without removal via `enabled: false`, the disabled state reported visibly. All enabled checks shall run for all chains before any abort, failures reported together; any `error`-severity failure shall exit with code `6`; `--skip-preflight` shall skip the phase with a recorded warning.
- **FR-RUN-006.** Phase 6 shall prepare **every release pin the execution plan uses, eagerly, before any chain executes**: clone or fetch into the pin's own directory (ephemeral credential injection for private repos), checkout per the pin's ref (recording the resolved HEAD commit), install dependencies, and build. Prepare shall run once per invocation, not per chain; pins shall be prepared **sequentially** (one pin's clone → checkout → install → build completes before the next begins); install and build shall run **on every invocation, with no caching** — immutable (`tag` / `commit`) pins included. A broken clone, missing dependency, or failing build shall surface here, before the first transaction.
- **FR-RUN-007.** Phase 7 shall run an outer loop over the resolved chain set and an inner loop over the execution plan's steps in workflow order. A failing step shall fail its chain: remaining steps of that chain are skipped, the failure recorded, and the other chains treated per the chain execution mode. A later invocation shall resume the failed chain at its incomplete work.
- **FR-RUN-008.** Phase 8 shall end the invocation with a per-chain, per-step summary and an exit code reflecting the earliest-phase failure class (see FR-CLI-005); alongside the printed summary it shall write `summary.json` at deployment level — a machine-readable summary of the invocation (schema-versioned, additive-only; status, exit code, per-chain per-step outcomes, warnings, pending multisig batches; rewritten each invocation; derived from the attempt records and redacted — see [specs/results.md](specs/results.md)). A summary/reporting failure (printed or JSON) shall be best-effort and never mask the run outcome.
- **FR-RUN-009.** Warnings (salt fallbacks, missing `version` keys, unpinned refs, verification-off-with-`verify: true`, parameter drift on a resumed deployment per FR-RUN-005b) shall never stop a run in any phase — they are printed and recorded, and execution proceeds.

### 7.2 Chain execution modes

- **FR-RUN-010.** The user shall be able to select, per invocation, how the chain loop reacts to a failing chain via `--chain-mode`:
  - `sequential` (default) — chains run one after another in the plan's declaration order; a chain failure stops the whole run (later chains recorded as not-attempted); resume picks up both the failed and the never-started chains;
  - `continue` — same order, but a failed chain is recorded and the loop moves on; resume re-attempts only the failed chains;
  - `parallel` — all chains run concurrently, isolated from each other's failures. **[Open item: OI-7]**
- **FR-RUN-011.** In `continue` and `parallel` modes, the invocation's exit code shall reflect the **worst** chain outcome, and the summary shall list each chain's status individually.
- **FR-RUN-012.** The multisig *waiting for signatures* state shall not count as a failure and shall never stop a sequential run: the loop proceeds to plan and propose the remaining chains (so owners can sign everything in one sitting), and the invocation exits with the waiting code. Only errors stop a sequential run.
- **FR-RUN-013.** The engine shall write all deployment working files (writer output such as `.env.automation`, the command's `.env.outputs`, the multisig planning file, the per-step artifacts staging area, and any engine-copied configs or scripts) into a **per-chain deployment run directory** inside the pin's checkout (`<checkout>/deployment-run/<chain>/`), never into the checkout root; the directory's absolute path shall be provided to every step's command as `SYS_RUN_DIR`, and the engine shall keep the folder out of `git status` via a local-only ignore rule (`.git/info/exclude`). In parallel mode, the engine shall enforce a **per-checkout mutex around the execute span only** (run directories make write/collect/cleanup chain-private; the framework's own on-disk state in the shared checkout is touched only while a command runs): commands sharing a checkout serialize; chains on different pins, and all RPC waiting, overlap freely. **[Open item: OI-8]**
- **FR-RUN-014.** In parallel mode, every log line shall be prefixed with its chain name, and the structured log file shall carry the chain as a field. Results shall remain per-chain by construction, so no mode changes *what* is recorded — only when and whether a chain is attempted in the invocation.

### 7.3 The step lifecycle

- **FR-STP-001.** Every step shall run a six-phase lifecycle: **idempotency lookup → enrich → write → execute → collect → cleanup**. Enrichers assemble the final parameter map (engine defaults first in fixed order, author extras appended); writers serialize it into the checkout in the formats the command class needs (skipping tagged secrets); the type's command executes; outputs are collected; temp files are removed and records persisted.
- **FR-STP-002.** Step input values shall be produced from their mappings — sources resolved, then pick → per-source transform → combine → action transform (FR-WFL-040-044) — **before** the enrichers run, so every enricher and writer sees final, shaped values.
- **FR-STP-003.** A failure in any enricher or writer shall be a step failure, equal in effect to a failed command; enrichment failures shall never write to the run directory.

#### The deployment interface

- **FR-STP-010.** The engine shall communicate with deploying commands exclusively through an explicit **deployment interface** — never by parsing framework deployment records (Foundry `broadcast/`, Hardhat `deployments/`). Inbound (process environment): the execution context (`SYS_CHAIN_ID`, `SYS_CHAIN_NAME`, `SYS_RPC_URL`, `SYS_DEPLOYMENT_ID`), the signing key (`SEC_PRIVATE_KEY`, per the private-key rule), the verification context (`SYS_VERIFY=1`, `SYS_VERIFICATION_API`, `SYS_VERIFIER_TYPE`, `SEC_VERIFICATION_API_KEY` — only when the gates pass), and an empty per-step artifacts directory (`SYS_ARTIFACTS_DIR`). Outbound: a `.env.outputs` file (`KEY=value`) containing every declared output, plus any files worth keeping dropped into the artifacts directory.
- **FR-STP-011.** `.env.outputs` shall be the only output channel for command-driven steps (`contract-call` being the in-process exception, recording decoded return values directly). Non-deploying steps shall use the same channel; the deployment interface merely adds the verification and artifacts surface on top.
- **FR-STP-012.** The engine's bundled machinery for contract and module types shall fulfill the deployment interface itself (addresses to `.env.outputs`, ABIs to the artifacts directory, inline verification), requiring no author involvement; author-written commands (`make`, script types with `deploys: true`) shall fulfill it themselves, wrapping unmodifiable recipes where needed.
- **FR-STP-013.** After a successful deploying step, the engine shall persist the artifacts directory contents to `workspace/results/<workflow>/<deployment_id>/<chain>/artifacts/<step_id>/` (nothing persisted when empty).

#### Verification

- **FR-STP-020.** Verification of a deploying step shall be gated by two switches that must both be on: the action's `verify: true` flag and at least one selected verification profile on the chain. When both pass, the engine shall set the verification context on the command and expect **inline** verification as part of the command's own run; when either is off, none of the verification variables shall be set and the command must skip verification. There shall be no separate engine-run verification phase in EOA mode; an inline verification failure is a step failure.
- **FR-STP-021.** With several selected profiles, bundled machinery shall verify against each profile in order (one pass per profile, any failure failing the step); author-written commands shall receive the first selected profile's context — a documented limitation of the single-run interface.

#### Idempotency and replay

- **FR-STP-030.** For a step whose effective `idempotent` is `true`, the engine shall consult a prior-run index keyed by `(workflow, deployment_id, chain, stepId)` before executing. On a hit (most recent recorded attempt succeeded), the engine shall **replay** the recorded outputs into downstream mappings, mark the step `replayed: true` with a back-reference to the source run, and skip the rest of the lifecycle. On a miss, the step executes normally.
- **FR-STP-031.** The index shall be rebuilt from the `run-N.yaml` files on disk at engine startup (no separate persistent cache), shall match step ids exactly (renaming a step invalidates prior results), and shall be scoped to one deployment id and one chain — a fresh id or chain forces full execution.

### 7.4 Deployment records

- **FR-RUN-020.** The engine shall write, per deployment: `deployment.yaml` (once, at deployment start — immutable), `config_snapshot.yaml` (at deployment start; the frozen parameter set per FR-RUN-005b, secrets redacted; rewritten only by an explicit `--refreeze`), `summary.json` (per FR-RUN-008); and per chain: one `run-N.yaml` per invocation (per-step attempt records: status, resolved constants, inputs, outputs, replay markers, multisig batch statuses), `result.yaml` (the aggregate, updated after each step or batch: latest per-step outcome, confirmed addresses, constants), and the per-step `artifacts/` directories. Record shapes and layout are owned by [specs/results.md](specs/results.md); every record shall carry a format version with additive-only evolution within a version.
- **FR-RUN-021.** Records of a completed or abandoned deployment shall never be mutated: a re-run under the same id resumes into new run attempts or starts a fresh, suffixed deployment directory.

### 7.5 Dry run

- **FR-RUN-030.** The user shall be able to preview a run without side effects: `--dry-run` shall load, validate, and statically plan (phases 1–3), print what would execute — chains, step order, resolved methods, and predicted deterministic addresses where computable — and exit without touching any chain or writing any results. A dry run shall be distinct from multisig planning: it only reports, producing no signable artifacts.

### 7.6 Multisig execution

In multisig mode the same chain loop runs, but the execute phase is replaced by a **planning contract**: nothing broadcasts until Safe owners approve.

#### Planning

- **FR-MSG-010.** In multisig mode, deploying steps shall not broadcast: each shall be simulated as the Safe, with the engine setting `SYS_MULTISIG=1` and `SYS_SENDER_ADDRESS=<safe>` on the step, and `SEC_PRIVATE_KEY` not injected (nothing signs during planning).
- **FR-MSG-011.** The contract between a planning step and the engine shall be the file `.deploy-pad-transactions.json` in the step's run directory (`SYS_RUN_DIR`; deleted by the engine before the run, read at collect): an ordered `transactions` array of `{ to, value, data, description? }`, where `data` is self-contained calldata (bytecode and constructor args embedded) and `description` feeds the human proposal report. Array order is execution order.
- **FR-MSG-012.** Planned steps shall still write **predicted** values for every declared output to `.env.outputs`, so downstream mappings, nested workflows, and contract-call calldata building work unchanged and a whole workflow can usually be planned in one pass.
- **FR-MSG-013.** Predicted addresses shall follow the deterministic-method rules: `create3`/`oneInch` addresses are caller-independent (but the Safe must own the factory); `create3`/`createx`/`solady` addresses depend on the Safe's address (caller-namespaced salts — vanity salts must be mined against the Safe); `create2` is computable directly; plain `create` shall be predicted from the Safe's current nonce plus batch position, with a validation warning that a concurrent Safe transaction would shift it.
- **FR-MSG-014.** Bundled contract types (`forge-contract`, `hardhat2-contract`) and `contract-call` shall comply with the planning contract automatically. Author-command deploying actions shall opt in with `supportsMultisig: true` and honor the contract (`SYS_MULTISIG=1` → simulate, write transactions and predicted outputs, expect no key and no verify flag); a deploying step whose action lacks the flag shall fail validation at planning time. Hardhat 3 deploying steps (`hardhat3-contract`, `hardhat3-module`) shall be rejected in multisig mode (Ignition offers no dry-run transaction extraction).

#### Batching

- **FR-MSG-020.** The engine shall put the whole run on a chain into **one batch** by default, cutting a batch only at a **semantic boundary** — a point where planning cannot continue until prior transactions have executed (canonically: a `contract-call` read against a contract whose deployment is still unexecuted, or an author command reading on-chain state). Purely address-based dependencies shall not create boundaries. **[Open item: OI-4]**
- **FR-MSG-021.** The engine shall never silently split a batch. On the multisend backend, a batch that does not fit the chain's per-transaction limits shall fail at planning time with the estimate, the limit, and a recommendation to switch to the merkle backend — batch composition is part of what owners sign and must stay deliberate.

#### The multisend backend

- **FR-MSG-030.** On `backend: multisend`, the engine shall wrap each batch into one Safe MultiSend transaction, propose it to the chain's Safe Transaction Service with the `proposer` delegate key, poll for signatures, and — when the threshold is met — execute with the `executor` key if configured (otherwise leave execution to the Safe UI). One signature per owner per batch per chain; batches occupy sequential Safe nonces and execute strictly in order; MultiSend reverts wholesale if any inner call reverts.
- **FR-MSG-031.** On a chain with no Safe Transaction Service, the engine shall fall back to an **offline export**: write the batch as a Safe Transaction Builder JSON into the results directory, pause, and on a later resume detect execution on-chain by code appearing at the predicted addresses.

#### The merkle backend

- **FR-MSG-032.** On `backend: merkle`, the engine shall build one Merkle tree over every planned transaction of the run — all chains, all batches — with leaves carrying the chain id and execution index (per-chain ordering enforced on-chain), following the Sphinx Merkle-tree specification; owners shall sign a single EIP-712 message over the root (one signature per owner for the entire launch); the engine's `executor` key shall then execute leaves one by one through the audited, Sphinx-based deploy module enabled on the Safe, which verifies the root, proof, and ordering so the executor can neither reorder, skip, nor substitute anything.
- **FR-MSG-033.** Merkle execution shall be resume-friendly by construction: progress is on-chain state, and an interrupted executor picks up at the next unexecuted leaf. Cancellation of an approved root shall be a signed replacement root, surfaced as the `--multisig-cancel` invocation (on multisend, the same flag withdraws pending proposals from the service queue); either is recorded as another attempt.

#### Lifecycle, waiting, and post-execution

- **FR-MSG-040.** Multisig steps/batches shall progress through recorded statuses: `planned` → `proposed` → `executed` → `collected`, each persisted in the run records (per step: predicted outputs and planned transactions; per batch: the `safeTxHash` or Merkle root; execution tx hashes; the collected results).
- **FR-MSG-041.** The engine shall never wait in-process for humans: an invocation that has proposed everything and lacks signatures shall exit cleanly in the **waiting** state (exit code `10`), printing what is pending and where to sign. Any later invocation under the same deployment id shall poll, advance whatever became executable, run the post-execution pass for executed batches, and finish or report the still-pending state.
- **FR-MSG-042.** All invocations of one deployment shall use the same sender mode and registry entry: resuming an unfinished multisig deployment without `--multisig`, or with a different entry, shall be a load-time error naming the recorded entry (`--restart` abandons). A `planned`/`proposed` step shall not count as complete for idempotency; resume shall re-verify the recorded proposal rather than re-plan it — the signed hash/root is authoritative.
- **FR-MSG-043.** After a batch executes, the engine shall run the post-execution pass per affected step: confirm the execution transaction succeeded and code exists at each predicted address, promote predicted outputs to confirmed outputs in `result.yaml`, and persist the artifacts staged at planning time.
- **FR-MSG-044.** Verification in multisig mode shall move out of the execute phase: the engine shall run a **verify-only pass** after execution for every deploying step with the verification gates on, using the bundled verification machinery of the step's type against the confirmed address. Author-command steps whose inline verification cannot be re-invoked shall complete with a verification warning.
- **FR-MSG-045.** For every proposal the engine shall emit a human-readable **proposal report** into the results directory — one entry per transaction (what deploys where, via which method and salt; what gets called) — together with the exact hash the owners' wallet will display (`safeTxHash` on multisend, the EIP-712 root digest on merkle), so owners can compare report and wallet before signing.
- **FR-MSG-046.** What multisig mode shall *not* change: CREATE2/CREATE3 address derivation, the results directory layout, output flow between steps, and verification targets. What it changes: who the sender is, when transactions execute, and the existence of the waiting state.

---

## 8. Command-line interface

The CLI is the only interface the engine **ships**, and the only one any requirement in this document obliges. It is deliberately thin: it parses an invocation into the run parameters and hands them to the pipeline, so that no run behavior depends on having been started from a terminal (NFR-060). Its design follows the run model of the previous chapters: everything per-invocation (preset, deployment id, chains, sender mode) is a flag; everything durable is a file; no flag ever takes a credential value.

### 8.1 Commands

- **FR-CLI-001.** The engine shall expose five commands: `run` (execute a deployment — the only command that changes on-chain state), `validate` (load and validate everything for a plan without executing), `status` (inspect existing deployments and their per-chain, per-step statuses), `report` (generate a human-readable Markdown deployment report), and `list` (list the workflows, actions, and plans the mounted configs declare).
- **FR-CLI-002.** Every command taking `-e, --plan <nameOrPath>` shall resolve it uniformly: a short name (no `/`) resolves into `plans/<name>.yaml` (trailing `.yaml`/`.yml` tolerated); a path is used as-is.
- **FR-CLI-003.** The invocation wrapper shall source `workspace/configs/.env` into the environment before delegating to the engine, so `${env.VAR}` references and vault-pointed env vars resolve; CI achieves the same by exporting env vars in the job step.
- **FR-CLI-004.** Common flags shall be accepted by every command where meaningful: `--log-level <silent|error|warn|info|debug>` (console output threshold, default `info`; `silent` prints nothing at all — exit code, log file, and results tree carry everything; secrets stay redacted at every level), `-v, --verbose` / `-q, --quiet` (sugar for `--log-level debug` / `--log-level error`; at most one of the three may be given), `-l, --log-file <path>` (structured JSON logs to a file, always at full `debug` detail regardless of the console level), `--configs-dir <path>`, `--results-dir <path>`, and `--ignore-version`.
- **FR-CLI-006.** Flags shall be validated **per command**: each command shall accept only the flags meaningful for it (its own flags plus the common set), and any other flag shall be rejected as an invocation error (exit `1`) before anything is loaded — never silently ignored. In particular, run-only flags (e.g. `--multisig`, `--restart`, `--set`) passed to `status`, `report`, or `list` shall error.

### 8.2 Exit codes

- **FR-CLI-005.** The engine shall exit with codes that distinguish failure classes for CI: `0` success; `1` configuration error (load/parse, including an un-overridden version mismatch); `2` validation error; `3` repository error (clone, fetch, checkout, install); `4` step execution error (command failure or missing declared output); `5` verification error; `6` preflight error (RPC unreachable, chain identity mismatch, or another failing `error`-severity preflight check — see FR-RUN-005a); `10` multisig waiting state — a clean, non-failure exit distinct from `0` so CI can tell "pending" from "done".

### 8.3 The `run` command

- **FR-CLI-010.** `run` shall accept: plan and values (`-e/--plan` required; `--preset`; `--set KEY=VALUE` repeatable; `--overrides <path>` — both launch-time only: on a resume they error without `--refreeze`, see FR-RUN-005b); deployment identity (`--deployment-id`; `--restart`; `--refreeze`); chain scope (`-c/--chain`, `-xc/--exclude-chain` — mutually exclusive, comma-separated; `--chain-mode`); sender mode (`--multisig <name>`; `--multisig-cancel`); verification (`--skip-verify`; `--verify-only` — mutually exclusive); safety (`--dry-run`; `--skip-preflight` — see FR-RUN-005a); environment (`--repos-dir <path>`; `--cleanup` — delete the per-chain deployment run directories after successful completion).
- **FR-CLI-011.** Every name passed to `--chain` shall be required to exist in the **resolved** chain set (after the active preset's chain filter); a name outside it shall be an error. Excluding every chain shall be an error.
- **FR-CLI-012.** Resume shall be automatic and flag-less: repeating the same invocation continues an unfinished deployment; `--restart` is the only opt-out. There shall be no separate resume flag.
- **FR-CLI-013.** `--skip-verify` shall deploy without verifying (clearing the inline gate in EOA mode; skipping the verify-only pass in multisig mode). `--verify-only` shall verify contracts of a prior deployment without deploying anything, running each deploying step's verification machinery against its recorded address; it shall require an existing deployment under the resolved id.

### 8.4 The `validate` command

- **FR-CLI-020.** `validate` shall perform exactly what `run` checks before executing — config load (with version check), per-file schema and referential rules, plan value resolution, and the static planning checks — without executing, and shall report **all** collected validation errors rather than stopping at the first. Flags: `-e/--plan` (required), `--preset` (validation is preset-sensitive), chain scope, and `--multisig <name>` (adds the multisig-mode checks: chain coverage, `supportsMultisig`, no Hardhat 3 deploying steps).
- **FR-CLI-021.** `validate` shall exit `0` when the plan would load and pass validation, `2` with the collected errors otherwise; warnings shall be printed but never fail validation.

### 8.5 The `status`, `report`, and `list` commands

- **FR-CLI-030.** `status` shall inspect the results directory without touching any chain: everything by default, filtered by plan (`-e`), deployment (`--deployment-id` — detailed per-chain, per-step view with timestamps and run attempts), and chains. For multisig deployments it shall show batch progression and, for the waiting state, what is pending and where to sign.
- **FR-CLI-031.** `report` shall generate a Markdown report — deployed addresses, per-step outcomes, constants used — aggregated across all run attempts of a deployment, reading only the results directory. Flags: `-e` (required), `--deployment-id` (defaults from the selected preset), chain filters, `-o/--output` (default `report.md` inside the deployment's results directory), `--stdout`.
- **FR-CLI-032.** `list` shall enumerate the mounted config set: workflows (variants marked as such), actions (FQ ids, aliases, and types, grouped by repo/generation), and plans (each with its workflow and preset names), with `--workflows` / `--actions` / `--plans` filters.

### 8.6 Execution environments

The engine deliberately has no environment awareness of its own: a launch is always the same CLI invocation, and only the surrounding environment (which env vars are set, which configs are mounted) differs between a workstation and a pipeline.

- **FR-CLI-040.** The user shall be able to launch a deployment both **interactively from a workstation** and **from a CI pipeline** (e.g. a GitHub Actions workflow), using the same CLI invocation and the same configuration files, with no engine-side difference beyond environment provisioning. In CI, secrets enter via the job's environment variables (e.g. GitHub Actions secrets exported in the workflow step) instead of the local `workspace/configs/.env` file; everything else — resolution, validation, execution, records — shall behave identically (see NFR-041).
- **FR-CLI-041.** CI operation shall require no engine extensions: unattended execution (NFR-040), the exit-code contract (FR-CLI-005 — in particular code `10` letting a pipeline distinguish a pending multisig deployment from success or failure), and flag-less resume by re-triggering the same job (FR-CLI-012) shall together be sufficient to drive a deployment from a pipeline, including multi-day multisig launches. Because resume, replay, and multisig polling all read the results directory, a pipeline running on an **ephemeral** worker shall be responsible for persisting that directory between invocations — the engine performs no repository operations on the workspace it was invoked from, and the recommended pattern (committing the results tree back to the repository holding the configs, after every invocation regardless of exit code) shall be documented rather than implemented (see NFR-043).
- **FR-CLI-042.** For private-repository access from CI, the recommended setup shall be documented: the git token env var (the one the vault's `repository.auth` entry points at) is populated from the CI secret store, preferably via a short-lived, repo-scoped GitHub App installation token rather than a personal access token or the workflow's own `GITHUB_TOKEN` (which cannot read other repositories).

---

## 9. Non-functional requirements

The functional chapters describe *what* the engine does; this chapter states the qualities the whole system must exhibit. Most of them are already visible as design pressure behind individual functional requirements — this chapter makes them explicit and testable in their own right.

### 9.1 Auditability

- **NFR-001.** Every deployment shall be reconstructible from its results directory alone: the launch parameters (`deployment.yaml`), the fully resolved configuration (`config_snapshot.yaml`, secrets redacted), every attempt (`run-N.yaml`), the aggregate outcome (`result.yaml`), and the captured artifacts. "What code produced this address" shall be answerable from the recorded generation, release pin, and resolved commit; "who was the sender" from the recorded multisig entry or EOA mode.
- **NFR-002.** Deployment records shall be immutable once written: `deployment.yaml` is written once and never overwritten; abandoned deployments keep their records; new work always lands in new run attempts or new suffixed deployment directories.
- **NFR-003.** No secret value shall ever appear in any log, record, report, or serialized file produced by the engine or its bundled commands, at any verbosity level. Redaction placeholders shall preserve a debugging label without the value.
- **NFR-004.** Each preset shall be auditable in isolation: reading a preset alone shall fully determine the values a run with it uses (no inheritance, no cross-preset or base-layer merging).

### 9.2 Reproducibility and determinism

- **NFR-010.** Given the same configuration, environment, and deployment id, resolution shall be deterministic: method/flavor/key-slot resolution is fully static (workflow id + chain suffice), salt derivation is deterministic and chain-independent, and the only deliberately non-deterministic element is `${random.N}` — a documented test-only convenience.
- **NFR-011.** Production launches shall be expressible with fully pinned inputs: immutable code pins (`tag`/`commit`), explicit salts, and fixed constants; the engine shall warn wherever an input is not reproducible (unpinned refs, derived or random salts).
- **NFR-012.** Repeat launches shall not silently collide with prior ones: fresh deployments under a taken id get ordinal suffixes, and id-derived salt bases change with them.

### 9.3 Safety and fail-fast validation

- **NFR-020.** All statically detectable failures shall surface before the first on-chain transaction: config shape, referential integrity, value resolution, strategy-data coverage, repository preparation. Dynamic environment failures (an unreachable or wrong-network RPC, a failing preflight check) shall likewise surface before repository preparation (see FR-RUN-005a). The run phases shall be ordered so that phase 7 is the only phase with on-chain side effects.
- **NFR-021.** The engine shall prefer explicit errors over silent precedence everywhere two configuration surfaces could conflict (e.g. `inputConstants` vs plan constants, plan attempts to change a method, undeclared built-in mappings).
- **NFR-022.** Validation shall distinguish errors (stop the run) from warnings (recorded, never blocking), and `validate` shall report all errors collected, not only the first.
- **NFR-023.** Decisions that change what multisig owners sign (batch composition, re-planning a proposed batch) shall never be made silently by the engine; they shall require explicit human action (backend switch, cancellation, restart).

### 9.4 Security

- **NFR-030.** Committed configuration shall never need to contain a credential: every credential surface accepts vault/env pointers, and the schema rejects literals everywhere except plan `secrets:` (where literals are accepted but discouraged and still redacted).
- **NFR-031.** Credentials shall be delivered to subprocesses only via process environment (never files, never argv), injected per step and per need; repository tokens shall be injected per git process with no trace persisted; in-process operations shall keep keys inside the engine process entirely.
- **NFR-032.** The engine shall hold no multisig owner keys and implement no signing UI; approval power stays with the Safe owners and their own wallets.
- **NFR-033.** Environments shall be constrainable by mounting: the configs directory (and specifically the multisig registry) mounted to a run is the allowlist of what that run can use.

### 9.5 Operability and CI-friendliness

- **NFR-040.** The engine shall run unattended: no interactive prompts; resumability by re-invocation; exit codes that let CI distinguish success, each failure class, and the multisig pending state.
- **NFR-041.** The same configuration shall run unchanged on a developer laptop and in CI, with only the environment (env vars, mounted configs) differing.
- **NFR-042.** The engine shall never block waiting for human input mid-run; long-running human processes (signature collection) are absorbed by the exit-and-resume model.
- **NFR-043.** The results directory shall be **portable and version-controllable**, so that the exit-and-resume model survives an ephemeral worker: no record shall contain an absolute path, a hostname, or any other machine identity, and every path inside the tree shall be relative to the results root. Given the same configuration, a deployment shall resume from a copy of its results directory on a different machine exactly as it would on the machine that created it. Together with immutable, append-mostly records (NFR-002) and unconditional redaction (NFR-003), this shall make committing the tree to version control a safe persistence mechanism (see FR-CLI-041).

### 9.6 Config reviewability

- **NFR-050.** Configuration shall remain reviewable in plain diffs: YAML without anchors/aliases/merge keys, reuse only via explicit `${...}` references, schema-validated, with editor tooling support via schema headers.
- **NFR-051.** Every deviation from a base workflow's deploy strategy shall be an explicitly named, reviewable config entry (a method variant) rather than an override buried in launch values.

### 9.7 Embeddability

The engine ships one interface (chapter 8), and this section does not add another. It states the internal separation that keeps the command line from becoming the only way in — a quality of the code, verifiable today, that a future caller would build on.

- **NFR-060.** No run behavior shall live in the command-line layer. The command line shall be responsible only for parsing an invocation, rendering output, and returning an exit code; every command shall be invocable **in-process** from the invocation parameters alone, without argv, without terminating the process, and without writing to a real console or file system. Constructing those parameters directly shall not bypass any validation: the checks that apply to a parsed command line shall apply identically to programmatically supplied parameters, and the same shall hold for configuration — supplying configuration objects directly shall replace parsing only, never the version, schema, referential, or value-resolution gates (chapter 3). Post-validation internal artifacts shall not be accepted as inputs. Where configuration does not come from a mounted directory, the caller supplying it inherits the allowlist responsibility that mounting otherwise discharges (NFR-033). **[Open item: OI-17]**

---

## 10. Open items and assumptions

Everything in chapters 1–9 reflects **settled** design decisions. The items below are the open questions and deferred candidates recorded across the design set. Each item notes the requirements whose final shape depends on its resolution. Until resolved, the stated requirements stand as written (the open item describes a possible future change, not a gap in the current spec).

| Id | Open item | Description | Affected requirements |
|---|---|---|---|
| OI-1 | **Format migration plan** | The migration from v1 (JSONC configs, v1 code names, v1 docs) to v2 is deferred as a coordinated sweep once the design stabilizes. When, how, and what backward compatibility exists are undecided. | All chapters assume the v2 file set; FR-CFG-010–015 in particular. |
| OI-2 | **`address` validate/normalize transform** | A candidate encoding transform that validates and/or normalizes addresses (the honest successor of the dropped `checksum`). Added only if address hygiene becomes a real requirement; slots into the existing registry without structural change. | FR-ACT-041, FR-WFL-040-044 (encoding registry contents). |
| OI-3 | **Removal of `strict: false`** | The plan's `strict` flag is transitional: if no real non-strict use cases accumulate, the flag is removed and strict miss behavior becomes unconditional. New plans should not set it without a concrete reason. | FR-REF-021 (would be deleted), FR-REF-020/022 (would become unconditional), FR-PLN-001. |
| OI-4 | **Multisig boundary hint (`barrier: true`)** | Semantic batch boundaries are engine-detected for `contract-call` reads, but an author command that reads the chain internally is invisible to the engine. A per-step `barrier: true` hint (force a boundary before the step) may be needed once real workflows hit the case. | FR-MSG-020 (boundary detection), FR-WFL step surface. |
| OI-5 | **Multisig proposal staleness warning** | A `proposed` batch signed weeks later executes against a chain that moved on (predicted addresses stay valid; gas prices and factory ownership may not). A staleness warning on resume (proposal older than N days) is a cheap candidate addition. | FR-MSG-041/042 (resume behavior). |
| OI-6 | **Multi-Safe runs** | One registry entry is one Safe identity across chains. Different Safes per chain fit the current shape; steps within one chain alternating between Safes do not — deferred until a real need shows up. | FR-MSG-001/002 (registry shape), FR-MSG-010 (planning context). |
| OI-7 | **Parallel-mode concurrency cap** | `parallel` currently means "all chains at once". Plans with many chains may need a cap (RPC rate limits, machine resources); a `--max-parallel-chains <n>` companion flag is the likely shape. | FR-RUN-010 (parallel mode), FR-CLI-010. |
| OI-8 | **Per-checkout mutex granularity** | Per-chain deployment run directories already keep engine files collision-free, so the mutex covers only the execute span — but a long-running command in one chain still blocks another chain's command in the same checkout, because the framework's on-disk state (build caches, broadcast records) is shared. Going finer would mean per-chain copies of the whole checkout; deferred until parallel mode sees real workloads. | FR-RUN-013. |
| OI-9 | **Interface-compatibility enforcement across release pins** | Today "all pins of a generation build the same action interface" is an unverified author invariant. The engine could compile/inspect each pin and validate that `inputs` and `contract`/`module` actually match, failing fast on drift. | FR-ACT-007 (would harden from author responsibility to engine check). |
| OI-10 | **RPC failover (`urls:` list)** | An RPC profile holds one `url`. An ordered `urls:` list (try in order on connection failure) would slot in without structural change; deferred until a real need — named profiles already cover the "several providers" case. | FR-CHN-003 (profile shape), FR-REF-016 (`RPC_URL` semantics). |
| OI-11 | **Additional chain metadata** | Candidates beyond connection data: explorer browse-URL pattern (human-facing report links), native currency symbol, EIP-1559 support, multicall address. Would let engine and editor stop hardcoding per-chain quirks; risks scope creep. | FR-CHN-001 (entry shape), FR-CLI-031 (report content). |
| OI-12 | **Per-plan/preset repository credentials** | `repository.auth` points at the vault, which is not preset- or chain-aware; staging vs prod git tokens can differ only via which env var is set at runtime — asymmetric with `privateKey`, which is wired per plan/preset. Candidates: a plan `secrets:` slot named by `repository.auth` (the PK rename pattern), or preset-scoped vault lookup. | FR-ACT-010/012, FR-GLB-011/012, FR-SEC-030. |
| OI-13 | **Secret tagging for URL-embedded RPC keys** | Header-borne tokens are fully covered, but `rpc.<p>.url` accepts only inline `${env.VAR}`, which is not secret-tagged — a URL-embedded key can appear resolved in logs, records, and `SYS_RPC_URL`. Candidates: allow inline `${vault.X}` in `url` with wholesale tagging (redacts the entire URL), or substring redaction of the resolved ref value. | FR-CHN-003/020/021, FR-SEC-010/011, NFR-003. |
| OI-14 | **Output renaming across repeated steps** | A raw idea: whether downstream consumers need a renaming surface for outputs when the same action appears in several steps. v2 currently answers this with unique step ids (references are `stepId.OUTPUT`, so no collision) — the idea remains open in the scratchpad. | FR-ACT-040, FR-WFL-030/034. |
| OI-15 | **Pluggable artifact/verification modules** | A raw idea: extend the pluggable-component model (enrichers/writers) to artifact and ABI collection and to verification. Today those are fixed engine behavior per type. | FR-ACT-050, FR-STP-010-021. |
| OI-16 | **Design-doc completeness for plans and chains** | The design set's own progress tracker marks the plans and known-chains specs as not yet finalized; requirements in sections 4.2 and 4.6 may evolve with those docs. | FR-CHN-*, FR-PLN-*. |
| OI-17 | **Published programmatic interface (SDK)** | The internal boundary is required (NFR-060) and its two seams are designed — the invocation parameters and the configuration source. What is undecided is whether any of it becomes a *published* API, and in what shape: which entry points are public (parameter builders, configuration builders over the published config types, one call per command); how a caller without a console observes progress; what a typed outcome carries beyond the exit code and `summary.json`; and what resume means when the configuration never came from a file, given that the deployment record's plan reference and structural fingerprint assume a re-readable source. The trigger is a real second caller — the deferred user interface being the expected one. | NFR-060 (would gain a public-surface counterpart), FR-CLI-001 (would stop being the only entry), FR-CFG-013 (version gate for unparsed configs), FR-PLN-030/031 (resume identity for non-file sources). |
| OI-18 | **Packaged CI action** | CI operation needs no engine extension (FR-CLI-041), but every consumer currently rewrites the same workflow logic: the unattended invocation shape, results-tree persistence, and the exit-`10`-is-not-a-failure rule. A packaged composite action (or reusable workflow) would carry that pattern instead of documenting it, and would remove the most common CI mistakes by construction. Pure packaging — no engine change. | FR-CLI-040/041 (would gain a supported wrapper), FR-CLI-005 (the exit-code handling it encodes). |

**Assumptions carried by this document:**

- **A-1.** This design set describes intended v2 behavior; where its examples/schemas note that current semantics match v1, this document states the v2 target, not the current implementation.
- **A-2.** The v1 → v2 code and workspace rename (OI-1) does not change any requirement's substance — only the names of code-level artifacts referenced in the design docs.
- **A-3.** The multisend multisig backend ships before the merkle backend; both are stated as requirements here because both are settled design (the ordering is delivery sequencing, not scope).
- **A-4.** The user-guide deep dive on CREATE3 factory flavors (address-derivation formulas, per-chain availability, selection guidance) is documentation work, not an engine requirement, and is therefore not a numbered item here.

---

## 11. Traceability appendix

The map from requirement areas to their authoritative design sources. Within each area, individual requirements trace to the sections of the listed documents; the design rationale for cross-cutting decisions lives in [specs/design-decisions.md](specs/design-decisions.md).

| Area | Requirements | Primary sources |
|---|---|---|
| Configuration general | FR-CFG-001–015 | [README.md](README.md) (conventions), [specs/naming.md](specs/naming.md), [specs/references.md](specs/references.md) (identifier rules), [specs/engine-internals.md](specs/engine-internals.md) (config version check) |
| Chain registry | FR-CHN-001–021 | [specs/known-chains.md](specs/known-chains.md), [specs/secrets.md](specs/secrets.md) (connection credentials) |
| Globals & vault | FR-GLB-001–014 | [specs/global-params.md](specs/global-params.md) |
| Actions | FR-ACT-001–050 | [specs/actions.md](specs/actions.md), [specs/engine-internals.md](specs/engine-internals.md) (release checkout, repo auth, wiring table) |
| Workflows | FR-WFL-001–051 | [specs/workflows.md](specs/workflows.md), [specs/design-decisions.md](specs/design-decisions.md) (method placement, factory flavors, value transforms) |
| Plans | FR-PLN-001–075 | [specs/plans.md](specs/plans.md), [specs/design-decisions.md](specs/design-decisions.md) (presets-only value layer, single-action plans) |
| Multisig | FR-MSG-001–046 | [specs/multisig.md](specs/multisig.md), [specs/design-decisions.md](specs/design-decisions.md) (execution backends) |
| References & resolution | FR-REF-001–050 | [specs/references.md](specs/references.md), [specs/plans.md](specs/plans.md) (load order) |
| Secrets | FR-SEC-001–031 | [specs/secrets.md](specs/secrets.md), [specs/engine-internals.md](specs/engine-internals.md) (vault resolution & tagging) |
| Run lifecycle | FR-RUN-001–030 | [architecture/run-lifecycle.md](architecture/run-lifecycle.md) and its per-phase design docs (all reviewed; phase 7 with a noted gap) |
| Step lifecycle | FR-STP-001–031 | [specs/engine-internals.md](specs/engine-internals.md) |
| CLI | FR-CLI-001–042 | [specs/cli.md](specs/cli.md), [specs/ci.md](specs/ci.md) (unattended operation) |
| Non-functional | NFR-001–060 | Cross-cutting: [architecture/run-lifecycle.md](architecture/run-lifecycle.md) (failure model), [specs/secrets.md](specs/secrets.md) (redaction), [README.md](README.md) (format conventions), [specs/design-decisions.md](specs/design-decisions.md); [specs/results.md](specs/results.md) + [specs/ci.md](specs/ci.md) (NFR-043), [architecture/phase-1-invocation.md](architecture/phase-1-invocation.md) + [architecture/phase-2-load-validation.md](architecture/phase-2-load-validation.md) (NFR-060) |
| Open items | OI-1–18 | [specs/design-decisions.md](specs/design-decisions.md) (🔭 items), [specs/known-chains.md](specs/known-chains.md), [specs/multisig.md](specs/multisig.md), [architecture/run-lifecycle.md](architecture/run-lifecycle.md) (open questions), [implementation/stack.md](implementation/stack.md) (§9), [TODO.md](TODO.md) |
