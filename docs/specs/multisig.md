# Multisig deployments

Deploying **from a Gnosis Safe** instead of an EOA: the engine plans every transaction without broadcasting, the Safe owners approve with a small number of signatures (often exactly one), and execution happens only after the approval threshold is met. The registry of available multisigs lives in `workspace/configs/multisig.yaml`; a run opts in with the CLI `--multisig <name>` selector. Plans, workflows, and actions are untouched — the same YAML runs in either mode.

> **Naming.** The *sender mode* (`eoa` | `multisig`) is a run parameter, like the deployment id — never a plan field. The registry file follows the [known-chains.md](known-chains.md) model: the file is a registry of named entries, the invocation selects one by name.

## Purpose

In the default (`eoa`) mode, every deploying step signs and broadcasts with `${secret.privateKey}` — one wallet, transactions sent one after another. Some launches need the **sender to be a multisig**: the protocol's Safe owns the CREATE3 factory, or organizational policy requires N-of-M approval for anything that touches production.

The naive approach — sign each of the run's transactions through the Safe one by one — does not scale: ten deployments would mean ten signature ceremonies per chain. Multisig mode solves this by splitting the run into two halves:

- **Planning** — the engine simulates every step in order and collects the transactions it *would* send (`to`, `value`, `data` — the contract bytecode is embedded in the calldata of the factory call). Because CREATE2/CREATE3 addresses are computable before execution, step outputs are known at planning time and flow into downstream mappings as usual.
- **Execution via a backend** — the collected transactions are handed to the Safe through one of two backends:
  - **`multisend`** — the batch is wrapped in one Safe MultiSend transaction and proposed to the Safe Transaction Service. Owners sign **one hash per batch per chain** in the standard Safe UI. No custom on-chain code.
  - **`merkle`** — every transaction of the whole run (all chains, all batches) becomes a leaf of a Merkle tree; owners sign **the root once**, and an executor key runs the leaves one by one through a Safe module. Based on the audited, MIT-licensed Sphinx contracts.

What does **not** change in multisig mode: CREATE2/CREATE3 address derivation, the results directory layout, output flow between steps, and verification targets. What changes: who the sender is, when transactions execute, and the fact that a run can pause in a *waiting for signatures* state and resume later.

## Turning it on — the `--multisig` selector

Sender mode is decided **at invocation time**:

```bash
# default: eoa mode — exactly the behavior documented everywhere else
yarn deploy-pad run -e my-plan

# multisig mode: deploy through the "ops-main" entry of multisig.yaml
yarn deploy-pad run -e my-plan --multisig ops-main
```

