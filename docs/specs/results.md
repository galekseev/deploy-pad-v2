# Results — the deployment records (`workspace/results/`)

The owning spec for the **results tree**: every file the engine writes about a deployment, its shape, when it is written, and the rules it obeys. Unlike the other specs, this one describes **engine-written output**, not user-authored config — there is no `.schema.yaml` companion, and nothing here is ever edited by hand. The record *model* (ownership, timing, immutability philosophy) is designed in [phase 8](../architecture/phase-8-persistence-report.md); this doc is the field-level reference.

## Directory layout

```
workspace/results/<workflow>/<deployment_id>/
  deployment.yaml          # immutable launch record (written once, phase 4)
  config_snapshot.yaml     # frozen parameter set (phase 4; rewritten only by --refreeze)
  summary.json             # machine-readable summary of the latest invocation (phase 8)
  <chain>/                 # one directory per chain the deployment targets
    run-N.yaml             # attempt record for invocation N on this chain
    result.yaml            # repairable aggregate for this chain
    artifacts/<step_id>/   # collected step artifacts (ABIs, deployment records)
```

Two scopes, deliberately:

- **Deployment-scoped records** live directly under `<deployment_id>/` — they describe the launch as a whole (`deployment.yaml`, `config_snapshot.yaml`) or the latest invocation across all chains (`summary.json`). The chain provenance, the structural fingerprint, and the frozen values for *every declared chain* are facts about the deployment, not about any one chain.
- **Chain-scoped records** live under `<deployment_id>/<chain>/` — attempts, aggregates, and artifacts are per-chain facts, and a resumed invocation touching only one chain touches only that chain's directory.

**Invocation numbering.** `N` in `run-N.yaml` is the **deployment-wide invocation ordinal** — the same invocation writes `run-3.yaml` into every chain directory it attempts. A chain not attempted by invocation 3 (out of scope, or skipped after an earlier chain aborted a `sequential` run) simply has no `run-3.yaml`; the numbering gap is meaningful, not an error.

