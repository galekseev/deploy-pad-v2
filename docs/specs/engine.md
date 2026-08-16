# Engine config

The engine's **own run-behavior configuration** — environment policy that is neither launch data (that's [plans](plans.md)), nor connection data ([known-chains](known-chains.md)), nor structure ([actions](actions.md) / [workflows](workflows.md)). Lives at `workspace/configs/engine.yaml`, inside the mounted config set (`--configs-dir`). The file is **optional**: when none is mounted, the engine's **shipped default config** applies; a mounted file **replaces the default wholesale** — no merge. Its first tenant is the **preflight checks** block.

> **Naming.** New in v2 — no v1 counterpart. The file was introduced by the [phase-5 preflight design](../architecture/phase-5-preflight.md); that doc owns the design rationale (why the phase exists, why checks are scripts, what the shipped checks probe and why). This file is the field-level spec: what you can write in `engine.yaml` and what each field means.

## Purpose

Phases 1–4 of a run fail statically — everything they check is provable from files. But some facts a launch depends on live on chain or in the network: a dead or wrong-network RPC endpoint, a drained deployer wallet, a CREATE3 factory that was never deployed on a chain. **Preflight checks** probe those preconditions in seconds of read-only calls, after the resume-or-fresh verdict and before the engine invests in repository preparation — so a broken environment fails the run cheaply (exit code `6`), not mid-launch.

`engine.yaml` is where an operator controls that phase: which checks run, how strictly, and with what tuning. Every check — the shipped ones included — is configured here the same way; the engine itself contains no check logic, only the scheduler and three check scripts distributed with the release. Disabling, tuning, reordering, or replacing a shipped check is an ordinary config edit.

The file exists (rather than folding this into a plan or the chain registry) because run behavior is environment policy: the same checks apply to every launch, and they are owned by whoever operates the environment, not by a launch author. Future run-behavior settings would live here too, as new top-level blocks beside `preflight`.

## Structure & fields

### Top-level shape

```yaml
version: 2                      # config format version — engine errors on mismatch (override with --ignore-version)

preflight:
  checks:                       # map of check name -> check entry; order is meaningful
    <checkName>:
      script: engine:<name>     # a check shipped with the engine release…
      # script: <path>.ts       # …or an operator script under --configs-dir
      enabled: true             # optional — disable-without-removal switch
      severity: error           # optional — error | warn
      scope: chain              # optional — chain | run
      params: {}                # optional — free-form, passed to the script verbatim
```