- The flag value is the **name of a registry entry** in `multisig.yaml` (below). The entry carries everything the mode needs — the backend, the per-chain Safe addresses, the credentials. There are no other multisig-related CLI flags.
- The selected name and the resolved (secret-redacted) parameters are recorded into `deployment.yaml`, so the launch is reproducible from the result alone — the same rule as deployment overrides.
- Because the mode is per-invocation, one plan can be launched with an EOA on staging and through a Safe on production without any plan edit. If a launch must *always* go through a specific Safe, that is an operational convention (documented in the plan's comments or your runbook) — the config system deliberately does not couple a plan to a sender.

**Resume rule.** All invocations of one deployment must use the same sender mode and the same registry entry. Re-running an unfinished multisig deployment without `--multisig` (or with a different entry name) is an error at deployment resolution, naming the recorded entry — pass the same selector to resume, or `--restart` to abandon and start over.

## The multisig registry (`multisig.yaml`)

A top-level `multisigs:` mapping of **named entries**. Each entry is self-contained: it declares which backend executes the run and every parameter that backend needs, per chain. The file is deliberately separate from `global-params.yaml` so an environment (CI in particular) can be provisioned with only the multisigs it is allowed to use — the file you mount *is* the allowlist.

### Top-level shape

```yaml
# yaml-language-server: $schema=../schemas/multisig.schema.yaml
version: 2                                   # config format version — same rules as every config file

multisigs:
  ops-main:                                  # entry name — what --multisig selects
    backend: multisend                       # multisend | merkle
    proposer: "${vault.opsProposer}"         # delegate key for the Safe Transaction Service
    chains:
      mainnet:
        safe: "0x1234...abcd"                # the Safe's address on this chain
      base:
        safe: "0x5678...ef01"

  treasury-merkle:
    backend: merkle
    executor: "${vault.merkleExecutor}"      # key that executes approved leaves
    chains:
      mainnet:
        safe: "0x9abc...def0"
        module: "0x1111...2222"              # the deploy module enabled on this Safe
```

The field-by-field tables live in [Field reference](#field-reference).

### Naming conventions

- **Entry names** follow the profile-name pattern from known-chains (`^[a-z][a-z0-9-]*$`), lowercase and hyphenated. Name entries by role (`ops-main`, `treasury-merkle`), not by address trivia.
- **Chain keys** under `chains:` must be names declared in [known-chains.md](known-chains.md) — the same referencing rule as everywhere else. An entry does not have to cover every known chain, but it must cover **every active chain of the run that selects it** (validation error otherwise).

### Credentials

The two credential slots follow the standard [secrets.md](secrets.md) rules — a single `${vault.X}` token (preferred) or `${env.X}` token (allowed), never a literal, always tagged and redacted:

- **`proposer`** (multisend backend) — a key registered as a **delegate** in the Safe Transaction Service. It can only *propose* transactions to the Safe's queue — it is not an owner, holds no approval power, and compromising it cannot move funds or deploy anything. The engine uses it to submit batches and to poll their status.
- **`executor`** (merkle backend; optional on multisend) — an ordinary funded EOA that pays gas to execute. On the merkle backend it is required: someone must execute the approved leaves, and that is the engine's job. On the multisend backend it is optional: when set, the engine auto-executes a batch as soon as the threshold is reached; when omitted, execution is left to whoever presses *Execute* in the Safe UI.

Safe **owner keys never appear anywhere in deploy-pad** — owners sign through their own wallets, outside the engine.

## Planning phase

Common to both backends. When the run starts in multisig mode, deploying steps do not broadcast — each one is **simulated as the Safe** and its transactions are captured:

- The engine sets two extra context variables on every step (alongside the usual `SYS_*` set): `SYS_MULTISIG=1` ("plan, don't broadcast") and `SYS_SENDER_ADDRESS=<safe>` (who to simulate as — this matters for anything `msg.sender`-dependent, most importantly the salt guarding of caller-namespaced CREATE3 flavors).
- `SEC_PRIVATE_KEY` is **not injected** during planning — nothing signs, so nothing needs a key. The plan's `secrets.privateKey` requirement for deploying steps is waived in multisig mode.
- **Bundled contract machinery complies automatically.** For `forge-contract` the bundled script runs as a Foundry dry-run with the Safe as the sender and the engine lifts the transactions from the dry-run record; for `hardhat2-contract` the bundled script builds the factory calldata itself (it already computes the creation code) and writes it out instead of sending. Authors configure nothing.
- **Author-written commands must opt in** — see [What action authors must do](#what-action-authors-must-do).

The captured transactions accumulate, in step order, into the run's **planned-transactions set** — the backend-agnostic artifact both backends consume.

### Predicted addresses and output flow

The reason planning can run ahead of execution: deterministic deployment methods derive the address from data that is known **before** the transaction lands.

- **`create3` / `factory: oneInch`** — address = factory + salt. Caller-independent; the switch from an EOA to a Safe does not move any address. Note the ownership protection: the Safe must be (or become) the factory's owner for `deploy` to succeed.
- **`create3` / `factory: createx` or `solady`** — address = factory + caller-namespaced salt. The caller is the Safe, so the predicted address depends on the Safe's address from the registry entry — and only that Safe can ever claim it. Vanity salts must be mined against the Safe's address.
- **`create2`** — address = deployer + salt + initcode hash, computable the same way.
- **`create`** — the address depends on the Safe's nonce at execution time. Predictable only if nothing else uses the Safe meanwhile; the engine predicts it from the Safe's current nonce plus the batch position and emits a validation **warning** that a concurrent Safe transaction would shift it. Prefer deterministic methods in multisig mode.

Each planned step writes its **predicted outputs** through the ordinary `.env.outputs` channel, so downstream mappings, nested workflows, and `contract-call` calldata building work unchanged — the whole workflow can usually be planned in one pass without touching the chain.

## The planned-transactions artifact

The contract between a planning step and the engine is one well-known file, written by the step's command into the run directory (`$SYS_RUN_DIR` — [engine-internals.md → The deployment interface](engine-internals.md#the-deployment-interface); the engine deletes it before the run and reads it in the collect phase — the same discipline as `.env.outputs`):

```json
// .deploy-pad-transactions.json
{
  "transactions": [
    {
      "to": "0xFactory...",
      "value": "0",
      "data": "0x...",                          // full calldata — bytecode embedded
      "description": "deploy AquaRouter via CREATE3 (salt: aqua-v1)"
    }
  ]
}
```

- **Order matters** — the array order is the execution order, and step order defines cross-step order.
- **`data` is self-contained.** A contract deployment through a factory is `deploy(salt, creationCode)` calldata; the compiled bytecode plus ABI-encoded constructor args travel inside it. There is no separate bytecode channel.
- **`description` is for humans** — it feeds the [proposal report](#what-signers-review) that owners review before signing. Optional but strongly recommended.
- The format is deliberately **backend-agnostic**: the same artifact is wrapped into a MultiSend batch or hashed into Merkle leaves. It is also the export surface — see the offline fallback under the multisend backend.

A planning step still writes `.env.outputs` (with predicted values) — the two files answer different questions: *what will exist* vs. *what must be executed*.

## Batches and boundaries

By default the engine puts **the whole run on a chain into one batch** — that is the entire point (one signature ceremony per chain on multisend; one leaf sequence on merkle). A batch is cut only at a **semantic boundary**: a point where planning cannot continue until the transactions so far have actually executed.

Boundaries arise when a step must **read the chain** and the data it reads is created earlier in the same pending batch — the canonical case is a `contract-call` step with `mode: call` against a contract whose deployment is still unexecuted, or an author command that inspects on-chain state. Everything before the boundary becomes batch 1; the run pauses for its approval and execution; planning then resumes for the remainder. Purely address-based dependencies (constructor args, `mode: send` targets) do **not** create boundaries — predicted addresses cover them.

**No automatic chunking by gas.** A batch executes as a single transaction on the multisend backend, so it must fit that chain's per-transaction limits (block gas limit, node transaction-size limit). The engine estimates the batch during planning, and if it does not fit, the run **fails at planning time** — the error names the batch, the estimate, and the limit, and recommends switching the registry entry to `backend: merkle`, where each leaf is its own transaction and no such limit exists. The engine never silently splits a batch to make it fit: batch composition is part of what the owners sign, and it should be deliberate.

## Backend: `multisend`

The zero-custom-code backend, built entirely on standard Safe infrastructure.

1. **Wrap** — the batch's transactions are encoded into one Safe MultiSend transaction.
2. **Propose** — the engine submits it to the chain's **Safe Transaction Service** using the `proposer` delegate key. The batch appears in the Safe's queue exactly like a manually created transaction.
3. **Sign** — owners review and sign in the Safe UI (or any Safe-compatible wallet), asynchronously, in any order, until the threshold is met. One signature per owner **per batch per chain** — the signature cost of a launch is `chains × batches`.
4. **Execute** — when the threshold is reached: the engine executes with the `executor` key if one is configured, otherwise anyone (typically an owner) executes from the Safe UI. The engine polls the service either way.

Properties to be aware of:

- **Atomic batch.** MultiSend reverts wholesale if any inner call reverts — no partial deployment state. The flip side: a revert means a fresh proposal and a fresh signature round for the (fixed) batch.
- **Sequential nonces.** Each batch occupies one Safe nonce. Multiple batches can collect signatures in parallel but execute strictly in order; an unexecuted batch blocks the queue behind it.
- **Fits-in-one-transaction limit** — see [Batches and boundaries](#batches-and-boundaries). Planning fails rather than splitting; the recommended escape is the merkle backend.
- **Offline fallback.** On a chain with no Safe Transaction Service, the engine cannot propose or poll. It instead **exports** the batch as a Safe Transaction Builder JSON file into the run's results directory and pauses; owners import it into the Safe UI manually, and a later resume detects execution on-chain (by code appearing at the predicted addresses).

## Backend: `merkle`

The one-signature-for-everything backend, for runs where `chains × batches` ceremonies is unacceptable or a batch cannot fit in one transaction.

1. **Build the tree** — every planned transaction of the run, across **all chains and all batches**, becomes a leaf. Leaves carry the chain id and an execution index, so per-chain ordering is enforced on-chain. The tree layout follows the Sphinx Merkle-tree specification.
2. **Sign the root** — owners sign a single EIP-712 message over the root. **One signature per owner for the entire launch**, regardless of how many chains or transactions it spans.
3. **Execute leaves** — the engine's `executor` key submits leaves one by one (each leaf is its own on-chain transaction) through the **deploy module** enabled on the Safe. The module verifies the signed root, the leaf's proof, and the ordering — the executor can neither reorder, skip, nor substitute anything; it only pays gas.
4. **Resume-friendly by construction** — execution progress is on-chain state. An interrupted executor picks up at the next unexecuted leaf; there is no atomicity cliff and no per-transaction size coupling (a batch of any size is fine — it is just more leaves).

The module is the trust-critical piece: an enabled Safe module executes without per-transaction owner signatures, so a module bug is a Safe compromise. deploy-pad **reuses the audited Sphinx module contracts** (MIT-licensed; see [design-decisions.md → Multisig execution backends](design-decisions.md#multisig-execution-backends-multisend-first-merkle-second)) rather than shipping its own. Operationally the module is one more per-chain contract to deploy and enable on the Safe — the same model as the CREATE3 factories deploy-pad already manages; its per-chain address is the `module` field of the registry entry.

**Cancellation:** an approved root that should not (fully) execute is cancelled by signing a replacement root — also a Sphinx-spec mechanism. The engine surfaces this as a `--multisig-cancel` follow-up invocation recorded in the deployment like any other attempt.

## Lifecycle & resume

Multisig mode adds a **waiting** phase to the run lifecycle, and leans on the existing deployment-id resume model from [plans.md → Deployment id & re-runs](plans.md#deployment-id--re-runs) — a run waiting for signatures is simply an *unfinished deployment*.

Step/batch progression:

| Status | Meaning | Recorded where |
|---|---|---|
| `planned` | Transactions captured, predicted outputs recorded. | `run-N.yaml` (per step: predicted `outputs`, planned transactions) |
| `proposed` | Batch submitted — a Safe Transaction Service proposal (multisend) or a root awaiting signatures (merkle). | `run-N.yaml` (per batch: `safeTxHash`, or the Merkle `root`), `deployment.yaml` (registry entry name) |
| `executed` | The batch's transactions landed on-chain. | `run-N.yaml` (execution tx hashes) |
| `collected` | Post-execution pass done — outputs confirmed, artifacts persisted, verification run. | `run-N.yaml`, `result.yaml` |

The flow across invocations:

- **First invocation** plans, proposes, and — if signatures don't arrive while it waits — **exits cleanly in the waiting state**, printing what is pending and where to sign. Signature collection takes hours or days; the engine does not have to stay alive for it.
- **Any later invocation** under the same deployment id (the normal auto-resume) re-checks: it polls the Transaction Service / the chain, advances whatever became executable, runs the post-execution pass for executed batches, and either finishes or reports the still-pending state. Each invocation is another `run-N.yaml` attempt, as usual.
- **Idempotency** interacts naturally: a `collected` step is a completed step; replay rules from [engine-internals.md → Idempotency lookup](engine-internals.md#idempotency-lookup) apply unchanged. A `planned`/`proposed` step is *not* complete — resuming re-verifies the proposal rather than re-planning it (re-planning would produce a different batch than the one owners may have already signed; the recorded `safeTxHash`/root is authoritative). This is one instance of the general resume rule — a resumed deployment runs against its records: the frozen parameter set, the recorded chain list, and the structural fingerprint ([phase 4 → The parameter freeze](../architecture/phase-4-deployment-resolution.md#the-parameter-freeze-on-resume)).

## Post-execution: collect & verification

Once a batch executes, the engine runs the second half of each affected step:

- **Collect** — confirmation is cheap because everything was predicted: the engine checks that code exists at each predicted address (and that the execution transaction succeeded). Predicted outputs are promoted to confirmed outputs in `result.yaml`; artifacts staged at planning time (ABIs from the local build) are persisted to `workspace/results/.../artifacts/<step_id>/`.
- **Verification** moves out of the execute phase. In eoa mode verification is inline (`SYS_VERIFY=1` during the command run — [engine-internals.md → Verification](engine-internals.md#verification)); in multisig mode nothing is deployed while the command runs, so `SYS_VERIFY` is never set during planning. Instead, the engine runs a **verify-only pass** after execution for every deploying step with the verification gates on, using the bundled verification machinery of the step's type against the confirmed address. For bundled contract types this is fully automatic. For author-command deploying steps the engine cannot re-invoke the author's inline verification path — see [Limitations](#limitations--non-goals).

## What action authors must do

- **Bundled contract types** (`forge-contract`, `hardhat2-contract`) — nothing. The bundled machinery plans, predicts, and writes both files itself.
- **`contract-call`** — nothing. `mode: send` steps are planned in-process (the engine builds the calldata it would have sent — the target and args are known from predicted outputs); `mode: call` steps stay read-only and execute normally, subject to the [boundary rule](#batches-and-boundaries).
- **Author-command deploying types** (`make`, `forge-script`, `hardhat2-script`, `hardhat3-script`, `script` with `deploys: true`) — opt in with **`supportsMultisig: true`** on the action, and make the command honor the planning contract:
  - When `SYS_MULTISIG=1`: **do not broadcast anything.** Simulate as `SYS_SENDER_ADDRESS`, write the would-be transactions to `.deploy-pad-transactions.json` (in order), and write **predicted** values for every declared output to `.env.outputs`.
  - Expect no `SEC_PRIVATE_KEY` and no `SYS_VERIFY` in this mode.
  - When `SYS_MULTISIG` is unset, behave exactly as before — the flag is the only switch.
- A deploying step whose action lacks `supportsMultisig: true` **fails validation at planning time** (error naming the step and the action) — it never gets halfway. Non-deploying steps that don't touch the chain run unchanged in either mode.

## What signers review

A MultiSend blob (or a Merkle root) is not human-readable, and asking owners to sign opaque bytes defeats the point of a multisig. For every proposal the engine emits a **proposal report** into the results directory — one entry per transaction:

```
batch 1 of 1 — mainnet — safeTxHash 0xabcd…
  1. deploy AquaRouter        via CREATE3 (oneInch)   → 0x7f3B…E2   salt "aqua-v1"
  2. deploy SwapVM            via CREATE3 (oneInch)   → 0x91c4…0a   salt "swapvm-v1"
  3. call   AquaRouter.setVM  (0x91c4…0a)
```

plus the exact hash the wallet will display (`safeTxHash` on multisend; the EIP-712 root digest on merkle). The review procedure for owners is: check the report reads as expected, check the hash in the wallet matches the hash in the report, sign. On the merkle backend the report covers the whole launch (all chains) under the single root.

## Limitations & non-goals

- **Signature cost on multisend is `chains × batches`.** That is inherent to Safe transactions being per-chain, per-nonce objects. When it hurts, use the merkle backend — that is precisely its reason to exist.
- **A batch must fit in one transaction on multisend** — no automatic splitting; planning fails with a recommendation to switch backends.
- **Chain-state-dependent steps split batches.** A step that must read what an earlier planned transaction creates forces a boundary and therefore an extra ceremony (multisend) between the parts. Purely address-wired workflows plan in one piece.
- **Plain `create` in multisig mode is fragile** — the predicted address depends on the Safe's nonce staying untouched between planning and execution. The engine warns; prefer `create2`/`create3`.
- **Hardhat 3 types are not supported in multisig mode** (`hardhat3-contract`, `hardhat3-module`): Ignition owns its own execution plan and offers no dry-run transaction extraction for the engine to capture. A workflow containing them fails multisig-mode validation.
- **Inline verification of author-command steps doesn't transfer.** The engine's verify-only pass covers bundled contract types; an author-command step verifies in multisig mode only if the author ships a separate verification path the engine can call — otherwise the step completes with a verification warning.
- **The engine holds no owner keys and implements no signing UI.** Signature collection is the Safe ecosystem's job (Safe UI, hardware wallets); deploy-pad only proposes, polls, reports, and executes.

## Relationships to other configs

| Other config | Relationship |
|---|---|
| [plans.md](plans.md) | Nothing multisig-related lives in a plan. The sender mode is a run parameter (`--multisig <name>`), like the deployment id. In multisig mode the `secrets.privateKey` requirement for deploying steps is waived (planning signs nothing). |
| [known-chains.md](known-chains.md) | Chain keys under an entry's `chains:` block must be names declared there. RPC access during planning/polling uses the plan's selected RPC profiles as usual. |
| [global-params.md](global-params.md) | The `proposer` / `executor` values are `${vault.X}` refs resolved against the vault registry — multisig.yaml is a vault consumer alongside plan secrets, known-chains credentials, and `repository.auth`. |
| [secrets.md](secrets.md) | The credential rules for `proposer` / `executor` (single-token vault/env refs, tagging, redaction). Owner keys are out of scope by design. |
| [workflows.md](workflows.md) | Deploy methods and CREATE3 factory flavors resolve exactly as in eoa mode; the flavor determines whether predicted addresses depend on the Safe's address (caller-namespaced salts) or not (`oneInch`). |
| [actions.md](actions.md) | The `supportsMultisig` opt-in flag on author-command deploying actions; bundled contract types and `contract-call` need nothing. |
| [engine-internals.md](engine-internals.md) | The [deployment interface](engine-internals.md#the-deployment-interface) that planning mode extends (its table carries the `SYS_MULTISIG` / `SYS_SENDER_ADDRESS` / `.deploy-pad-transactions.json` entries), the [verification gates](engine-internals.md#verification) the post-execution verify-only pass reuses, and the [idempotency lookup](engine-internals.md#idempotency-lookup) the resume rules build on. This doc owns the multisig-specific semantics themselves (planning contract, batches, statuses, verify-only pass). |
| [design-decisions.md](design-decisions.md) | The backend decision record — why both backends exist, why multisend ships first, why the merkle module reuses Sphinx. |

## Validation rules & common errors

### Registry shape (load time)

- **Entry names** must match `^[a-z][a-z0-9-]*$`; **chain keys** must be declared in known-chains.
- **`backend`** must be `multisend` or `merkle`.
- **`proposer` / `executor` value form** — a single `${vault.X}` or `${env.X}` token; literals and inline mixing are rejected by schema. `${vault.X}` lookups are always strict.
- **Per-backend required fields** — `multisend` requires `proposer`; `merkle` requires `executor` and a `module` address on every chain. Fields of the other backend (e.g. `module` on a multisend entry) are rejected by schema — an entry describes one backend, fully.
- **`safe` required** on every chain of every entry.

### Selection and planning (run time)

- **`--multisig <name>` with an unknown entry name** — error at load, listing the names the mounted file declares.
- **The entry doesn't cover an active chain** — error naming the chain and the entry (the entry must have a `chains.<c>` block for every chain the run targets).
- **Resuming with a different mode or entry** — error naming the entry recorded in `deployment.yaml`; pass the same `--multisig` selector, or `--restart`.
- **A deploying step's action lacks `supportsMultisig: true`** (author-command types) — planning-time error naming the step and action.
- **A Hardhat 3 deploying step in the workflow** — planning-time error (unsupported in multisig mode).
- **Batch exceeds one-transaction limits (multisend)** — planning-time error with the gas/size estimate and the limit, recommending `backend: merkle`.
- **Merkle entry whose `module` has no code on-chain** (or is not enabled on the Safe) — pre-proposal error naming the chain, the module address, and the Safe.
- **A planning step wrote no `.deploy-pad-transactions.json`** (or a declared output is missing from `.env.outputs`) — step failure, same rule as the missing-outputs rule in eoa mode.

### Common authoring mistakes

- Putting the Safe address or the backend choice in a plan preset. There is no plan surface for multisig — the registry entry carries the data, the CLI carries the choice.
- Putting an **owner** key in `proposer` or `executor`. Neither role needs owner powers: the proposer is a queue-only delegate, the executor only pays gas. Owner keys never enter deploy-pad.
- Expecting the engine to wait for signatures. It exits in the waiting state; re-run (same deployment id) to poll and continue.
- Mining a vanity salt for a `createx` / `solady` step against the EOA and then launching with `--multisig`. Caller-namespaced salts bind to the sender — re-mine against the Safe's address.
- Re-planning after owners signed: editing the plan and re-running does not mutate a `proposed` batch — the signed hash is authoritative. Cancel/abandon the proposal (or `--restart` the deployment) to plan afresh.
- Forgetting to transfer the CREATE3 factory's ownership to the Safe for `factory: oneInch` steps — the batch reverts at execution with the factory's owner check.

## Field reference

### Top-level fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `version` | integer | no (warns if missing) | — | Config format version this file is written against (current: `2`). Same rules as every config file — see [engine-internals.md → Config version check](engine-internals.md#config-version-check). |
| `multisigs` | map<entryName, MultisigEntry> | yes | — | The registry — named, self-contained multisig entries. At least one entry. |

### `MultisigEntry` fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `backend` | string | yes | — | Execution backend: `multisend` (Safe Transaction Service batches) or `merkle` (root signature + Safe module). Determines which of the fields below apply. |
| `proposer` | string | multisend: yes | — | Delegate key for proposing to the Safe Transaction Service. Single `${vault.X}` (preferred) or `${env.X}` token; tagged as a secret. Not an owner key. Rejected on `merkle` entries. |
| `executor` | string | merkle: yes; multisend: no | — | Key that executes on-chain (leaves on merkle; threshold-met batches on multisend when auto-execution is wanted). Single `${vault.X}` / `${env.X}` token; tagged as a secret. Pays gas only — holds no approval power. |
| `chains` | map<chainName, MultisigChain> | yes | — | Per-chain data. Keys must be known-chains names. Must cover every active chain of any run that selects this entry. |

### `MultisigChain` fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `safe` | string | yes | — | The Safe's address on this chain. The sender identity of every planned transaction (`SYS_SENDER_ADDRESS`). |
| `module` | string | merkle: yes | — | Address of the deploy module (Sphinx-based) enabled on this Safe. Rejected on `multisend` entries. |
| `transaction_service` | string | no | the chain's canonical Safe Transaction Service | Override for the Safe Transaction Service base URL (self-hosted service, or a chain outside the hosted set). `multisend` only. When the chain has no service at all, omit it and rely on the offline export fallback. |

### CLI surface

The full flag reference (including the flags shared with eoa mode) is in [cli.md](cli.md); the two multisig-specific flags:

| Flag | Applies to | Description |
|---|---|---|
| `--multisig <name>` | `run` | Selects the registry entry and switches the run to multisig mode. Omitted = eoa mode. Recorded in `deployment.yaml`; resume must repeat it. |
| `--multisig-cancel` | `run` | Merkle backend: propose a cancellation root for the deployment's pending root (recorded as another attempt). Multisend: withdraw pending proposals from the service queue. |

The machine-readable schema is [packages/schemas/src/multisig.schema.yaml](../../packages/schemas/src/multisig.schema.yaml).

## Full example

A registry with one entry per backend — a `multisend` ops Safe (with a self-hosted Transaction Service override on one chain) and a `merkle` treasury Safe — see [examples/multisig.yml](examples/multisig.yml). The `${vault.X}` credentials there are looked up against the `vault:` block in [global-params.yaml](global-params.md#vault).

What you'll observe when runs select these entries:

- `yarn deploy-pad run -e aqua-plan --multisig ops-main` on `mainnet` + `base` plans the whole workflow per chain, proposes one MultiSend batch per chain via the Transaction Service (using `opsProposer` as the delegate), writes the proposal report, and exits waiting. Owners sign two hashes (one per chain) in the Safe UI; because `executor` is set, the next engine invocation executes both batches, confirms code at the predicted addresses, runs the verify-only pass, and completes the deployment.
- The same run with `--multisig treasury-merkle` builds one Merkle tree over both chains' transactions, asks owners for a **single** root signature, and then `merkleExecutor` walks the leaves chain by chain — no Transaction Service involved, no per-transaction size ceiling.
- On `cronos`, `ops-main` talks to the self-hosted service URL. If that field were removed (and cronos has no hosted service), the engine would export a Transaction Builder JSON instead and wait for a manual import + execution.
- The vault refs resolve against [global-params.yaml](global-params.md#vault) at load; the resolved keys are tagged — `SEC_`-injected where needed, redacted in `deployment.yaml`, `run-N.yaml`, and logs.

## Open questions

All three items below were reviewed and **deliberately deferred** until a real workflow hits their case — the deferral (and its consequence for the engineering design: treat these as extension points, don't design the features) is recorded in [design-decisions.md → Multisig deferrals](design-decisions.md#multisig-deferrals-batch-barriers-proposal-staleness-multi-safe).

- **Boundary declaration.** Semantic batch boundaries are engine-detected for `contract-call` reads, but an author command that reads the chain internally is invisible to the engine. A per-step `barrier: true` hint (force a boundary before this step) may be needed once real workflows hit the case.
- **Proposal expiry / staleness.** A `proposed` batch signed weeks later executes against a chain that moved on. The predicted addresses stay valid (deterministic methods), but gas prices and factory ownership may not. A staleness warning on resume (proposal older than N days) is a cheap addition.
- **Multi-Safe runs.** One registry entry = one Safe identity across chains. A launch where different chains use different Safes fits the current shape (per-chain `safe` values differ), but a launch where *steps within one chain* alternate between Safes does not — deferred until a real need shows up.
