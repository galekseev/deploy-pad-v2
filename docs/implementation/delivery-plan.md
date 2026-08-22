# Delivery plan

The order the engine gets built in, as ten slices with acceptance criteria expressed in requirement ids.

> **Status:** Draft. The slice list is stable in shape; scope moves between neighbouring slices as reality intervenes, and that is expected — what should not move is the acceptance criteria of a slice already declared done.
> **Audience:** whoever picks up the next piece of work.

---

## Why not phase 1 through phase 8

The eight run phases are an **execution** order, not a build order. Implemented front to back, nothing is runnable until phase 7 lands: the first six phases produce artifacts for each other and nothing a user can invoke. Six phases of unexercised code is also six phases of untested assumptions about the artifact contracts, all discovered at once.

So the slices are vertical where they can be. The first three produce a real, useful tool — a validator for the config set — long before anything touches a chain. `validate` is not a stepping stone here: it is the command config authors will use most, and it is [phases 2 and 3 run to completion and stopped](../specs/cli.md#validate), so building it *is* building the front half of the run.

| Slice | What becomes usable | Phases |
|---|---|---|
| S0 | The repository builds, publishes and logs | — |
| S1 | `deploy-pad` parses every command and refuses every bad invocation; `list` | 1 |
| S2 | `validate` catches shape and version errors | 2 (gates 1-2) |
| S3 | `validate` catches everything a file can prove | 2 (gates 3-4) |
| S4 | `--dry-run` prints the execution plan | 3 |
| S5 | A contract actually deploys, and the records prove it | 4, 6, 7, 8 |
| S6 | Interrupted deployments resume; `status`, `report` | 4 (resume), chain modes |
| S7 | The other nine action types, verification, CREATE2/CREATE3 | 7 |
| S8 | Preflight checks and `engine.yaml` | 5 |
| S9 | Multisig through a Safe | 7 (multisig branch) |

---

## S0 — Scaffold

**Goal.** A repository that builds, tests, publishes and logs, with nothing engine-specific in it yet.

**Scope.** pnpm monorepo with `packages/schemas` and `packages/engine` ([stack.md §4](stack.md#4-repository-layout)). TypeScript, eslint, vitest configuration. The `deploy-pad` bin and its `--env-file` wrapper (FR-CLI-003). The logger with its two sinks and the redactor seam (FR-CLI-004, NFR-003) — the redactor has nothing to redact yet, but every later slice must have exactly one place to add to, which is also why the eslint rule keeping `console.*` out of every other module lands here rather than after the first violation ([stack.md §7](stack.md#7-logging-and-redaction)). `Diagnostic`, `DiagnosticCode` and `ExitCode` from [artifacts.md §8](artifacts.md#8-cross-cutting-types). CI running typecheck, lint, tests and the packed-artifact smoke test. Release wiring with the two packages versioned in lockstep, published to the public registry with provenance ([stack.md §8](stack.md#8-build-and-release)).

The schemas also physically move in this slice: `docs/specs/schemas/*.schema.yaml` into `packages/schemas/src/`, with the links in the seven config specs and the modelines in `docs/specs/examples/*.yml` repointed. Done here rather than later so that no slice ever has two copies to keep in sync.

**Acceptance.** `deploy-pad --help` runs from a tarball installed into a clean directory. CI is green on a pull request. Every example file still resolves its schema in the editor. The exit-code enum matches [cli.md](../specs/cli.md#exit-codes) exactly.

**Not in scope.** Any config reading whatsoever.

## S1 — Phase 1 and `list`

**Goal.** Every invocation the CLI will ever see is either accepted into a run context or rejected with exit `1`.

**Scope.** Command dispatch and the per-command flag matrix ([cli.md](../specs/cli.md#flags-by-command)) built so that a flag outside a command's column cannot be represented, per [artifacts.md §1](artifacts.md#1-runcontext). The frozen `RunContext`. All six phase-1 failure modes. `list`, reading the mount shallowly to enumerate workflows, actions and plans.

**Acceptance.** FR-CLI-001, FR-CLI-002, FR-CLI-004, FR-CLI-006, FR-RUN-002 and FR-CLI-032. A table-driven test over the flag matrix: every cell asserted in both directions — accepted where marked, exit `1` where not. `status --multisig ops-main` and `report --restart` fail before anything is read.

**Not in scope.** Everything config-dependent, deliberately: an unknown preset, a chain outside the resolved set, a nonexistent plan file all belong to later phases so that `validate` can report them together. `--chain-mode` is parsed and its value validated here; the semantics arrive in S6. `list` runs without schema validation until S2.

## S2 — Validation gates 1 and 2

**Goal.** `validate` tells an author their file is the wrong shape, in one pass, with every error at once.

**Scope.** ajv over `@deploy-pad/schemas`, `allErrors` on. Generation of raw config types from the schemas, wired into the build. The config version gate and `--ignore-version`. Diagnostic rendering with the JSON Pointer into the offending node.

**Acceptance.** FR-CFG-010 through FR-CFG-015, FR-CLI-020, FR-CLI-021 and NFR-022. A version mismatch exits `1`, a schema violation exits `2`, matching the [failure model](../architecture/run-lifecycle.md#failure-model). The conformance test from [test-strategy.md](test-strategy.md) validates every file in `docs/specs/examples/` against its schema — the first test that would have caught a schema and its documentation drifting apart.

## S3 — Phase 2 complete

**Goal.** `validate` catches everything a file can prove without touching the network.

**Scope.** Referential validation across files: action and workflow references, prior-step rules, cycles, chain names, pin selectability, multisig chain coverage. Chain resolution against the registry including chain sets. Preset selection and the fallback ladder. Deployment override merge. The ten-step value resolution in its fixed order, all six namespaces, per chain. Vault resolution with secret tagging at the load layer. The `strict` flag and its narrow non-strict tolerance.

**Acceptance.** FR-CHN-001 through FR-CHN-034, FR-GLB-001 through FR-GLB-014, FR-REF-001 through FR-REF-032, FR-SEC-001 through FR-SEC-014, FR-PLN-001 through FR-PLN-052 and FR-WFL-005. NFR-003 gets its first executable test here, against the diagnostic output and the log sinks — the moment secrets first exist in memory is the moment the redaction test has to exist.

**Not in scope.** Anything about steps: wiring, methods and salts are phase 3.

## S4 — Phase 3 and `--dry-run`

**Goal.** The operator can see exactly what would run, per chain, before anything runs.

**Scope.** Flattening of nested workflows with dotted step ids and mapping composition. Method variant resolution through its precedence ladder. The production pipeline: `pick`, per-source transforms, `combine`, the action's authoritative transform. Required-data checks with the salt ladder and its warnings. The structural fingerprint. `--dry-run` output including predicted deterministic addresses where computable and the expanded chain list.

**Acceptance.** FR-WFL-010 through FR-WFL-051, FR-PLN-060 through FR-PLN-065, FR-RUN-004, FR-RUN-030 and FR-ACT-040 through FR-ACT-046. Single-action plans (FR-PLN-070 through FR-PLN-075) go through the same path as a one-step workflow, which is the cheapest way to prove the inline form is not a special case.

## S5 — First vertical slice to a chain

**Goal.** One contract deploys to one chain, and the results tree alone explains what happened.

**Scope.** Narrow on purpose: `forge-contract` only, method `create`, EOA sender, one chain, `sequential`. Phase 6 for a single pin (clone, checkout, install, build). Phase 4 for fresh deployments only, writing `deployment.yaml` and `config_snapshot.yaml`. Phase 7's step lifecycle: enrich, write, execute, collect, cleanup, with the per-chain run directory and the deployment interface. Phase 8: `run-N.yaml`, `result.yaml`, artifacts, `summary.json`, the printed summary, the exit code. The machine-readable record schemas — which the doc set does not have — are authored here and go into the schemas package, because the editor will read records.

**Acceptance.** FR-RUN-006, FR-RUN-007, FR-RUN-008, FR-RUN-020, FR-STP-001 through FR-STP-013, FR-PLN-030 through FR-PLN-032. The integration test deploys to a local anvil and asserts the full records tree, including that no secret appears anywhere in it.

**Not in scope.** Resume (S6), other action types (S7), verification (S7), preflight (S8). Phase 4 refuses rather than resumes if it finds an unfinished deployment, so the gap is loud.

## S6 — Resume, `status`, `report`, chain modes

**Goal.** Re-running the same invocation continues where it stopped, and a reader can inspect a deployment without running anything.

**Scope.** The idempotency index rebuilt from attempt records. The three freezes: chain list, parameter set, structural fingerprint. `--restart` and `--refreeze`. Ordinal suffixing of taken ids. `status` and `report` reading only the results tree. The `continue` and `parallel` chain modes, with the chain-prefixed logging and the per-checkout mutex around the execute span.

**Acceptance.** FR-STP-030, FR-STP-031, FR-RUN-005b, FR-RUN-005c, FR-PLN-031, FR-RUN-010 through FR-RUN-014, FR-CLI-012, FR-CLI-030, FR-CLI-031, NFR-002 and NFR-012. Quality scenarios QS-2, QS-7, QS-8 and QS-10 from [arc42 §10.2](../architecture/arc42.md#102-quality-scenarios) become integration tests here — they are already written as executable statements.

## S7 — The remaining action types, verification, deterministic methods

**Goal.** The catalog the specs describe, not a subset of it.

**Scope.** `hardhat2-contract`, `hardhat3-contract`, `hardhat3-module`, the three framework script types, `make`, `script`, and in-process `contract-call`. Built-in command parameters. Verification gating, inline verification per selected profile, `--skip-verify` and `--verify-only`. `create2` and `create3` with all three factory flavors.

**Acceptance.** FR-ACT-020 through FR-ACT-023, FR-ACT-030 through FR-ACT-033, FR-ACT-050, FR-REF-040, FR-REF-041, FR-STP-020, FR-STP-021, FR-CLI-013 and FR-WFL-010 through FR-WFL-013. `create3` on a Hardhat 3 step is an error, per TC-7.

## S8 — Preflight

**Goal.** A run fails on a cheap read-only probe rather than after a repository build.

**Scope.** The phase-5 scheduler, the versioned `PreflightCheckContext` document at version 1, out-of-process execution with the backstop limit, severity and scope handling, the aggregate report. `engine.yaml` loading with wholesale replacement of the shipped default. The three shipped checks, compiled to JavaScript for publishing ([stack.md §1](stack.md#1-runtime-baseline-node-24-or-newer)).

**Acceptance.** FR-RUN-005a in full, exit code `6`, `--skip-preflight` recorded as a warning, and QS-4. A check receives no `SEC_*` variable and no secret-tagged value in its context — asserted, not assumed.

## S9 — Multisig, multisend backend

**Goal.** The same plan that deploys from a key on staging deploys through a Safe on production, with no config edit.

**Scope.** The planning contract and `.deploy-pad-transactions.json`, predicted outputs, batching at semantic boundaries, the multisend backend against the Transaction Service, the offline export fallback, the waiting state and exit `10`, the post-execution collect pass, the verify-only pass, the proposal report with the hash owners will see.

**Acceptance.** FR-MSG-001 through FR-MSG-046 except the merkle backend, plus QS-9. The engine holds no owner key anywhere in the code path (NFR-032).

**Deferred to a later slice.** The merkle backend, per assumption A-3 — settled design, sequenced second.

---

## What we lift from v1

The v1 engine (`~/git/deploy-pad`) is a reference implementation, not a base to refactor. It has eight test files across the engine, so anything moved without its test would move without a safety net. The modules worth lifting are exactly the tested ones:

| v1 module | Lands in | Note |
|---|---|---|
| `engine/core/flatten.ts` | S4 | Nested workflow flattening; the closest thing v1 has to phase 3. |
| `engine/pipeline/input-resolver.ts` | S4 | Input resolution; needs rewriting against the v2 transform axes but the cases carry over. |
| `engine/pipeline/array-mappings-shared.test.ts` | S4 | Array arity cases — useful as a test corpus regardless of the implementation. |
| `engine/utils/array-values.ts` | S4 | Array serialisation, matching FR-ACT-044. |
| `engine/utils/chain-rpc.ts` | S3 | Chain and RPC handling, to be reshaped around the v2 connection registry. |
| `engine/pipeline/components/writers/constructor-args-json.ts` | S5 | Writer for constructor args. |
| `engine/scripts/forge/*` | S5 | Bundled deploy machinery — the largest single lift, and the one that most repays being ported rather than rewritten. |
| `engine/scripts/hardhat/*` | S7 | Including the salt and tx-utils modules, which carry their own tests. |

Lifting means porting into v2 vocabulary and contracts with the v1 test as the starting corpus — never copying a file wholesale, and never copying one whose behavior no test pins down.

## Explicitly deferred

Listed so that none of it later looks like an oversight:

- **The merkle multisig backend** — settled design, sequenced after multisend (A-3).
- **A parallel-mode concurrency cap** (OI-7) and **finer mutex granularity** (OI-8) — both considered and deliberately rejected until real workloads argue otherwise.
- **The visual editor** (OC-3) — designed separately after the engine; the schemas package is the contract it will consume.
- **Migration from v1 config formats** (OI-1) — deferred as one coordinated sweep.
- **Install and build caching** — rejected deliberately in the phase-6 design; every invocation pays full prepare cost.
- **Two known gaps in the doc set**: the command execution pipeline section of the phase-7 design (TODO item 12) and the pluggable collector and verifier contracts. Neither blocks S0 through S4; both must be written before the slice that needs them — phase 7 work in S5 and S7 respectively. Writing them is part of that slice, not a separate errand.
- **A user guide on CREATE3 factory flavors** (A-4) — documentation work, tracked in [TODO.md](../TODO.md).

## When a slice is done

- Typecheck, lint and the full test suite pass, and the packed-artifact smoke test passes.
- Every requirement in the slice's acceptance list has at least one test naming it, verified by the traceability check in [test-strategy.md](test-strategy.md).
- Any spec gap the slice uncovered is fixed **in the spec first** — the doc set is the source of truth (OC-1), so code that disagrees with a spec is a bug in one of them, and which one is a decision, not a default.
- The slice's deferred items are written down here rather than left in a branch.