The tree is keyed by the resolved deployment id — derivation, ordinal suffixes, and resume semantics are owned by [plans.md → Deployment id & re-runs](plans.md#deployment-id--re-runs). The root moves with `--results-dir` ([cli.md → Common flags](cli.md#common-flags)).

## The three rules

Every record obeys the rules set by [phase 8 → The record model](../architecture/phase-8-persistence-report.md#the-record-model):

1. **Immutability.** `deployment.yaml` is written once and never overwritten; a completed invocation's `run-N.yaml` is never mutated; `--restart` abandons a directory, never rewrites one. The one deliberate exception: `config_snapshot.yaml` is rewritten by an explicit `--refreeze`, with the event recorded in that invocation's attempt record. (`result.yaml` and `summary.json` are *derived* records with an update-in-place lifecycle — see their sections.)
2. **Redaction.** Secret-tagged values never appear in a record — vault-sourced values display as their reference label (`[vault.<name>]`, fragments of larger strings included), direct-env and literal secrets as `********` / `[redacted: <slot>]`. The tag applied at resolution time drives it mechanically ([secrets.md](secrets.md)); no record-writing code decides case by case.
3. **Self-sufficiency.** A deployment's directory answers "what ran, with what values, producing what" without the configs that produced it ([NFR-001](../requirements.md)).

**Record versioning.** Every YAML record carries a top-level `recordVersion` (and `summary.json` a `schemaVersion`); changes within a version are **additive-only** — consumers never break on new fields. This is the same evolution discipline as the preflight check context.

## Designed for version control

The tree is meant to be committable, and three properties — two of them consequences of the rules above — are what make it so. They matter most on an ephemeral CI runner, where committing the tree back to the repository is how a deployment survives to its next invocation ([ci.md](ci.md)).

- **Secret-free by construction.** Redaction is a property of the record writer, not a habit of its callers (rule 2), so no record can carry a credential into git.
- **Append-mostly and immutable.** A new `run-N.yaml` per invocation, `deployment.yaml` written once, `--restart` abandoning a directory rather than rewriting one (rule 1). Concurrent edits to the same record are structurally rare, and a diff reads as what happened — a new attempt, a confirmed address, a batch that advanced.
- **Relocatable.** Every path inside the tree is relative to `--results-dir`, and no record holds an absolute path, a hostname, or any other machine identity. A deployment resumes from a fresh checkout on a different machine exactly as it would on the machine that started it, given the same configs — the portability [NFR-043](../requirements.md) requires and the resume model in [phase 4](../architecture/phase-4-deployment-resolution.md) depends on.

Two things follow for anyone wiring this up. The tree is the **cross-invocation contract**: losing it does not corrupt anything, but it makes the next invocation blind — it sees no prior deployment, so it starts a fresh one instead of resuming ([cli.md → One deployment, many invocations](cli.md#one-deployment-many-invocations)). And `--repos-dir` is the opposite kind of state — disposable clones and build output, re-created every invocation, never committed.

## `deployment.yaml` — the immutable launch record

Written once by [phase 4](../architecture/phase-4-deployment-resolution.md#writing-deploymentyaml) when a fresh deployment starts; read by every later invocation's resume re-checks.

| Field | Contents |
|---|---|
| `recordVersion` | Record format version. |
| `id` | The resolved (possibly suffixed) deployment id. |
| `workflow` | The workflow (or single-action) the plan points at. |
| `plan` | The plan file the deployment was launched from. |
| `preset` | The selected preset's name. |
| `createdAt` | Deployment creation timestamp (ISO 8601, UTC). |
| `overrides` | The deployment overrides as passed (`--set` / `--overrides`), merged shape. Recorded unredacted — which is why an override must never carry a credential ([cli.md](cli.md#plan-and-values)). |
| `multisig` | The multisig registry entry name, or absent for eoa mode. Every later invocation must repeat it. |
| `chains.set` | The referenced chain-set name, when the plan used `$set`; omitted otherwise. |
| `chains.resolved` | The resolved chain list at deployment creation. A resume runs against this list, never a re-expansion. |
| `structure` | The structural fingerprint (`sha256:…`) of the execution plan — see [phase 4 → The structural fingerprint](../architecture/phase-4-deployment-resolution.md#the-structural-fingerprint-no-resume-across-a-changed-shape). A resume recomputes and compares; mismatch refuses the resume. |

```yaml
recordVersion: 1
id: prod-2
workflow: aqua-full-stack
plan: plans/aqua-full-stack.yaml
preset: prod
createdAt: "2026-07-27T14:03:11Z"
overrides:
  defaults:
    constants:
      FEE_TAKER: "0x5E8f…"
multisig: ops-main
chains:
  set: evm-prod
  resolved: [mainnet, base, matic]
structure: "sha256:9f2c41d8…"
```

## `config_snapshot.yaml` — the frozen parameter set

Written by phase 4 at deployment creation; **normative on resume** — it supplies the values phase 7 runs with, per [the parameter freeze](../architecture/phase-4-deployment-resolution.md#the-parameter-freeze-on-resume). Rewritten only by an explicit `--refreeze`.

| Field | Contents |
|---|---|
| `recordVersion` | Record format version. |
| `frozenAt` | When the current frozen set was resolved (creation, or the last `--refreeze`). |
| `refrozenBy` | Present after a `--refreeze`: the invocation (`run-N`) that rewrote the snapshot. |
| `chains.<name>.constants` | The resolved constants for the chain — every declared chain, in scope or not, `${random.N}` fixed at resolution. |
| `chains.<name>.deploy` | The resolved deploy data (per-step salts, factories) for the chain. |

Secret-tagged values are **not persisted** — the slot appears redacted, and secrets re-resolve live on every invocation. A chain added to the plan file after launch is appended on its first attempt (with a warning) and frozen from then on.

```yaml
recordVersion: 1
frozenAt: "2026-07-27T14:03:11Z"
chains:
  mainnet:
    constants:
      FEE_TAKER: "0x5E8f…"
      TOKEN_SALT: "deploy_prod-2_kX8pQz2mR4vN1wTe"   # ${random.16} — fixed at creation
    deploy:
      salts:
        deploy-router: "0xa1b2…"
      factories:
        deploy-router: "0x65B3…"
  base:
    constants:
      FEE_TAKER: "0x5E8f…"
      TOKEN_SALT: "deploy_prod-2_kX8pQz2mR4vN1wTe"
```

## `run-N.yaml` — the attempt record

One per invocation per attempted chain, opened by phase 7 as a new file and updated as steps complete — never mutated once the invocation ends. The authoritative source: the [idempotency index](engine-internals.md#idempotency-lookup) is rebuilt from these files, and `result.yaml` is derived from them.

| Field | Contents |
|---|---|
| `recordVersion` | Record format version. |
| `invocation` | The deployment-wide invocation ordinal (the `N`). |
| `startedAt` / `finishedAt` | Invocation timestamps for this chain. |
| `constants` | The resolved constants this invocation ran with (the frozen set; secrets redacted). |
| `events` | Invocation-level facts: `skipped-preflight`, `refreeze`, parameter-drift warnings (with the changed key names), fresh-chain resolution. |
| `warnings` | Every warning printed during the invocation, verbatim. |
| `steps.<stepId>.status` | `succeeded` · `failed` · `replayed` · `skipped` — or, in multisig mode, the batch-driven statuses `planned` · `proposed` · `executed` · `collected` ([multisig.md → Lifecycle & resume](multisig.md#lifecycle--resume)). |
| `steps.<stepId>.action` / `method` / `factory` | What the step resolved to (fully-qualified action id; deploy method; factory flavor where applicable). |
| `steps.<stepId>.inputs` / `outputs` | The step's actual inputs (secrets redacted) and declared outputs (predicted outputs in multisig mode, until collected). |
| `steps.<stepId>.transactions` | Transaction hashes (execution, or the planned batch's). |
| `steps.<stepId>.error` | The failure message, for `failed` steps. |
| `batches` | Multisig mode: per-batch records — `safeTxHash` (multisend) or Merkle `root` (merkle), status, the steps it carries. The recorded hash is authoritative on resume — a `proposed` batch is re-verified, never re-planned. |

```yaml
recordVersion: 1
invocation: 2
startedAt: "2026-07-27T16:41:02Z"
finishedAt: "2026-07-27T16:44:37Z"
events:
  - type: parameter-drift
    keys: [FEE_TAKER]
steps:
  deploy-router:
    status: replayed
    action: aqua.v1.deploy-router
    method: create3
    factory: oneInch
    outputs:
      ROUTER_ADDRESS: "0x3F6a…"
  transfer-ownership:
    status: succeeded
    action: aqua.v1.transfer-ownership
    inputs:
      ROUTER_ADDRESS: "0x3F6a…"
      NEW_OWNER: "0x9C21…"
    transactions: ["0x77d1…"]
```

## `result.yaml` — the repairable aggregate

The per-chain rollup: the **latest** outcome of every step, confirmed addresses, and the constants in effect — updated after each step or batch completes, with a final aggregate pass at invocation end. It is **derived, never authoritative**: the `run-N.yaml` attempt records are the source of truth, and a failed final write degrades to a warning because the next invocation's aggregate pass rebuilds it ([phase 8 → Decided](../architecture/phase-8-persistence-report.md#decided)).

```yaml
recordVersion: 1
status: completed            # completed · failed · waiting · in-progress
updatedAt: "2026-07-27T16:44:37Z"
steps:
  deploy-router: { status: succeeded, invocation: 1 }
  transfer-ownership: { status: succeeded, invocation: 2 }
addresses:
  ROUTER_ADDRESS: "0x3F6a…"
constants:
  FEE_TAKER: "0x5E8f…"
```

## `summary.json` — the machine-readable summary

The structured counterpart of the human end-of-run summary, for pipelines that do more than branch on the exit code: written at deployment level at the end of **every** invocation, describing that invocation's outcome across all chains. It is **rewritten each time** (latest invocation wins — per-invocation history lives in the `run-N.yaml` records) and, like the printed summary, **best-effort**: a failed write is logged and never masks the run outcome or changes the exit code.

| Field | Contents |
|---|---|
| `schemaVersion` | Summary format version; additive-only evolution within a version. |
| `deploymentId` / `workflow` / `preset` | Identity, mirroring `deployment.yaml`. |
| `invocation` | Which invocation this summary describes. |
| `status` | `success` · `waiting` (multisig signatures pending) · `failed`. |
| `exitCode` | The invocation's exit code ([cli.md → Exit codes](cli.md#exit-codes)). |
| `startedAt` / `finishedAt` | Invocation timestamps. |
| `chains[]` | Per chain: `name`, `status` (`completed` · `failed` · `waiting` · `skipped` · `not-attempted`), and `steps[]` — `id`, `status`, confirmed `outputs`, `error` for failed steps. |
| `warnings[]` | The invocation's warnings, structured (`type`, `message`). |
| `multisig` | Waiting state only: the pending batches (`safeTxHash` / `root`, chain, signing URL where the backend provides one) — the same facts the human summary and `status` show. |

```json
{
  "schemaVersion": 1,
  "deploymentId": "prod-2",
  "workflow": "aqua-full-stack",
  "preset": "prod",
  "invocation": 2,
  "status": "waiting",
  "exitCode": 10,
  "startedAt": "2026-07-27T16:41:02Z",
  "finishedAt": "2026-07-27T16:44:37Z",
  "chains": [
    {
      "name": "mainnet",
      "status": "waiting",
      "steps": [
        { "id": "deploy-router", "status": "proposed" }
      ]
    },
    {
      "name": "base",
      "status": "completed",
      "steps": [
        { "id": "deploy-router", "status": "collected",
          "outputs": { "ROUTER_ADDRESS": "0x3F6a…" } }
      ]
    }
  ],
  "warnings": [],
  "multisig": {
    "entry": "ops-main",
    "pending": [
      { "chain": "mainnet", "safeTxHash": "0x8b4e…" }
    ]
  }
}
```

Everything in `summary.json` is derived from the attempt records and honors redaction — it introduces no information that isn't already on disk, only a stable shape for reading it. The intended CI pairing: `--log-level silent -l run.json` for the full structured log, `summary.json` for the outcome.

## `artifacts/<step_id>/` — collected step artifacts

Whatever the step's command dropped into `SYS_ARTIFACTS_DIR` during its run, persisted at the collect phase ([engine-internals.md](engine-internals.md)): ABIs, framework deployment records, anything the author chose to keep. In multisig mode, artifacts staged at planning time (ABIs from the local build) persist when the batch reaches `collected`. Contents are author-shaped; the engine guarantees only the location and the persistence timing.

## Relationships to other docs

| Doc | What it owns |
|---|---|
| [phase-8-persistence-report.md](../architecture/phase-8-persistence-report.md) | The record model's design: ownership, timing, immutability philosophy, the summary and exit code. |
| [phase-4-deployment-resolution.md](../architecture/phase-4-deployment-resolution.md) | When and why `deployment.yaml` and `config_snapshot.yaml` are written; the resume freezes that read them. |
| [plans.md](plans.md) | Deployment id derivation and resume semantics — the key of the tree. |
| [engine-internals.md](engine-internals.md) | The idempotency index rebuilt from `run-N.yaml`; `SYS_ARTIFACTS_DIR` and the collect phase. |
| [multisig.md](multisig.md) | The batch statuses and the waiting-state facts the records and summary carry. |
| [secrets.md](secrets.md) | The redaction mechanism every record honors. |
| [cli.md](cli.md) | `status` / `report` (the tree's readers), `--results-dir`, the exit-code table `summary.json` mirrors. |
| [ci.md](ci.md) | Keeping the tree alive between invocations on an ephemeral runner — the commit-back pattern and the alternatives. |
