# Actions

The catalog of indivisible deployment units. An action is a contract deployment or a script invocation — scripts cover complex deployments, pre-deployment preparation, and post-deployment work. Each action declares its inputs and outputs; workflows ([workflows.md](workflows.md)) compose actions into ordered launches.

> **Naming.** *Action* is the v2 name for what v1 called an *atomic target*. The full v1 → v2 terminology map lives in [naming.md](naming.md). The rename of code, workspace configs, and cursor rules lands as a single coordinated sweep (see [design-decisions.md → Format migration](design-decisions.md#format-migration)).

## Purpose

The engine needs a per-step recipe with five things:

1. **Where to get the source code** — the git repository (URI) the action is built from.
2. **Which point in source history** — one or more code pins (`branch`, `tag`, or `commit`), each a **release** with its own id, grouped under a **generation** (the interface-stable family). The plan selects which release to run, defaulting to the one flagged `latest`.
3. **How to prepare/build the source code** — the framework (`foundry`, `hardhat`, `custom`, `none`) and package manager, plus their install/build commands. The engine uses this to clone, install dependencies, and compile before invoking the action.
4. **What to invoke** — the action type to run. The `type` field names one of ten action types: contract deployment types (`forge-contract`, `hardhat2-contract`, `hardhat3-contract`), module deployments (`hardhat3-module`), make-driven recipes (`make`), script types (`forge-script`, `hardhat2-script`, `hardhat3-script`, `script`), or contract calls (`contract-call`).
5. **What it consumes / produces** — the input parameter names the action expects, and the output names it exposes downstream. A few behavior flags (`deploys`, `idempotent`, `verify`) tune how the engine treats the step — see [The `deploys` flag](#the-deploys-flag) and [Idempotency and re-runs](#idempotency-and-re-runs).

Actions are this recipe. They are intentionally **declarative and stateless** — no chain context, no preset values, no env vars. Concrete values are supplied at execution time by the plan (chain constants, secrets) and by upstream steps (mappings).

The structure groups these concerns into four nested levels:


| Level                         | Owns                                                                                                                                                                         | Why it lives here                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Repo** (`RepoConfig`)       | Item 1: source URI; default framework/package-manager configuration                                                                                                          | A repo is one git remote. Its identity is its URI.                                                                                     |
| **Generation** (`Generation`) | Item 2 (the *interface*): optional per-generation overrides of framework/install commands; the set of release pins; the catalog of actions that exist in this codebase       | A generation is one stable interface (which actions exist and what they expect). Anything coupled to the codebase shape belongs here.  |
| **Release** (`Release`)       | Item 2 (the *pin*): one git ref (`branch`, `tag`, or `commit`; omit for remote default — see [Generations](#generations--the-stable-interface)), optionally flagged `latest` | A release pins the codebase to one immutable point. A generation's releases are interchangeable implementations of the same interface. |
| **Action** (`Action`)         | Items 4 and 5: the per-step recipe — action type, inputs, outputs, and behavior flags (`deploys`, `idempotent`, `verify`)                                                    | An action is one deployable thing built from one fixed codebase.                                                                       |


On disk, this is a four-level YAML nesting. The top level is a mapping: one reserved `version` key, then each remaining key is a **repo id** with a `RepoConfig` value.

```yaml
version: 2                      # config format version — engine errors on mismatch (override with --ignore-version)

<repoId>:                       # e.g. "cross-chain-resolver"
  framework: ...
  repository:
    uri: ...
  generations:
    <generationId>:             # e.g. "v1" — the stable interface
      releases:
        <releaseId>:            # e.g. "v1.0.0" — one immutable code pin
          tag: ...              # one of branch | tag | commit (omit for remote default — warns)
          latest: true          # optional — the default pin when the plan selects none
      actions:
        <actionId>:             # e.g. "crosschain-resolver"
          type: forge-contract | hardhat2-contract | hardhat3-contract | hardhat3-module | make | forge-script | hardhat2-script | hardhat3-script | script | contract-call
          deploys: true | false # behavior flag — see "The deploys flag"
          ...
```

The reserved top-level `version` key declares which **config format version** the file is written against (current: `2`). At load time the engine compares it to the format version it supports. A **mismatch is a load-time error** that aborts the run, naming both versions — unless the run passes the `--ignore-version` CLI flag, which downgrades it to a **warning** and lets loading proceed. A **missing** `version` is always a warning (the engine can't know it mismatches), recommending the key be added. The error exists to stop a run before it deploys against a file the engine may misinterpret; `--ignore-version` ([cli.md → Common flags](cli.md#common-flags)) is the deliberate escape hatch for an old file you've confirmed still validates against a newer engine (or vice versa). See [engine-internals.md → Config version check](engine-internals.md#config-version-check).

The fully-qualified action id used everywhere else (workflow step references, log lines, results recordings) is `<repoId>.<generationId>.<actionId>` — the **release pin is not part of it**; the plan selects which pin to run (see [plans.md → Release selection](plans.md#release-selection)). An action may also declare a short `alias` for terser workflow references (see [Common fields](#common-fields--every-action)).

The field-by-field reference for every level lives in [Field reference](#field-reference); a full worked example in [examples/actions.yml](examples/actions.yml).

## Repos — one remote, shared build defaults

A repo is the unit of "this is where the source code lives." Concretely, a repo declares:

- The git URI (`repository.uri`) — one remote shared by every generation under this entry.
- Default **build toolchain** settings: `framework`, `frameworkInstall`, `packageManager`, and `packageManagerInstall`. These drive how the engine clones the repo, installs dependencies, and compiles before any action runs (Purpose item 3).

The top-level YAML key is the **repo id** (`repoId`). It is a stable identifier — workflows, results, and workspace paths all use it as the first segment of the fully-qualified action id (`<repoId>.<generationId>.<actionId>`).

A single repo typically has **multiple generations** — different interface eras over the **same URI**, each holding its own set of release pins. Repo-level settings are the shared baseline; a generation overrides them only when that codebase era needs a different framework or install command (see [Generations — the stable interface](#generations--the-stable-interface)).

Adding a new repo is a separate concern from adding a new generation. You create a repo entry when you onboard a new git remote; you add generations under an existing repo when the interface changes, and release pins under a generation when its code moves but the interface stays the same.

### Private repos and authentication

A private repo needs a credential to clone and fetch. Like every credential in v2, it never appears in committed YAML — the repo entry carries only a **pointer**, in the optional `repository.auth` field. This field is the one direct vault consumer in actions.yaml; for how it fits the wider credential model, see [secrets.md → Repository authentication](secrets.md#repository-authentication-git-tokens).

```yaml
my-private-repo:
  framework: foundry
  repository:
    uri: "https://github.com/my-org/private-contracts.git"
    auth: "${vault.gitHubToken}"    # pointer only — never a literal token
  generations: ...
```

The rules:

- The value is exactly one `${vault.X}` ref (preferred for its rotation/audit indirection) or one `${env.X}` ref (allowed). Both get engine-side [secret tagging](engine-internals.md#vault-resolution-and-secret-tagging) — env-only injection and log redaction. Literal tokens and inline mixing are rejected.
- **Each repo picks its own credential.** Different repos can point at different vault entries (different tokens, different access scopes); repos sharing one read token simply reference the same entry. This is how access to individual repos is managed.
- **Omitted means ambient credentials.** Public repos need nothing; developers with an SSH agent or a git credential helper keep working with zero config.
- **Never put the token in the URI.** A token embedded in `repository.uri` would persist in the checkout's `.git/config`, show up in `git remote -v`, and leak in logs. The `auth` field exists so the engine can inject the credential ephemerally — see [engine-internals.md → Repository authentication](engine-internals.md#repository-authentication) for the mechanics and the GitHub Actions setup.

Prefer **HTTPS URIs** as the canonical form: tokens work over HTTPS in every environment (laptop, CI, container). Developers who prefer SSH locally can keep it without touching deploy-pad config via a global git rewrite (`git config --global url."git@github.com:".insteadOf "https://github.com/"`), so the committed config stays environment-neutral.

## Generations — the stable interface

A generation sits under a repo and is the unit of "this is one stable interface built from this codebase." Concretely, a generation owns:

- **The catalog of actions** that exist in this codebase era — which actions exist and what inputs/outputs they expect.
- **A set of release pins** (`releases`) — the interchangeable code points this interface is deployed from (see [Release pins](#release-pins) below).
- Optionally, **framework and package-manager settings** overridden from the repo defaults (e.g. an older generation that needs Hardhat 2 while the new one uses Hardhat 3).

**Actions live under a generation, not under the repo, because actions are coupled to the codebase interface.** A `forge-contract` action named `escrow-factory` references a specific contract (`contracts/EscrowFactory.sol:EscrowFactory`) with a specific constructor signature. If the *interface* changes — a constructor argument is added, the file moves, the contract is renamed, a make recipe is rewritten — the action definition has to change too, so it belongs to a new generation.

The structural rule that follows:

> **A generation owns its actions. When the interface changes, you create a new generation — copy the previous generation's `actions` block as a starting point and edit it to match the new codebase. The two generations' action definitions are independent thereafter.**

This is deliberate. Sharing action definitions across generations would mean a single edit silently changes the meaning of a past interface — the exact mutability problem the generation concept exists to avoid. Editing a generation's actions only affects deployments using *that* generation; older generations keep working against their interface indefinitely.

Generations of the same repo are independent in every operational sense:

- **Workspace**: each release pin is checked out into its own directory (e.g. `workspace/repos/<repoId>/<generationId>/<releaseId>/`). No `git checkout` mutation in place.
- **Build state**: each checkout has its own `node_modules`, `out/`, `cache/`. Switching workflows between generations is free.
- **Identity**: every result references the generation in its step's fully-qualified action id (`<repoId>.<generationId>.<actionId>`) plus the resolved release pin, so "what code produced this address" is recoverable from the result alone.

A workflow can freely compose steps from **different generations of the same repo** — e.g. deploy a v1 contract and a v2 contract side by side, then a third step that consumes both addresses (see [workflows.md](workflows.md)).

### Release pins

A **release** is one immutable code pin under a generation, with its own id (the key under `releases:`). All releases of a generation share the same action interface — they are interchangeable implementations, differing only in which commit they build from. Bumping the code without an interface change means **adding a release pin**, not editing a workflow: the fully-qualified action id (which carries only the generation) is unchanged, and the plan selects which pin to run.

Each release fixes one code point:

- At most one of `branch`, `tag`, or `commit`. **Omit all three** for dev convenience: the engine resolves the remote's **default branch**, checks it out, pulls latest, and **warns** that the pin is not reproducible (see [engine-internals.md → Release pin checkout](engine-internals.md#release-pin-checkout)). For production, use `tag` or `commit`.
- An optional `latest: true` flag marking the **default pin** — the one the plan uses for this generation when it selects none. At most one release per generation may set it.

How a plan picks a pin (and what happens when a generation has several pins but the plan names none) lives in [plans.md → Release selection](plans.md#release-selection).

> **Author responsibility (not enforced).** Every release pin of a generation must build the same action interface — same `contract` paths, same `inputs`/`outputs` shapes. The engine does not currently verify this; selecting a pin whose code doesn't match the action definition is an authoring error.

## Actions — per-step recipes

An action sits under a generation and is the unit of "this is one thing the engine can run from this codebase." Concretely, an action declares:

- **`type`** — which tool or recipe to invoke (Foundry deploy, Hardhat script, `make` target, etc.).
- **`inputs` / `outputs`** — the parameter names the action expects and the names it exposes downstream.

A few behavior flags tune how the engine treats the step — `deploys` (private key, artifacts, verification surface — see [The `deploys` flag](#the-deploys-flag)), `idempotent` (rerun behavior — see [Idempotency and re-runs](#idempotency-and-re-runs)).

The key under `actions:` is the **action id** (`actionId`). Workflows, logs, and results reference actions by fully-qualified id (`<repoId>.<generationId>.<actionId>`); an action may also declare a short `alias` used in a workflow step's `action` field in place of the full FQ id (see [Common fields](#common-fields--every-action)). Actions are **declarative and stateless** — no chain context, no preset values, no env vars. Concrete values are supplied at execution time by the plan and by upstream step mappings.

Lifecycle and implementation details live in [engine-internals.md → How the engine processes an action](engine-internals.md#how-the-engine-processes-an-action). The full field-by-field tables (common fields, deployment fields, type-specific fields) live in [Field reference](#field-reference).

The subsections below split **[Action types](#action-types)** (which `type` to pick and type-specific behavior) from the **[Common author surface](#common-author-surface)** (behavior flags and shared input/output fields).

### Action types

#### Action types at a glance

There are ten action types, grouped into six families:


| `type`              | What the engine runs                                  | Typical use                                  |
| ------------------- | ----------------------------------------------------- | -------------------------------------------- |
| `forge-contract`    | Bundled Foundry deploy script for one contract        | Native Foundry deployment                    |
| `hardhat2-contract` | Bundled Hardhat 2 deploy script for one contract      | Native Hardhat 2 deployment                  |
| `hardhat3-contract` | Engine-generated Ignition module for one contract     | Native Hardhat 3 deployment                  |
| `hardhat3-module`   | Bundled wrapper deploying an authored Ignition module | Multi-contract Hardhat 3 (Ignition) systems  |
| `forge-script`      | `forge script <ref>`                                  | Complex Foundry flows, post-deploy txs       |
| `hardhat2-script`   | `npx hardhat run <script>` (Hardhat 2)                | Hardhat 2 tasks / wrappers                   |
| `hardhat3-script`   | `npx hardhat run <script>` (Hardhat 3)                | Hardhat 3 tasks / wrappers                   |
| `make`              | `make <target>`                                       | Repo-defined deploy or action recipes        |
| `script`            | `<runtime> <script>`                                  | Generic bash/node/ts scripts                 |
| `contract-call`     | Engine-native call (in-process, via ethers)           | `cast call` / `cast send` style method calls |


What each family does:

- **Contract deployments (`forge-contract`, `hardhat2-contract`, `hardhat3-contract`)** — the engine deploys a single named contract using engine-owned machinery: bundled deploy scripts for Foundry and Hardhat 2, an engine-generated Ignition module for Hardhat 3. Constructor argument order matches `inputs` order. Deployment strategy (`create` / `create2` / `create3`) comes from the **workflow step's `method`** (overridable only by a workflow [method variant](workflows.md#method-variants--variantof), never by the plan), not from the action — see [Deployment strategy](#deployment-strategy) (on Hardhat 3 it maps to Ignition strategies; `create3` is not supported there). The engine-owned machinery fulfills the [deployment interface](engine-internals.md#the-deployment-interface) internally — authors configure nothing.
- **Module deployments (`hardhat3-module`)** — deploy an **authored Hardhat Ignition module** (a whole system of contracts in one declarative unit). The engine's bundled wrapper runs the module via `hre.ignition.deploy`, passing `inputs` **by name** as module parameters and exposing the module's returned contracts as outputs. See [`hardhat3-module`](#action-type-hardhat3-module).
- **Framework scripts (`forge-script`, `hardhat2-script`, `hardhat3-script`)** — invoke a Foundry script (`forge script`) or a Hardhat wrapper (`npx hardhat run`). The two Hardhat types share the same author surface — the type tells the engine which Hardhat major version toolchain to prepare and invoke. Use for multi-step Foundry flows, post-deploy transactions, or Hardhat tasks wrapped in a script file. Outputs always come from `.env.outputs`; when `deploys: true`, the script must fulfill the [deployment interface](engine-internals.md#the-deployment-interface).
- **Make recipes (`make`)** — delegate to a repo Makefile target. Common for repos that already encode deploy and verify steps as `make` recipes. Same single-command shape as script types (`command`).
- **Generic scripts (`script`)** — run a user-supplied script via a configured `runtime` (`bash`, `node`, `tsx`, `ts-node`). The engine has no framework knowledge — the script communicates with the engine purely through the [deployment interface](engine-internals.md#the-deployment-interface).
- **Contract calls (`contract-call`)** — call a method on an **already-deployed** contract: a read (`cast call` style, no transaction) or a write (`cast send` style, real transaction). The engine performs the call itself, in-process — no framework, no external tool, nothing needed from the codebase. The target address comes from the type's built-in parameter `builtin.CALL_ADDRESS`; `inputs` are the ordered call arguments; never a deployment (`deploys` fixed `false`, nothing verified); read return values map positionally to declared outputs; write calls produce no output.

Per-type behavior follows below; the field tables live in [Field reference → Type-specific fields](#type-specific-fields). Where a blurb says `deploys: true`, that's the per-action behavior flag covered in [The `deploys` flag](#the-deploys-flag) — it adds the private-key, artifacts, and verification surface on top of whatever the type invokes.

#### Deployment strategy

The contract action types (`forge-contract`, `hardhat2-contract`, `hardhat3-contract`) and the module type (`hardhat3-module`) deploy with a **method** (`create` / `create2` / `create3`) and, depending on the method, some data (a CREATE3 factory address, a salt). None of this is declared on the action — actions are method-agnostic:

- The **method** is the workflow step's `method`, overridable only by a workflow [method variant](workflows.md#method-variants--variantof) (globally or per chain) — never by the plan. On the Hardhat 3 types it selects an Ignition strategy and `create3` is rejected. A `create3` step additionally picks its factory implementation via the step's `factory` flavor (`oneInch` / `createx` / `solady`, default `oneInch`) — also structural, also variant-overridable, never plan-set. See [workflows.md → CREATE3 factory flavors](workflows.md#create3-factory-flavors--factory).
- The **salts and factories** live in the plan `deploy` block, keyed per step id (`deploy.salts.<stepId>` / `deploy.factories.<stepId>`). A `create3` step with the `oneInch` or `solady` flavor needs a factory entry (`createx` uses the canonical singleton and needs none); a `create2`/`create3` step uses its explicit salt (`0x` = bytes verbatim, any other string = `keccak256(string)`), falling back to a derived `saltBase` (with a validation warning) when no explicit salt is set.

See [workflows.md → Per-step `method`](workflows.md#per-step-method) and [plans.md → Deploy parameters](plans.md#deploy-parameters-deploy-block).

#### Built-in parameters

Some engine-native types have parameters that belong to the **type itself**, not to the authored action — **built-in parameters**. Each type declares its set in engine code (name, required/optional, optional default); the engine merges them into the step's effective input set, where they resolve through the same pipeline as declared inputs (workflow `mappings`, plan `constants`). Built-in keys use a dedicated grammar — `builtin.<NAME>` (e.g. `builtin.CALL_ADDRESS`) — whose dot keeps them structurally disjoint from author-declared names.

Today, `contract-call` is the only type that declares one: `builtin.CALL_ADDRESS`, the address of the contract the step calls (required). It is never declared in `inputs`; the typical pattern is a per-step output reference mapping from the step that deployed the contract (`mappings: { builtin.CALL_ADDRESS: <stepId.OUTPUT> }`). See [`contract-call`](#action-type-contract-call). Future engine-native types (e.g. a specialized ownership-transfer command) declare their own built-ins the same way — no new reserved names, no engine-core changes to the parameter surface.

See [references.md → built-in command parameters](references.md#built-in-command-parameters-builtin-names) for the full table, key grammar, and resolution ladder.

#### Action type: `forge-contract`

A native Foundry contract deployment. The engine ships bundled deploy scripts and invokes one of them via `forge script` based on the resolved deployment method (the step's `method`; see [Deployment strategy](#deployment-strategy)). **`deploys: true` is fixed** — the schema rejects the field if set.

The order of `inputs` is preserved and treated as constructor argument order (the engine ABI-encodes them via the bundled script).

Field reference: [Field reference → `forge-contract` fields](#forge-contract-fields).

#### Action type: `hardhat2-contract`

A native Hardhat 2 contract deployment. The engine ships bundled deploy scripts and invokes one of them via `npx hardhat run` based on the resolved deployment method (the step's `method`; see [Deployment strategy](#deployment-strategy)). **`deploys: true` is fixed** — the schema rejects the field if set.

The order of `inputs` is preserved and treated as constructor argument order.

Field reference: [Field reference → `hardhat2-contract` fields](#hardhat2-contract-fields).

#### Action type: `hardhat3-contract`

A native Hardhat 3 contract deployment. Hardhat 3 deploys through **Ignition** (declarative deployment modules), so the engine generates a minimal Ignition module for the one named contract and deploys it via its bundled wrapper — the author surface stays identical to the other contract types: name the `contract`, list the `inputs` in constructor-argument order. **`deploys: true` is fixed** — the schema rejects the field if set.

The resolved deployment method maps to Ignition's deployment strategies: `create` runs the basic strategy, `create2` runs Ignition's create2 strategy (consuming the resolved salt). **`create3` is not supported by Ignition** — a method resolving to `create3` on a Hardhat 3 step fails validation before anything runs, with an error naming the step and chain (see [workflows.md → Validation rules](workflows.md#validation-rules--common-errors)).

The bundled wrapper fulfills the [deployment interface](engine-internals.md#the-deployment-interface) internally — it writes the deployed address to `.env.outputs`, drops the contract's ABI into `SYS_ARTIFACTS_DIR`, and verifies inline when `SYS_VERIFY=1`.

Field reference: [Field reference → `hardhat3-contract` fields](#hardhat3-contract-fields).

#### Action type: `hardhat3-module`

Deploys an **authored Hardhat Ignition module** — the natural unit for a system of contracts on Hardhat 3 (a module declares several contracts and their relationships; Ignition plans and executes the whole graph). The action names the module file in the `module` field (e.g. `ignition/modules/Apollo.ts`); the engine's bundled wrapper loads it and calls `hre.ignition.deploy(module, ...)` in-process of the Hardhat run. No Ignition journal parsing — results come from the deploy call's return value. **`deploys: true` is fixed** — the schema rejects the field if set.

Two semantics differ from the contract types:

- **`inputs` are passed by name, not position.** Ignition modules take named parameters (`m.getParameter("owner")`), so each declared input becomes a module parameter with the same name. Order does not matter.
- **Outputs come from the module's returned contracts.** An Ignition module returns its contract futures (`return { apollo, router }`); the bundled wrapper writes one `.env.outputs` entry per returned contract, named by the return-object key. Declared output names must equal those return-object keys.

The same deployment-method → Ignition strategy mapping as [`hardhat3-contract`](#action-type-hardhat3-contract) applies (`create` → basic, `create2` → create2 + resolved salt, `create3` rejected). The bundled wrapper fulfills the [deployment interface](engine-internals.md#the-deployment-interface) — addresses to `.env.outputs`, ABIs of returned contracts to `SYS_ARTIFACTS_DIR`, inline verification when `SYS_VERIFY=1`.

Field reference: [Field reference → `hardhat3-module` fields](#hardhat3-module-fields).

#### Action type: `make`

An action that delegates execution to a `make <command>` invocation in the repo. Used both for deployment recipes and for non-deploying recipes (e.g. a make target that performs a post-deploy ownership transfer).

`deploys` is required-explicit on every `make` action. When `true`, the recipe must fulfill the [deployment interface](engine-internals.md#the-deployment-interface): the target writes `.env.outputs`, drops artifacts into `SYS_ARTIFACTS_DIR`, and respects `SYS_VERIFY` (typically by invoking the repo's verification target from within the recipe). If an existing recipe can't be modified to write `.env.outputs`, add a thin wrapper target that runs it and then collects. When `false`, the make action is non-deploying — `verify` is rejected; `requiresPrivateKey` is allowed for opting in to PK.

Field reference: [Field reference → `make` fields](#make-fields).

#### Action type: `forge-script`

A Foundry script invocation (`forge script`). Useful for both deployment-style scripts (e.g. complex setup math followed by a deployment) and non-deploying scripts (e.g. post-deploy state changes).

`deploys` is required-explicit. When `true`, the script must fulfill the [deployment interface](engine-internals.md#the-deployment-interface): write the deployed addresses to `.env.outputs` (the values are in hand at deployment time), drop artifacts into `SYS_ARTIFACTS_DIR`, and pass `--verify` when `SYS_VERIFY=1`. When `false`, the script is non-deploying — outputs (if any) are still read from `.env.outputs`.

Field reference: [Field reference → `forge-script` fields](#forge-script-fields).

#### Action type: `hardhat2-script`

A Hardhat 2 invocation. Use a thin wrapper script that calls the desired Hardhat task or runs arbitrary code (`npx hardhat run scripts/<wrapper>.ts`); name the wrapper in `command`. The wrapper uses Hardhat 2's global `hre` with the engine-configured network.

`deploys` is required-explicit. When `true`, the wrapper must fulfill the [deployment interface](engine-internals.md#the-deployment-interface): write the deployed addresses to `.env.outputs`, drop artifacts into `SYS_ARTIFACTS_DIR`, and call `hardhat verify` (or equivalent) when `SYS_VERIFY=1`.

Field reference: [Field reference → `hardhat2-script` fields](#hardhat2-script-fields).

#### Action type: `hardhat3-script`

The Hardhat 3 counterpart of [`hardhat2-script`](#action-type-hardhat2-script) — same author surface (`command` names the wrapper, `deploys` required-explicit, same deployment-interface obligations when `deploys: true`). The type tells the engine to prepare and invoke the Hardhat 3 toolchain; inside the wrapper, network access follows Hardhat 3's connection API (`network.connect()`) instead of Hardhat 2's preconfigured global `hre`.

Field reference: [Field reference → `hardhat3-script` fields](#hardhat3-script-fields).

#### Action type: `script`

A generic user-supplied script invocation. The engine has no framework knowledge for this type — it just runs the script via the configured `runtime`. Use for pre-deploy bootstrapping, post-deploy state changes, or deployments that don't fit the framework-aware types (`forge-contract`, `hardhat2-contract`, `hardhat3-contract`, `hardhat3-module`, `forge-script`, `hardhat2-script`, `hardhat3-script`).

**`deploys` defaults to `false`** (non-deploying); set `true` if the script ultimately deploys contracts.

When `deploys: true`, the script must fulfill the [deployment interface](engine-internals.md#the-deployment-interface) — write `.env.outputs`, drop artifacts into `SYS_ARTIFACTS_DIR`, verify inline when `SYS_VERIFY=1`. Since the engine has no framework knowledge for this type, the interface is the entire contract (see the bash example there).

Field reference: [Field reference → `script` fields](#script-fields), including the `runtime` details table.

#### Action type: `contract-call`

A contract method call — the equivalent of Foundry's `cast call` (read) / `cast send` (write), performed by the engine itself. **No framework, no external tool, no subprocess**: the engine parses the cast-style `signature`, encodes the arguments, and issues the call directly over the chain's RPC URL (via its built-in ethers client). Nothing is needed from the repo's codebase or toolchain — a call works the same whether the contract was built with Foundry, Hardhat, or by another team entirely.

**`deploys: false` is fixed** — the schema rejects the field if set. Nothing is deployed or verified, so the `verify` field is rejected too.

- **`signature`** is cast-style. For reads, include the return types (e.g. `balanceOf(address)(uint256)`, `getReserves()(uint112,uint112,uint32)`) — they drive decoding of the result.
- **`mode`** selects how the call is issued — same vocabulary as `cast`: `call` (default) is a static `eth_call` (no transaction, no private key); `send` signs and publishes a state-changing transaction. On `send` actions the engine injects `${secret.privateKey}` automatically — `requiresPrivateKey` is rejected on this type because `mode` already carries that information. The per-step `mappings.privateKey: <slot>` rename works as usual. Because the call happens in-process, the key never leaves the engine — no env handoff, no writer files, no subprocess.
- **`inputs` are the ordered call arguments** — same order semantics as constructor args on contract types.
- **The target address is not an input.** It comes from the type's built-in parameter `builtin.CALL_ADDRESS` ([Built-in parameters](#built-in-parameters)) — set it in plan constants (under the literal key `builtin.CALL_ADDRESS`), or (the typical pattern) wire it per step from a prior deployment's output: `mappings: { builtin.CALL_ADDRESS: escrow-factory.ESCROW_FACTORY_ADDRESS }`.
- **Outputs.** `mode: call` maps the function's return value(s) to declared outputs **positionally** (return value *i* → declared output *i*). `mode: send` **must declare `outputs: []`** — a mined transaction only yields a receipt (status, gas used, logs, tx hash), never the Solidity function's return value, so there is nothing to expose. This is an EVM constraint, not a deploy-pad choice: the engine awaits the receipt (steps stay ordered, reverts fail the step) and logs the tx hash, but even waiting indefinitely cannot recover a value a mined transaction never carries. To surface a result from a send, emit an event or add a follow-up `mode: call` step against a view function.

Field reference: [Field reference → `contract-call` fields](#contract-call-fields).

### Common author surface

Behavior flags and shared fields that apply regardless of `type`. Type-specific blurbs above link here where relevant.

#### The `deploys` flag

`deploys` is a behavior flag: it does not change what the engine invokes (that's the `type`), it changes how the engine treats the step around the invocation. Setting `deploys: true` changes exactly three things:

1. **Private key** — always injected. Non-deploying steps get a key only when they opt in with `requiresPrivateKey: true` (the field is rejected on deploying actions — the key is implicit there).
2. **Artifacts** — the engine creates an empty per-step artifacts directory, passes it as `SYS_ARTIFACTS_DIR`, and persists its contents into the results tree after the step succeeds. Non-deploying steps have no artifacts surface.
3. **Verification** — the `verify` field becomes available, and when its gates pass the engine passes `SYS_VERIFY=1` / `SEC_VERIFICATION_API_KEY` so the command verifies inline. Non-deploying steps are never verified (`verify` is rejected).

Everything else is identical — in particular, outputs come from `.env.outputs` on both sides of the flag (except `contract-call`, where the engine records results in-process). These three obligations together are the **deployment interface**; the full contract — the environment variable tables and a minimal complying script example — lives in [engine-internals.md → The deployment interface](engine-internals.md#the-deployment-interface).

The flag exists per action (not per type) because the same action type can deploy or not — e.g. a `forge-script` might run complex setup math and deploy a contract, or just transfer ownership post-deploy. For the types whose role is unambiguous, the schema fixes the value:


| Type                                                                          | `deploys` behavior                                    |
| ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| `forge-contract`, `hardhat2-contract`, `hardhat3-contract`, `hardhat3-module` | Always deploying (field omitted; rejected if set)     |
| `make`, `forge-script`, `hardhat2-script`, `hardhat3-script`                  | **Required** — author must set `true` or `false`      |
| `script`                                                                      | Defaults to `false`                                   |
| `contract-call`                                                               | Always non-deploying (field omitted; rejected if set) |


One exception to the private-key rule: on `contract-call`, the key is driven by the type-specific `mode` field instead — injected when `mode: send`, never for `mode: call` (the default). `requiresPrivateKey` is rejected on that type (see [`contract-call`](#action-type-contract-call)).

Real secret values are **never written in action configs** — not in `inputs`, not as literal values, not as `${env.X}` in action bodies. Keys come from the plan's `secrets:` block at execution time; the full secrets-management story lives in [secrets.md](secrets.md).

#### Idempotency and re-runs

When a long workflow fails partway through and is rerun, some steps are safe to re-execute and others are not. The `idempotent` common field controls per-action rerun behavior.

**Default by `type`:**


| `type`                                                                        | Default `idempotent` | Rationale                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `forge-contract`, `hardhat2-contract`, `hardhat3-contract`, `hardhat3-module` | `true`               | The engine-owned deploy machinery is deterministic — the same inputs produce the same address (CREATE2) or the same on-chain effect (CREATE). On the Hardhat 3 types, Ignition's journal additionally reconciles partial re-runs. Replaying a successful step from records is preferred to re-broadcasting. |
| `make`, `forge-script`, `hardhat2-script`, `hardhat3-script`, `script`        | `false`              | Author-written commands are arbitrary. Re-execution may double-spend, change state, or emit extra events. Idempotency is opt-in.                                                                                                                                                                                                           |
| `contract-call`                                                               | `false`              | `mode: call` steps should re-execute to reflect current chain state (replaying a recorded value would silently go stale). `mode: send` steps are arbitrary state changes — opt in with `idempotent: true` only when skipping a previously-succeeded send is genuinely safe.                                                                |


**Authoring notes:**

- Setting `idempotent: false` on a contract action opts back into "always execute," useful when a redeploy is intended (paired with a fresh salt or a fresh deployment — see [plans.md → Deployment id & re-runs](plans.md#deployment-id--re-runs)).
- Setting `idempotent: true` on a script-class action is a contract by the author: the script is genuinely safe to skip when prior outputs exist. The engine does not validate this.

Lookup mechanics (scoping to `deployment_id` + chain, where the index lives, how outputs are replayed) are in [engine-internals.md → idempotency lookup](engine-internals.md#idempotency-lookup).

#### Input shape: arity and encoding transforms

By default an `inputs` entry is a plain string — the parameter name. An entry can also be an **object** to declare extra properties of the parameter:

```yaml
inputs:
  - LOP_ADDRESS                          # plain: a scalar input, no coercion
  - { name: POOL_SALT, transform: salt } # encoding: value coerced to bytes32
  - { name: ORACLES, array: true }       # arity: an array-valued input
```

These properties sit on **two different axes** of how a value is shaped — and only the action-side pieces live here. (For the rationale behind this split, see [design-decisions.md → Value transforms](design-decisions.md#value-transforms).)

- **`array`** (arity) — declares the parameter is a **list** rather than a single value: the *destination shape* the contract/command expects (e.g. a Solidity `address[]`). The action declares only the arity; **how** the list is assembled from multiple sources is a workflow concern (see [workflows.md → Mappings](workflows.md#mappings--the-wiring-layer)).
- **`transform`** (encoding) — declares the **authoritative coercion** the input's value passes through before it reaches the command: the input's *format contract*. "Whatever value lands here, the engine applies this transform to produce what the contract expects."

**Encoding transforms** (the `transform` field) are a bounded set, all `1 → 1` value coercions:


| Transform   | Input → output     | Behavior                                                                                                                                                          |
| ----------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `salt`      | string → `bytes32` | A value of `0x` followed by exactly 64 hex chars is used **verbatim**; any other string is `keccak256(string)`. A malformed `0x` value (wrong length / non-hex) is an error. |
| `keccak256` | string → `bytes32` | `keccak256` of the value, always.                                                                                                                                |


`transform` may be a single name or a **chain** (`transform: [keccak256]`), applied left to right.

Two rules keep `transform` on the action unambiguous:

- **It is authoritative and not overridable.** A workflow may *add* transforms to adapt an incoming value into the shape this input expects, but it cannot remove or replace the action's declared `transform` — the action's coercion is always applied **last**. See [workflows.md → Mappings](workflows.md#mappings--the-wiring-layer).
- **It is valid only on scalar inputs.** `transform` on an `array: true` input is rejected — there is no single value to coerce. Per-element encoding of an array is done in the workflow, per source.

**Structural transforms are never on the action.** Grouping multiple values into one parameter — building an array, or an `abiEncode` / `abiEncodePacked` / `abiEncodeWithSignature` blob — requires knowing the multiple *sources*, which only the workflow has. The same holds for the reverse direction: extracting one element out of an array-valued source (`pick` / index refs) is source knowledge too. The action declares only the *destination*: an `array: true` arity, or a scalar `bytes`/`bytes32` input. The workflow's `combine` (merge) and `pick` (split) produce the value. See [workflows.md → Mappings](workflows.md#mappings--the-wiring-layer).

> **`salt` transform vs. deploy salt.** The `salt` *encoding transform* here coerces an ordinary input value to `bytes32`. It is unrelated to the **deploy salt** (`deploy.salts.<stepId>` in the plan), which the engine uses to derive CREATE2/CREATE3 addresses and is never a declared input. The two are distinct concepts that share the same normalization rule (`0x`+64hex verbatim, else `keccak256(string)`). See [plans.md → Salt resolution and fallbacks](plans.md#salt-resolution-and-fallbacks).

#### Output shape: names and arity

An `outputs` entry mirrors the `inputs` shape: a plain string (the output name), or an **object** to declare an array-valued output:

```yaml
outputs:
  - ESCROW_FACTORY_ADDRESS                    # plain: a scalar output
  - { name: DEPLOYED_ORACLES, array: true }   # arity: an array-valued output
```

The declared name is the single name everywhere: the key the command writes in `.env.outputs`, and the name downstream workflow mappings reference (`<stepId>.<outputName>`). Output names are plain identifiers — no templates, no `${...}` references. (The v1 `expected`/`as` output mapping — templated reported keys decoupled from exposed names — is gone in v2; it existed to encode multiple values into dynamic names, which first-class array outputs replace.)

**How a command reports an array output.** `.env.outputs` stays a flat `KEY=value` file; an `array: true` output's value is a single **JSON-array string** — the exact mirror of how the engine serializes `array: true` *inputs* into `.env.automation`:

```bash
echo "ESCROW_FACTORY_ADDRESS=$ADDR" >> .env.outputs          # scalar
echo 'DEPLOYED_ORACLES=["0xabc...","0xdef..."]' >> .env.outputs  # array: JSON-array string
```

At collect time the engine parses an `array: true` output's value as a JSON array and holds it as a list; a malformed value fails the step (same spirit as a missing output). On `contract-call` reads, an array-typed return value (e.g. `address[]`) decodes in-process straight to a declared `array: true` output. On `hardhat3-module`, declared output names must equal the module's return-object keys.

Downstream, an array output feeds an `array: true` input whole, or a scalar input via an element **split** in the workflow mapping (`stepId.DEPLOYED_ORACLES[0]` / `pick`) — see [workflows.md → Splitting arrays](workflows.md#splitting-arrays-pick--index-access).

#### Inline `inputConstants`

Some inputs are conceptually constants of the action itself, not knobs the operator should be tuning per launch. Examples: a token symbol baked into a constructor, a feature flag that's permanent for the contract version, an internal address that should never be supplied by the plan. `inputConstants` lets the action carry the value inline.

**Shape:**

```yaml
inputs:
  - LOP_ADDRESS
  - TOKEN_SYMBOL
  - FEATURE_FLAG
inputConstants:
  TOKEN_SYMBOL: "DPADX"
  FEATURE_FLAG: "0"
```

**Rules:**

- Each key in `inputConstants` must also appear in `inputs`. Otherwise it's a validation error.
- Values are **literal strings only**. No `${global.X}` / `${system.X}` / `${env.X}` / etc. The point is that the value is a fixed property of the action — it does not vary by chain, by preset, or by env. Use a plain input plus a plan constant if you need a substitution.
- Values are treated as **hard constants**. The plan (any preset's `defaults.constants` or per-chain `constants`) and workflow `mappings` cannot override them. Attempting to define a same-named constant or remap the input is a validation/resolution error — the engine surfaces a clear "input X is fixed by inputConstants on action Y" message rather than silently letting either side win.
- `inputConstants` is part of the **common field surface** — it works on every `type` (contract types and script/make types alike).

**Why hard rather than overridable:** if a value is supposed to be tweakable per launch, it isn't a constant — it's a regular input fed from `constants`. The whole point of `inputConstants` is to remove that knob from the operator's surface, so making it silently overridable would defeat the abstraction.

Engine-side resolution details (where the substitution happens, where conflicts are detected) live in [engine-internals.md → inline `inputConstants` resolution](engine-internals.md#inline-inputconstants-resolution).

#### Artifacts and ABI capture

Deploying actions keep artifacts (ABI JSONs, deployment records) by dropping files into the engine-provided `SYS_ARTIFACTS_DIR` — see [The deployment interface](engine-internals.md#the-deployment-interface). After the step succeeds, the engine persists the directory contents to `workspace/results/<workflow>/<deployment_id>/<chain>/artifacts/<step_id>/`.

- For `forge-contract`, `hardhat2-contract`, `hardhat3-contract`, and `hardhat3-module`, the engine's bundled machinery drops the contract ABIs automatically (derived from Foundry `out/` / Hardhat `artifacts/`; for `hardhat3-module`, one ABI per returned contract).
- For `make`, `forge-script`, `hardhat2-script`, `hardhat3-script`, and `script` actions, the author's command copies whatever is worth keeping into `SYS_ARTIFACTS_DIR` (e.g. `cp out/MyContract.sol/MyContract.json "$SYS_ARTIFACTS_DIR/MyContract.abi.json"`). Nothing is captured for steps that don't write anything there.

#### Authoring custom enrichers / writers

Each action `type` selects a **minimal required set** of enrichers and writers — the smallest wiring that keeps the type's command class correct (see [engine-internals.md → Per-`type` × `deploys` wiring table](engine-internals.md#per-type--deploys-wiring-table)). Authors cannot remove, reorder, or replace these defaults from YAML.

The optional `enrichers` and `writers` fields on an action let you **append** extra components for that specific action — e.g. a `script` action that needs a derived salt or a second on-disk serialization format. Engine defaults for the `type` always run first, in their fixed order; author entries run after, in declaration order. Each name must be registered in engine code.

Typical use: a bespoke script-class action with custom pre-computation or file layout. Registration mechanics and component contracts: [engine-internals.md → Authoring enrichers and writers](engine-internals.md#authoring-enrichers-and-writers). The full step lifecycle (enrich → write → execute → collect → cleanup) lives in [engine-internals.md → How the engine processes an action](engine-internals.md#how-the-engine-processes-an-action).

## Relationships to other configs


| Other config                               | Relationship                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [workflows.md](workflows.md)               | Steps reference actions by FQ id (`<repoId>.<generationId>.<actionId>`) or by an action's `alias`. A single workflow can compose steps from different generations of the same repo. Per-step mappings can **rename** `privateKey` to a different secret slot.                                                                                                                                                                                                                                                                                                                                                                 |
| [plans.md](plans.md)                       | Concrete input values are supplied per chain via the plan's `constants` blocks (and per step via workflow `mappings`). Credentials come from the `secrets:` block, typically as `${vault.X}` refs. The action itself never names a chain or value.                                                                                                                                                                                                                                                                                                                                                                            |
| [global-params.md](global-params.md)       | The [vault registry](global-params.md#vault) is the canonical source of secret-pointer entries; deploying actions consume them indirectly via the plan's `secrets:` block, and private repos point at them directly via `repository.auth`. The end-to-end secrets story lives in [secrets.md](secrets.md).                                                                                                                                                                                                                                                                                   |
| [references.md](references.md)             | No `${...}` references are valid inside an action body — actions are pure declarations. The scoping matrix governs what's valid where.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [multisig.md](multisig.md)                 | Owns multisig mode end to end. On the action side: bundled contract/module types and `contract-call` need nothing; author-command deploying actions opt in with `supportsMultisig: true` and must honor the planning contract ([Deployment fields](#deployment-fields--when-deploys-true)).                                                                                                                                                                                                                                                                                                  |
| [engine-internals.md](engine-internals.md) | [How the engine processes an action](engine-internals.md#how-the-engine-processes-an-action) (lifecycle, enrichers, writers), [Release pin checkout](engine-internals.md#release-pin-checkout), [the deployment interface](engine-internals.md#the-deployment-interface) full contract, the per-`type` × `deploys` wiring table, [verification gating](engine-internals.md#verification), secret-tagging behavior for secret values, [repository authentication mechanics](engine-internals.md#repository-authentication) for `repository.auth`, and the rationale for not exposing those as authorable fields in v2. |


## Validation rules & common errors

Rules below are grouped by **where** in the file they apply and **when** the engine enforces them: schema validation at load time, step input resolution, or run/collect time. Most load-time checks are enforced by the schema and the config loader.

### File, repo, generation, and release

- **`version`** is the only top-level key that is not a repo id. A `version` that differs from the engine's supported format version is a load-time **error** (the run aborts) unless `--ignore-version` is passed, which downgrades it to a warning. A **missing** `version` is always a warning recommending the key be added — see [engine-internals.md → Config version check](engine-internals.md#config-version-check).
- Each **release** pin: **omitting all of** `branch`/`tag`/`commit` tracks the remote default branch (engine warns). At most one release per generation may set `latest: true` (loader-enforced, not the schema).

### Action — identity and shape

- **`alias`** (optional) — enforced by the loader (not the schema): it must be **unique across all actions** in `actions.yaml`. It is referenced only from a workflow step's `action` field; because `action` and `workflow` are separate step fields, an alias may freely share a name with a workflow id — there is no cross-file uniqueness rule between them.
- **Built-in parameter names (`builtin.<NAME>`) can never appear in `inputs`** — structurally: the input regex forbids dots, so the schema itself rejects them. No loader special case is needed. Built-ins are declared by the action type in engine code and supplied via plan constants and workflow mappings (see [Built-in parameters](#built-in-parameters)). The deployment-strategy names (`deployMethod`, `create2Salt`, `create3Factory`, `create3Salt`) are gone in v2 — method is the workflow step's `method` and the factory/salt live in the plan `deploy` block, so they are never `inputs` either.
- **The private key is never a declared input** — it is injected by the engine as a system-managed parameter: the plan's `secrets:` block supplies it, the engine resolves it via `${secret.privateKey}` and hands it to commands as `SEC_PRIVATE_KEY`. There is no special private-key input name and no name-based rejection: a name like `OPS_PRIVATE_KEY` (the v1 convention) matches the ordinary input regex and is treated as a regular, unrelated input — it never receives the signing key.

### Action — behavior flags

- **`idempotent`**: default by `type` (see [Idempotency and re-runs](#idempotency-and-re-runs)); explicit values override. The engine does not validate that `idempotent: true` is actually safe to skip on rerun — that is the author's responsibility.
- **`verify`** gating when `verify: true` (the schema enforces that it is only present on deploying actions): [engine-internals.md → Verification](engine-internals.md#verification).

### Action — inputs and outputs semantics

- **`inputs` entry shape** (schema + loader): each entry is a plain name or an object `{ name, transform?, array? }`. `transform` is one or a chain of the encoding transforms (`salt`, `keccak256`); `array` is a boolean.
- **`transform` on an `array: true` input** — rejected (loader). An encoding transform coerces a single value; per-element encoding of arrays lives in the workflow per-source. See [Input shape: arity and encoding transforms](#input-shape-arity-and-encoding-transforms).
- **Structural grouping is not an action concern** — `combine` (`array` / `abiEncode` / `abiEncodePacked` / `abiEncodeWithSignature`) lives only in workflow mappings ([workflows.md → Mappings](workflows.md#mappings--the-wiring-layer)). The action declares only the destination arity (`array: true`) or a scalar input.
- **`inputConstants`** (loader — the schema only checks key/value shape):
  - Every key must also appear in `inputs`.
  - Every value must be a literal string — `${...}` substitutions are rejected at validation time.
- **`inputConstants`** (step input resolution): the same key cannot be set in plan `constants` (any chain or preset) or routed via workflow `mappings` — both are errors.

### Action — enrichers and writers

- Every **`enrichers`** / **`writers`** entry must be the name of a component registered in engine code. Unknown names are a validation error.
- Each `type` defines a minimal required set that always runs first; author entries are **appended** in declaration order. Authors cannot remove, reorder, or replace the type defaults. Duplicate names are warnings.

### Run-time and cross-config rules

- **Every declared output must be produced** after the step finishes (checked at collect time). For command-driven types, each declared output name must appear as a key in `.env.outputs`; a missing output fails the step with an error naming the output and the step. An `array: true` output whose value is not a valid JSON array also fails the step. (`contract-call` performs the call in-process and records decoded return values directly — same must-produce rule, no file.)
- **A resolved deployment method of `create3`** on `hardhat3-contract` or `hardhat3-module` steps fails validation before anything runs (Ignition has no create3 strategy) — the error names the step and chain. See [workflows.md → Validation rules](workflows.md#validation-rules--common-errors).

### Common authoring mistakes

Beyond the rules above:

- Sharing an action definition across generations by accident — every generation owns its own `actions` map. To "reuse" an action under a new interface, copy it into the new generation. This is by design (see [Generations — the stable interface](#generations--the-stable-interface)).
- Adding a release pin whose code doesn't match the generation's action interface (e.g. a constructor argument differs). The engine does not verify this; an interface change requires a new generation, not a new pin.
- Embedding an access token in `repository.uri` (e.g. `https://x-access-token:ghp_...@github.com/...`). The token persists in the checkout's `.git/config`, appears in `git remote -v`, and can leak in error messages. Use `repository.auth` instead — the engine injects the credential ephemerally (see [Private repos and authentication](#private-repos-and-authentication)).
- Omitting all of `branch`/`tag`/`commit` on a release pin intended to be reproducible. Allowed for local dev / "track HEAD" workflows, but the engine warns — the same pin can resolve to different commits on every prepare. Prefer `tag` or `commit` for production.
- Using a mutable `branch` pin where a stable one is intended. Allowed but defeats pinning — prefer `tag` or `commit`.
- Forgetting to flag a `latest` pin in a generation with several releases, so a plan that selects none has no default to fall back to.
- Listing a constructor argument out of order for contract types (the engine ABI-encodes by `inputs` order — no validation catches this).
- Using `${global.X}` or `${env.X}` inside an action's `inputs` or `outputs`. References don't resolve here — actions are pure declarations. Wire concrete values via plan constants and step mappings.
- Forgetting to write `.env.outputs` from a deploying script. The engine does not read `broadcast/` or `deployments/` records — declared outputs must be reported explicitly through the [deployment interface](engine-internals.md#the-deployment-interface).
- Verifying unconditionally instead of checking `SYS_VERIFY`. A command that always verifies will fail on chains where verification is disabled (no API key) even though the engine asked it to skip.
- Expecting a plan-level "verify on" switch to override `verify: false` on an action. There is none — `verify` on the action is the only switch.

## Field reference

The field-by-field tables for every level of the file: repo, generation, and release plumbing first, then the per-action surface (common fields, deployment fields, type-specific fields). The conceptual narrative lives in the body sections above — [Repos](#repos--one-remote-shared-build-defaults), [Generations](#generations--the-stable-interface), [Actions — per-step recipes](#actions--per-step-recipes) ([Action types](#action-types), [Common author surface](#common-author-surface)).

### Top-level fields


| Field     | Type    | Required              | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------- | ------- | --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version` | integer | no (warns if missing) | —       | Config format version this file is written against (current: `2`). A value that differs from the engine's supported format version is a load-time **error** unless `--ignore-version` is passed (which downgrades it to a warning and proceeds). A **missing** `version` is always a warning recommending the key be added. See [engine-internals.md → Config version check](engine-internals.md#config-version-check). |


Every other top-level key is a repo id (matching `^[a-z][a-z0-9-]*$` — lowercase, hyphenated) mapping to a `RepoConfig`. Action ids under `actions:` follow the same pattern; generation and release ids are freer (see their notes below).

### `RepoConfig` fields


| Field                   | Type                    | Required | Default                 | Description                                                                                                                                                                                      |
| ----------------------- | ----------------------- | -------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `repository`            | `Repository`            | yes      | —                       | Git source. See below.                                                                                                                                                                           |
| `framework`             | enum                    | yes      | —                       | One of `foundry`, `hardhat`, `custom`, `none`. Drives how the engine sets up the repo and reads deployment artifacts. **Default for all generations** unless overridden at the generation level. |
| `frameworkInstall`      | string                  | no       | (per-framework default) | Override the framework install command (e.g. `forge install`). Default for all generations unless overridden.                                                                                    |
| `packageManager`        | enum                    | no       | —                       | One of `yarn`, `npm`, `pnpm`, `custom`, `none`. Default for all generations unless overridden.                                                                                                   |
| `packageManagerInstall` | string                  | no       | (per-pm default)        | Override the package-manager install command. Default for all generations unless overridden.                                                                                                     |
| `generations`           | map<string, Generation> | yes      | —                       | Generations of this repo (interface eras). Keys are generation ids. At least one generation is required.                                                                                         |


### `Repository` fields


| Field  | Type   | Required | Default               | Description                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ------ | -------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `uri`  | string | yes      | —                     | Git URI (HTTPS or SSH; HTTPS recommended). The same URI is used for every generation of the repo — generations and their release pins vary by ref, not by URI.                                                                                                                                                                                                                                         |
| `auth` | string | no       | (ambient credentials) | Credential pointer for private repos: exactly one `${vault.X}` (preferred) or `${env.X}` token. Never a literal credential. When omitted, the engine relies on ambient git credentials (SSH agent, credential helper). See [Private repos and authentication](#private-repos-and-authentication) and [engine-internals.md → Repository authentication](engine-internals.md#repository-authentication). |


### `Generation` fields


| Field                   | Type                 | Required | Default                   | Description                                                                                                                                                                                      |
| ----------------------- | -------------------- | -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `releases`              | map<string, Release> | yes      | —                         | The generation's code pins. Keys are release ids. At least one release is required; at most one may be flagged `latest`. See [Release fields](#release-fields).                                       |
| `framework`             | enum                 | no       | inherit from `RepoConfig` | Per-generation override of the repo's framework. Use when an older generation needs a different framework version than the current one.                                                          |
| `frameworkInstall`      | string               | no       | inherit                   | Per-generation override of `RepoConfig.frameworkInstall`.                                                                                                                                        |
| `packageManager`        | enum                 | no       | inherit                   | Per-generation override of `RepoConfig.packageManager`.                                                                                                                                          |
| `packageManagerInstall` | string               | no       | inherit                   | Per-generation override of `RepoConfig.packageManagerInstall`.                                                                                                                                   |
| `actions`               | map<string, Action>  | yes      | —                         | Actions that exist in **this generation's** codebase. Keys are action ids. **Each generation owns its own copy** — see [Generations — the stable interface](#generations--the-stable-interface). |


Generation ids are arbitrary **dot-free** strings — the dot separates the segments of the fully-qualified action id (`<repoId>.<generationId>.<actionId>`) and of the plan's `releases:` selector keys, so it cannot appear inside a segment. No other naming convention is enforced; encouraged in practice: human-meaningful interface-version names — `v1`, `v2-escrow`, `2026-04-cutover`.

### `Release` fields

A release is one code pin under a generation. At most one of `branch`, `tag`, or `commit` may be set; **omit all three** to track the remote default branch (engine warns).


| Field    | Type    | Required | Default | Description                                                                                                                                         |
| -------- | ------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `branch` | string  | no       | —       | Branch to check out. Mutable — the engine pulls latest on update.                                                                                   |
| `tag`    | string  | no       | —       | Tag to check out. Immutable — recommended for production.                                                                                           |
| `commit` | string  | no       | —       | Commit SHA. Immutable — recommended for production.                                                                                                 |
| `latest` | boolean | no       | `false` | Marks this pin as the generation's default — used when a plan selects no release for the generation. At most one release per generation may set it. |


**Production:** set `tag` or `commit`. **Dev / track-HEAD:** omit all of `branch`/`tag`/`commit`, or set an explicit `branch` (both mutable; omitting warns). Checkout mechanics: [engine-internals.md → Release pin checkout](engine-internals.md#release-pin-checkout). How the plan picks a release: [plans.md → Release selection](plans.md#release-selection).

Release ids are arbitrary strings (no enforced naming convention). Convention encouraged in practice: human-meaningful version-like names — `v1.0.0`, `v2.1.0`, `jan-hotfix` — rather than bare short SHAs.

### Common fields — every action

These fields exist on every action regardless of `type` or `deploys`.


| Field                | Type                | Required          | Default                                                                     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ------------------- | ----------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`               | enum                | yes               | —                                                                           | Action type discriminant. One of `make`, `forge-contract`, `hardhat2-contract`, `hardhat3-contract`, `hardhat3-module`, `forge-script`, `hardhat2-script`, `hardhat3-script`, `script`, `contract-call`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `alias`              | string              | no                | —                                                                           | Optional short handle for the action, usable in a workflow step's `action` field in place of the full `<repoId>.<generationId>.<actionId>`, and surfaced in the UI editor. Must match `^[a-z][a-z0-9-]*$`. **Unique across all actions** — enforced by the loader. Because workflow steps reference actions and workflows through separate fields (`action` vs `workflow`), an alias may share a name with a workflow id. See [workflows.md → Step references](workflows.md#step-references--action-or-workflow).                                                                                                                                                                                                                                                                                          |
| `deploys`            | boolean             | depends on `type` | depends on `type`                                                           | Behavior flag: marks the step as a deploying step (private key always injected, artifacts collected, verification surface enabled). See [The `deploys` flag](#the-deploys-flag).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `description`        | string              | no                | —                                                                           | Free-form, surfaces in editor and logs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `inputs`             | (string \| InputSpec)[] | yes           | —                                                                           | Parameters the action consumes. Each entry is either a plain name or an object `{ name, transform?, array? }` — see [Input shape: arity and encoding transforms](#input-shape-arity-and-encoding-transforms). Names must match `^[a-zA-Z][a-zA-Z0-9_]*$`; `SCREAMING_SNAKE_CASE` is recommended ([references.md → naming convention](references.md#naming-convention-for-user-declared-inputs-and-constants)). There are no reserved input names — any name matching the regex (including v1-style `OPS_*` names) is an ordinary input. `transform` is the input's authoritative encoding coercion (`salt`/`keccak256`, single or chain), applied last and not overridable; it is **scalar-only** (rejected on `array: true`). `array: true` marks an array-valued parameter (the workflow assembles it via a `combine`). **Order matters for contract types** (treated as constructor args) **and for `contract-call`** (treated as call args); on `hardhat3-module`, inputs are passed **by name** as Ignition module parameters and order is irrelevant. The private key is never declared here — the engine injects it as `SEC_PRIVATE_KEY` from `${secret.privateKey}`. Built-in parameter names (`builtin.<NAME>`, e.g. `builtin.CALL_ADDRESS`) can't appear here (the regex forbids the dot) — they are type-declared and supplied via plan constants / workflow mappings ([Built-in parameters](#built-in-parameters)). The deployment method and CREATE3 factory/salt aren't inputs either (method via the step `method`, factory/salt via the plan `deploy` block). |
| `inputConstants`     | map<string, string> | no                | `{}`                                                                        | Hard-coded values for selected inputs. Keys must also appear in `inputs`. Values are **literal strings only** (no `${...}` substitution). Treated as **hard constants**: the plan and workflow `mappings` cannot override them — attempting to do so is an error. See [Inline `inputConstants`](#inline-inputconstants).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `outputs`            | (string \| OutputSpec)[] | yes           | —                                                                           | Names the action exposes downstream. Each entry is either a plain name or an object `{ name, array? }` — see [Output shape: names and arity](#output-shape-names-and-arity). Names must match the same regex as inputs; no templates or `${...}` references. `array: true` marks an array-valued output, reported in `.env.outputs` as a JSON-array string and consumable downstream whole (into an `array: true` input) or per element via a workflow split ([workflows.md → Splitting arrays](workflows.md#splitting-arrays-pick--index-access)).                                                                                                                                                                                                                                                        |
| `workingDir`         | string              | no                | repo root                                                                   | Subdirectory inside the repo where the command runs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `enrichers`          | string[]            | no                | `[]`                                                                        | Names of **additional** enrichers (registered in code) to append after the `type`'s required defaults. See [Authoring custom enrichers / writers](#authoring-custom-enrichers--writers).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `writers`            | string[]            | no                | `[]`                                                                        | Names of **additional** writers to append after the `type`'s required defaults. Same append-only semantics as `enrichers`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `idempotent`         | boolean             | no                | depends on `type` (see [Idempotency and re-runs](#idempotency-and-re-runs)) | If `true`, the engine skips re-execution when a prior attempt for this step already succeeded under the same `deployment_id`/chain — the recorded outputs are replayed instead. Defaults vary by action type.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `requiresPrivateKey` | boolean             | no                | `false`                                                                     | **Only valid on non-deploying actions (`deploys: false`).** Opt-in to having `${secret.privateKey}` injected. On deploying actions, PK is implicit and this field is rejected. Also rejected on `contract-call`, where `mode: send` drives PK injection.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |


### Deployment fields — when `deploys: true`

These fields are valid only when the action's effective `deploys` value is `true`. Setting them on a non-deploying action is a validation error.


| Field    | Type    | Required | Default | Description                                                                                                                                                                                                                                                                                                                                                                                       |
| -------- | ------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify` | boolean | no       | `false` | Per-action master switch for verification: `true` = the engine passes `SYS_VERIFY=1` (plus the selected verification profile's API, dialect, and key from [known-chains.md](known-chains.md)) when the plan's chain reference selects at least one verification profile, and the command verifies inline; `false`/omitted = `SYS_VERIFY` is never set and the command must skip verification. Nothing can switch verification *on* from the plan or the CLI (the plan only selects profiles or disables via `verifiers:`; the CLI `--skip-verify` can switch it *off* for one invocation). Mechanics: [engine-internals.md → Verification](engine-internals.md#verification). |
| `supportsMultisig` | boolean | no | `false` | Declares that the action's author-written command honors the **multisig planning contract**: when `SYS_MULTISIG=1` it broadcasts nothing, simulates as `SYS_SENDER_ADDRESS`, writes the would-be transactions to `.deploy-pad-transactions.json`, and writes predicted outputs to `.env.outputs`. Required (as `true`) for a deploying action of an author-command type (`make`, `forge-script`, `hardhat2-script`, `hardhat3-script`, `script`) to run in [multisig mode](multisig.md) — a multisig-mode run containing such a step without it fails validation, naming the step and action. Irrelevant for the bundled contract/module types, whose engine-owned machinery complies automatically. See [multisig.md → What action authors must do](multisig.md#what-action-authors-must-do). |


Everything else a deploying action exchanges with the engine — outputs, artifacts, the verification context — flows through [The deployment interface](engine-internals.md#the-deployment-interface), not through fields.

### Type-specific fields

Each `type` adds its own fields on top of the common fields (and the deployment fields, when applicable). The subsections below list only the type-specific fields; per-type behavior is described in [Action types](#action-types).

#### `forge-contract` fields


| Field      | Type   | Required | Default | Description                                                                                                       |
| ---------- | ------ | -------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `contract` | string | yes      | —       | Foundry contract reference, `path/to/Source.sol:ContractName` (e.g. `contracts/EscrowFactory.sol:EscrowFactory`). |


The bundled script fulfills the [deployment interface](engine-internals.md#the-deployment-interface) internally — it writes the deployed address to `.env.outputs`, drops the contract's ABI (from `out/<basename(contract)>.sol/<contractName>.json`) into `SYS_ARTIFACTS_DIR`, and verifies inline when `SYS_VERIFY=1`.

#### `hardhat2-contract` fields


| Field      | Type   | Required | Default | Description                                                             |
| ---------- | ------ | -------- | ------- | ----------------------------------------------------------------------- |
| `contract` | string | yes      | —       | Hardhat contract name as registered in artifacts (e.g. `FeeCollector`). |


The bundled script fulfills the [deployment interface](engine-internals.md#the-deployment-interface) internally — it writes the deployed address to `.env.outputs`, drops the contract's ABI (from `artifacts/contracts/.../<contractName>.json`) into `SYS_ARTIFACTS_DIR`, and verifies inline when `SYS_VERIFY=1`.

#### `hardhat3-contract` fields


| Field      | Type   | Required | Default | Description                                                             |
| ---------- | ------ | -------- | ------- | ----------------------------------------------------------------------- |
| `contract` | string | yes      | —       | Hardhat contract name as registered in artifacts (e.g. `FeeCollector`). |


The engine generates a single-contract Ignition module and deploys it via the bundled wrapper. The resolved deployment method (the step's `method`) maps to Ignition strategies (`create` → basic, `create2` → create2 + resolved salt); `create3` fails at run time. The wrapper fulfills the [deployment interface](engine-internals.md#the-deployment-interface) — address to `.env.outputs`, ABI to `SYS_ARTIFACTS_DIR`, inline verification when `SYS_VERIFY=1`.

#### `hardhat3-module` fields


| Field    | Type   | Required | Default | Description                                                                                      |
| -------- | ------ | -------- | ------- | ------------------------------------------------------------------------------------------------ |
| `module` | string | yes      | —       | Path to the Ignition module file, relative to the repo root (e.g. `ignition/modules/Apollo.ts`). |


The bundled wrapper deploys the module via `hre.ignition.deploy`. `inputs` are passed **by name** as module parameters (order does not matter); outputs are the module's **returned contracts**, one `.env.outputs` entry per return-object key — declared output names must equal those keys. `contract` is rejected on this type. Same deployment-method strategy mapping as `hardhat3-contract` (the step's `method`); the wrapper fulfills the [deployment interface](engine-internals.md#the-deployment-interface).

#### `make` fields


| Field     | Type   | Required | Default | Description                                                                                                                                                              |
| --------- | ------ | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `command` | string | yes      | —       | Make target name (without `make` ). E.g. `deploy-router`. The target must write `.env.outputs` itself (wrap an existing recipe in a new target if it can't be modified). |


#### `forge-script` fields


| Field      | Type   | Required | Default | Description                                                                                                                                                                                                                |
| ---------- | ------ | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command`  | string | yes      | —       | Foundry script reference, `path/to/Script.s.sol:ContractName` (e.g. `scripts/PostDeploy.s.sol:PostDeploy`). The engine wraps this with `forge script ...`. The script must produce `.env.outputs` itself (`vm.writeFile`). |
| `function` | string | no       | `run()` | Function to invoke on `command`.                                                                                                                                                                                           |


#### `hardhat2-script` fields


| Field     | Type   | Required | Default | Description                                                                                                                                                                                                                                                             |
| --------- | ------ | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command` | string | yes      | —       | Path to the Hardhat script wrapper (e.g. `scripts/post-deploy.ts`). The engine wraps with `npx hardhat run` (Hardhat 2 toolchain). To invoke a Hardhat task, write a wrapper that calls `await hre.run("<task>", {...})`. The wrapper must write `.env.outputs` itself. |


#### `hardhat3-script` fields

Identical to [`hardhat2-script` fields](#hardhat2-script-fields) — a single required `command` naming the wrapper script. The engine prepares and invokes the Hardhat 3 toolchain instead; inside the wrapper, use Hardhat 3's `network.connect()` API for network access.

#### `script` fields


| Field     | Type   | Required | Default | Description                                                                                                                                                                  |
| --------- | ------ | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command` | string | yes      | —       | Path to the script (relative to the repo root or `workingDir`). Executed via the configured `runtime` as `<runtime> <command>`. The script must write `.env.outputs` itself. |
| `runtime` | enum   | no       | `bash`  | One of `bash`, `node`, `tsx`, `ts-node`. Picks the interpreter used for `command`.                                                                                           |


**Runtime details.** Each runtime is a distinct binary the engine spawns. The author is responsible for ensuring the chosen runtime is installed in the execution environment.


| `runtime` | Spawn shape         | Typical file extension              | Availability                                                                                                                                                                                                    |
| --------- | ------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bash`    | `bash <command>`    | `.sh` (any)                         | Universal on POSIX systems; Windows requires WSL or Git Bash.                                                                                                                                                   |
| `node`    | `node <command>`    | `.js`, `.mjs`, `.cjs`, `.ts`, `.mts` | Shipped with the Node.js the engine itself runs on — **including TypeScript**: on the engine's Node baseline, `node` runs a `.ts` file directly by stripping its types. No build step, but **erasable syntax only** — no `enum`, no `namespace` with runtime code, no parameter properties, no `import =`. The preferred runtime for TypeScript scripts. |
| `tsx`     | `tsx <command>`     | `.ts`, `.tsx`                       | Requires `tsx` on `PATH` — typically installed as a dev dependency. The escape hatch for TypeScript `node` cannot strip: non-erasable syntax, or JSX.                                                          |
| `ts-node` | `ts-node <command>` | `.ts`                               | Requires `ts-node` on `PATH`. Same escape-hatch role as `tsx`.                                                                                                                                                  |


The engine does not validate that `command`'s file extension matches `runtime` — `runtime: bash` with `command: scripts/foo` (no extension) is allowed, as is any other combination. The runtime field is purely about which interpreter the engine spawns.

#### `contract-call` fields


| Field       | Type   | Required | Default | Description                                                                                                                                                                                                                               |
| ----------- | ------ | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signature` | string | yes      | —       | Cast-style function signature, e.g. `transfer(address,uint256)` or `balanceOf(address)(uint256)`. For reads, include the return types — they drive decoding of the result.                                                                |
| `mode`      | enum   | no       | `call`  | How the call is issued — same as `cast`: `call` = static `eth_call` (no transaction, no private key); `send` = signed transaction (engine injects `${secret.privateKey}`). Do not set `requiresPrivateKey` — it is rejected on this type. |


The contract address is not a field — it comes from the type's built-in parameter `builtin.CALL_ADDRESS`, sourced from plan constants or a per-step workflow mapping (see [`contract-call`](#action-type-contract-call)). The `command`, `contract`, and `verify` fields are rejected. When `mode: send`, `outputs` must be `[]`.

## Full example

See [examples/actions.yml](examples/actions.yml) for a worked catalog covering repo/generation/release nesting, multiple action types, release-pin strategies, and inline commentary on notable behaviors.