The reserved top-level `version` key declares the **config format version** the file is written against (current: `2`), with the same rules as every config file: a mismatch is a load-time error unless `--ignore-version` downgrades it to a warning; a missing `version` is always a warning. See [engine-internals.md → Config version check](engine-internals.md#config-version-check).

The field-by-field tables live in [Field reference](#field-reference); a full worked example in [examples/engine.yml](examples/engine.yml).

### Naming conventions

**`<checkName>`** (keys of `preflight.checks`):

- Lowercase, hyphenated (`^[a-z][a-z0-9-]*$`) — the same grammar as chain, profile, set, and multisig-entry names.
- The name is how the check appears in the preflight report and the run attempt record (`rpc: passed`, `dns-sanity: disabled`), so name checks by what they verify (`rpc`, `balance`, `release-backend-live`), not by implementation trivia.
- **Declaration order is meaningful** — see [Ordering and chain scope](#ordering-and-chain-scope).

The **`engine:` scheme** in `script` values is reserved for checks shipped with the engine release (`engine:rpc`, `engine:balance`, `engine:create3-factory`). Everything else in a `script` value is a file path.

## The default config — and wholesale replacement

The engine release bundles a **default engine config** — a real `engine.yaml` document (scaffolding copies it into new workspaces, so it is visible and editable, not folklore). Its `preflight.checks` enables the three shipped checks:

```yaml
# The engine's shipped default config (engine.yaml)
version: 2

preflight:
  checks:
    rpc:
      script: engine:rpc               # exact facts -> hard failures
      severity: error
    create3-factory:
      script: engine:create3-factory   # exact fact -> hard failure;
      severity: error                  #   trivially passes on runs with no create3 steps
    balance:
      script: engine:balance           # a heuristic estimate -> warn while it earns trust;
      severity: warn                   #   promote to error in your own engine.yaml when trusted
```

The resolution rule is deliberately simple — **replacement, not merge**, the same rule presets follow:

- **No `engine.yaml` in the mount** → the shipped default applies → the shipped checks run. A bare workspace is safe by default.
- **A mounted `engine.yaml` replaces the default wholesale.** The file you mount is the complete truth about preflight: to keep a shipped check, keep its entry (still one `script: engine:<name>` line — the script itself stays in the release); to drop it, omit it; to switch it off visibly, set `enabled: false`. There is no layering and no "the engine quietly adds its checks back" — which is what makes "what will preflight do?" readable from one file.

A mounted file with an empty (or absent) `checks` map therefore runs **no** preflight checks at all. That is allowed — but prefer `enabled: false` for anything you might want back: a disabled check is *reported* as `disabled` in every run, while an omitted one is discoverable only through git history. **Disable when the intent is temporary or worth seeing; remove only what is permanently gone.**

## Preflight checks

### What a check is

A check is a **TypeScript script** the engine runs out of process — there are no engine-native check types and no privileged code paths; the shipped checks obey exactly the same contract as an operator's. The contract, in brief (full spec: [phase 5 → The check mechanism](../architecture/phase-5-preflight.md#the-check-mechanism--one-kind-no-special-cases)):

- **Exit code `0` is a pass; anything else is a fail.** Whatever the script prints (conventionally to stderr, on failure) is surfaced verbatim as the check's message in the preflight report and the attempt record — there is no machine-readable result channel.
- The engine hands every check the **check context**: a curated, versioned JSON document (path in `SYS_CHECK_CONTEXT`) carrying the invocation's chain scope and per-chain connections, the sender **address** per chain (never a key), a step view of the execution plan (methods, factory flavors, deploy data, `verify` flags), the run's system variables, and the check's own `params` object verbatim. Secret-tagged values never serialize into it, and no `SEC_*` variable reaches the check environment. Flat conveniences also arrive in the environment: `SYS_CHAIN_ID` / `SYS_CHAIN_NAME` / `SYS_RPC_URL` (chain scope), `SYS_DEPLOYMENT_ID` (both scopes), `SYS_CHAINS` (run scope — comma-separated chain names).
- Operator scripts are **paths under `--configs-dir`** — checks run before any repository exists, so they ship with the config set (which also keeps them inside the mount allowlist). Shipped checks are named through the `engine:` scheme.
- There are deliberately **no `timeout` or `retries` fields** — retrying belongs inside a script that wants it. The engine keeps one fixed backstop (a generous hard limit of 5 minutes per check attempt, not configurable) whose only job is to keep a hung script from stalling the run.
- Checks **should be read-only** — an author obligation the engine cannot enforce, the same class of contract as `idempotent: true`. A check that needs a credential to do its job is not a preflight check; it is a step.

### Ordering and chain scope

- **`run`-scope checks execute first**, once per invocation; then, **per chain, the `chain`-scope checks** — each group in **declaration order** (the order of keys in the `checks` map). Operator chain-scope checks usually assume a live endpoint, so the natural place for the RPC entry is first among the chain-scope checks — which is where the shipped default puts it. Nothing enforces that: the config owner controls the order.
- Chain-scope checks run against **the chains this invocation will attempt** — the resolved chain scope after CLI filters, the deployment record's frozen list on resume, minus chains already complete — never the whole registry. Per-chain checks across chains run concurrently.
- **The phase does not stop at the first failure**: every enabled check runs, failures aggregate, and the report names all of them (`validate`-style). Only after the full pass does any `severity: error` failure abort the run.

### Severity, `enabled`, and `--skip-preflight`

Three dials, from narrow to broad:

- **`severity: warn`** — the check runs and reports but never blocks. Useful while a new operator check earns trust, or to keep the RPC check informative on a known-flaky chain without giving up launches to it. `severity: error` failures abort the run with exit code `6` ([cli.md → Exit codes](cli.md#exit-codes)) once all checks have run.
- **`enabled: false`** — the entry stays in the file, the check does not run, and the skip is **visible**: the preflight report and the run attempt record list the check as `disabled`. Opting out of a safety check stays an auditable fact.
- **`--skip-preflight`** — skips the whole phase for one invocation, shipped checks included; a warning is printed and the skip is recorded in the attempt record. The emergency hatch for a *check* being wrong rather than the environment — not a routine flag. For anything longer-lived, use the config-side dials above ([cli.md → Safety and escape hatches](cli.md#safety-and-escape-hatches)).

### When checks run

Preflight runs on **`run` invocations only — every one of them**: fresh starts and resumes alike (the environment can degrade between invocations, and checking is cheap), multisig poll re-invocations, and `--verify-only` passes. It never runs on `validate` (offline by design) or `--dry-run` (exits at phase 3). The *file* itself, when mounted, loads and validates in phase 2 for any command that loads the config set — including `validate` ([phase 2 → What gets loaded](../architecture/phase-2-load-validation.md#what-gets-loaded)).

## Shipped checks

The engine release bundles three check scripts under the `engine:` scheme. Together they cover the on-chain preconditions every deploying run shares: the connection works, the payer can pay, the deterministic-deployment infrastructure exists and answers. The roster is deliberately complete — no further shipped checks are planned; anything beyond these three is operator territory. What each one probes (mechanics and rationale: [phase 5 → The shipped checks](../architecture/phase-5-preflight.md#the-shipped-checks)):

| Check | Scope | What it verifies | Default severity |
|---|---|---|---|
| `engine:rpc` | `chain` | **Reachability and identity** in one `eth_chainId` call against the run's own selected RPC profile: the endpoint answers, and the served chain id matches the registry's `chain_id` (a wrong-network URL is deadlier than a dead one). | `error` |
| `engine:balance` | `chain` | **The payer can pay**: the sender's native balance against a requirement **estimated from the run itself** — the gas-spending steps *this invocation will actually attempt*, priced by `eth_gasPrice` (no configured per-chain thresholds). Completed and replayed steps count for nothing, so a `--verify-only` pass or a resume with no gas-spending work left estimates ≈ 0 and passes trivially. Sender-mode aware: checks the deployer (eoa) or the executor (merkle backend); passes trivially on the multisend backend, where owners pay for execution. | `warn` (a heuristic — promote to `error` once its estimates prove out in your environment) |
| `engine:create3-factory` | `chain` | **The CREATE3 infrastructure exists and answers**: for every step resolving to `create3`, one `eth_call` asks that step's factory to compute the deployment address for the step's resolved salt — proving the factory exists *and* speaks its flavor's interface — and the **predicted addresses are printed** as a pre-launch preview. A no-op on runs with no `create3` steps. | `error` |

### `engine:balance` params

The estimate is `(deploySteps × gasPerDeployment + otherSteps × gasPerCall) × gasPrice × safetyFactor`, and the check passes when the payer's balance is at least `max(required, minimums[chain] ?? 0)`. The knobs are heuristics, not chain data, and live in the entry's `params`:

| Param | Default | Meaning |
|---|---|---|
| `gasPerDeployment` | `1000000` | Assumed gas per **deployment** step (contract creation). |
| `gasPerCall` | `250000` | Assumed gas per **non-deployment** gas-spending step (transacting calls). |
| `safetyFactor` | `1.5` | Multiplier on the estimate. |
| `minimums` | `{}` | Optional per-chain floor in **native units** (e.g. `matic: "25"`) — the escape hatch for chains where the estimate is known to undershoot. An override, not the primary mechanism. |

`params` is free-form at the schema level and passed to the script verbatim — each check documents its own params; the shipped `engine:rpc` and `engine:create3-factory` checks read none.

## Relationships to other configs

| Other doc | Relationship |
|---|---|
| [phase-5-preflight.md](../architecture/phase-5-preflight.md) | The owning design: why the phase exists, the check contract in full (context document, versioning, no-secrets rule, out-of-process execution), the shipped checks' mechanics, and the decision record. This spec restates only what an author needs to write the file. |
| [phase-2-load-validation.md](../architecture/phase-2-load-validation.md) | When mounted, this file passes the same four load gates as every config — version check, schema, referential rules (every `script` reference must resolve statically), value resolution (nothing to resolve — see the references.md row below). |
| [cli.md](cli.md) | `--configs-dir` (where the file is mounted from), `--skip-preflight` (the per-invocation skip), `--ignore-version` (the version-gate escape hatch), and exit code `6`. |
| [references.md](references.md) | **No `${...}` substitution applies in this file** — `params` values reach check scripts verbatim; the engine never interprets them. See the [scoping matrix](references.md#scoping). |
| [known-chains.md](known-chains.md) | The RPC profiles (URL, headers) the check context exposes per chain, and the `chain_id` the shipped RPC check compares against. |
| [secrets.md](secrets.md) | Why checks see no secrets: the context serializes untagged values only, and the sender block carries an address, never a key. |
| [engine-internals.md](engine-internals.md) | The config version check mechanics; the TypeScript runtime (`tsx`) that executes check scripts. |

## Validation rules & common errors

Enforced statically at config load (phase 2), before any check runs:

- **`version`** — a value differing from the engine's supported format version is a load-time error unless `--ignore-version` downgrades it to a warning; missing is always a warning. Same rules as `actions.yaml` / `workflows.yaml`.
- **Unknown keys are rejected** — at the top level, inside `preflight`, and inside each check entry (`additionalProperties: false`). In particular, there are no `timeout` / `retries` fields to set — see [What a check is](#what-a-check-is).
- **Check names** must match `^[a-z][a-z0-9-]*$`.
- **`script` must resolve**: an `engine:<name>` value must name a check shipped with the engine release (unknown `engine:` names are validation errors); a path value must point at a `.ts` file that exists under `--configs-dir`. A missing script fails here, statically — never at phase 5.
- **`severity`** is `error` or `warn`; **`scope`** is `chain` or `run`; **`params`** is a YAML mapping (contents unconstrained — passed verbatim).

Common authoring mistakes:

- Expecting a mounted file to **merge** with the shipped default. Replacement is wholesale — carry the entries of every shipped check you want to keep.
- Deleting an entry to disable a check temporarily. Removal is silent; `enabled: false` keeps the opt-out visible in every run's report.
- Reaching for a per-check timeout or retry field. They don't exist by design — retry inside the script; the engine's fixed backstop only guards against hung scripts.
- Pointing `script` at a file inside a cloned repository. Repositories don't exist yet when preflight runs — operator scripts ship with the config set, under `--configs-dir`.
- Writing a check that needs a credential. The context serializes no secrets and no `SEC_*` variable reaches the check environment; credential-needing verification belongs in a workflow step.
- Putting `${...}` references in `params`. Nothing is resolved in this file — values reach the script exactly as written.
- Relying on `--skip-preflight` routinely. It is the emergency hatch for a broken *check*; persistent opt-outs belong in this file (`enabled: false` or `severity: warn`), where they are reviewable.

## Field reference

The field-by-field tables. The conceptual narrative lives in the body sections above — [The default config](#the-default-config--and-wholesale-replacement) and [Preflight checks](#preflight-checks).

### Top-level fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `version` | integer | no (warns if missing) | — | Config format version this file is written against (current: `2`). A value that differs from the engine's supported format version is a load-time **error** unless `--ignore-version` is passed. See [engine-internals.md → Config version check](engine-internals.md#config-version-check). |
| `preflight` | object | no | — | The preflight-checks block — the file's first tenant. |

### `preflight` fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `checks` | map<checkName, CheckEntry> | no | `{}` | The checks phase 5 runs, keyed by check name (`^[a-z][a-z0-9-]*$`). **Declaration order is meaningful**: `run`-scope checks first (once per invocation), then per chain the `chain`-scope checks — each group in this order. An empty or absent map means no checks run (the shipped default applies only when no `engine.yaml` is mounted at all). |

### `CheckEntry` fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `script` | string | yes | — | The check script: `engine:<name>` for a [check shipped with the engine release](#shipped-checks), or a path to a `.ts` file resolved **relative to `--configs-dir`**. Resolution is validated statically at load. |
| `enabled` | boolean | no | `true` | Disable-without-removal switch. A disabled check does not run and is reported as `disabled` — a visible, auditable opt-out. |
| `severity` | enum | no | `error` | `error` — a failure aborts the run (exit `6`, after every enabled check has run and all failures are reported together); `warn` — a failure is printed and recorded, and the run proceeds. |
| `scope` | enum | no | `chain` | `chain` — runs once per chain the invocation will attempt; `run` — runs once per invocation. |
| `params` | object | no | `{}` | Free-form YAML object passed to the script **verbatim** inside the check context (`context.params`). The engine never interprets it; each check documents its own params (see [`engine:balance` params](#enginebalance-params)). No `${...}` substitution. |

The machine-readable schema is [schemas/engine.schema.yaml](schemas/engine.schema.yaml).

## Full example

A worked operator config — replacing the shipped default wholesale: the three shipped checks carried over (with `engine:balance` promoted to `error` and tuned), one operator-written run-scope check, and one visibly disabled check — see [examples/engine.yml](examples/engine.yml).

What you'll observe when it is mounted:

- The shipped default no longer applies — this file is the complete truth about preflight. The three `engine:*` entries keep the shipped checks running (their scripts stay in the release); had one been omitted, it would silently not run.
- `balance` runs as `severity: error` with a raised `gasPerDeployment` and a per-chain floor for `matic` — the promote-once-trusted path the default config's comment describes.
- `release-backend-live` is a `run`-scope check, so it executes **first**, once, despite being declared after the chain-scope entries; the chain-scope checks then run per chain in declaration order (`rpc`, `create3-factory`, `balance`).
- `dns-sanity` never runs but shows up as `disabled` in the preflight report and the attempt record — the opt-out is on the record, not buried in git history.
- All of it is skippable for one emergency invocation with `--skip-preflight` (recorded), and none of it runs on `validate` or `--dry-run`.

## Open questions

None currently. The file has one tenant today; future run-behavior settings would join it as new top-level blocks.
