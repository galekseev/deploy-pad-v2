# Test strategy

What is tested at which level, how a test is tied back to the requirement it proves, and which guarantees get a test whether or not anyone remembers to ask for one.

> **Status:** Draft, written before the first slice.
> **Audience:** engineers writing tests, and reviewers deciding whether a slice is done.

---

## The asset this strategy is built around

Most projects start by inventing a definition of "correct". This one already has [~250 numbered, traceable requirements](../requirements.md) and [thirteen quality scenarios written as stimulus-and-response](../architecture/arc42.md#102-quality-scenarios). That changes what the test suite is for: it is not a safety net bolted on afterwards, it is the executable form of a document that already exists.

Two consequences run through everything below. A test **names the requirement it proves**, so coverage is measurable against the specification rather than against lines of code. And a requirement that no test names is either not yet delivered or a gap — the traceability check makes the difference visible instead of leaving it to memory.

## The four levels

The boundaries matter more than the names: a case tested at the wrong level is either slow for no reason or fast and proving nothing.

**Unit — pure functions, no I/O.** The value machinery is where the subtle bugs live and where they are cheapest to catch: the transform and combine axes with their arity rules, salt normalisation and derivation, fingerprint canonicalisation, redaction rendering including fragment-level vault labels, output-name-to-JSON-key conversion (FR-CFG-008), the version comparison. These run in milliseconds and should carry the bulk of the case count.

**Contract — artifacts against the documents that define them.** Every example in `docs/specs/examples/` validates against its schema. Every record the engine writes validates against its record schema, plus a golden file per record kind so a field silently disappearing is a visible diff. The generated raw-config types regenerate with no diff. The exit-code enum matches the table in [cli.md](../specs/cli.md#exit-codes). This level exists because the doc set is the source of truth (OC-1) and drift between a document and the code is exactly what nobody notices.

**Integration — the real thing, offline.** A full `run` against a local anvil, with git fixtures as local bare repositories rather than network remotes, and a foundry project as the fixture repo. This is where the deployment interface, the records tree, resume, and the chain modes are proven. Slow, few, and each one earns its place by covering a path no cheaper level can reach.

**CLI — argv in, exit code out.** The flag matrix driven as a table over every cell, both directions: accepted where [the matrix](../specs/cli.md#flags-by-command) marks it, exit `1` where it does not. Output snapshots at each `--log-level`, including that `silent` prints exactly nothing. Cheap, and it covers a requirement class (FR-CLI-006) that is otherwise easy to leave to a code review.

## Traceability

**Naming.** A test title carries the requirement id in brackets: `it('[FR-CHN-012] rejects an unknown chain name at load', …)`. Ranges are never written into a title — one id per test, several tests per requirement where the requirement has several clauses.

**The machine-readable slice list.** `test/traceability/slices.yaml` maps each delivered slice to the exact requirement ids it claims. The prose acceptance lists in [delivery-plan.md](delivery-plan.md) are the human view and may use ranges; this file is what the check reads, and it is authoritative.

**The check.** A script parses the requirement catalog out of [requirements.md](../requirements.md), collects the ids named in test titles, and reports three sets: covered, claimed-but-uncovered, and not-yet-claimed. **Claimed but uncovered fails CI.** Not-yet-claimed is printed as information — it is the honest measure of how much of the specification exists in code, and it is expected to be large for a long time.

The check is also a cheap way to catch a typo in a requirement id, since an id that appears in no test *and* in no catalog is reported as unknown.

## Fixtures

**Config sets** live in `test/fixtures/configs/<case>/` as complete mounted directories — the same shape `--configs-dir` expects, because the mount is the unit the engine reads and a fixture that is not a real mount tests a shape that never occurs. Each case is minimal: one chain, one action, one preset, and only the file under test made interesting.

The files in `docs/specs/examples/` double as fixtures. They are the worked examples the specs point authors at, so keeping them loadable is worth a test in its own right.

**Git remotes** are created as bare repositories in a temporary directory, with a couple of commits, a tag and a branch. Offline, deterministic, and fast enough to build per test file. Private-repo behavior is tested against a bare repo behind a credential helper stub, which is what makes the token-leak assertions below meaningful.

**Chains** are a local anvil with a fixed mnemonic, spawned per integration file. Unit-level chain interaction — preflight verdicts, chain identity mismatch, RPC failure classification — uses a mock JSON-RPC transport instead, because those cases are about the engine's reaction, not about the EVM.

**Non-determinism is injected, never tolerated.** The clock, the run-attempt numbering and `${random.N}` come from seams the tests replace. Tests assert the *properties* the specs state — that a random value is generated once and persisted into the frozen set, that a derived salt is identical across chains — never a specific random string.

## The guarantees that always get a test

Three requirement classes are absolute, so their tests are structural rather than case-by-case.

**No secret in any output (NFR-003, FR-SEC-011).** Every fixture credential is a unique canary string. After any test that runs the engine, a shared assertion walks everything the run produced — the results tree, both log sinks, `.env.automation` and every other writer output, the captured subprocess argv — and fails if the canary appears anywhere. It is a helper called from every integration test rather than one test of its own, because the requirement is about *every* output path, and a single dedicated test would only prove the paths its author remembered.

**No credential trace from repository authentication (FR-ACT-011, NFR-031).** After a private-repo clone: the token is absent from `.git/config`, from the remote URL, from every file in the checkout, and from the captured argv of every git invocation. Injection is per process and ephemeral, so the test asserts absence in four places rather than trusting one.

**No secret reaches a preflight check (FR-RUN-005a).** The serialised check context contains no tagged value, and the check subprocess environment contains no `SEC_*` variable. Asserted on the context the scheduler actually builds, not on a hand-written sample.

## The packed artifact

Before every release, and on every pull request that touches packaging: `pnpm pack`, install the tarball into a clean directory outside the workspace, run `deploy-pad --help`, and validate an example config through the installed binary. It catches an undeclared dependency, a file missing from `files`, and a broken `exports` map — the class of failure that never reproduces inside the monorepo, where everything resolves through the workspace.

## What stays manual

Two integrations are not worth faking convincingly and cannot be run honestly in CI:

- **The Safe Transaction Service.** Mocked at the HTTP boundary for the multisig tests, with one written runbook for a real end-to-end rehearsal on a testnet Safe before the multisig slice ships.
- **Block explorer verification.** Mocked per dialect (`etherscan`, `blockscout`, `sourcify`) for gating and error-path tests. Whether a real explorer accepts our source bundle is a question only a real explorer answers, so it belongs in the same rehearsal.

Both are recorded as manual steps in the slice that introduces them, not as gaps in the suite.

## CI shape

Four jobs, ordered by how fast they fail:

1. **Static** — typecheck, lint, and the generated-types no-diff check.
2. **Fast tests** — unit and contract levels, plus the CLI level. No network, no anvil, no foundry.
3. **Integration** — with foundry and anvil installed; the slowest job and the only one that needs system tooling.
4. **Traceability and packaging** — the requirement coverage check and the packed-artifact smoke test.

Node 24 is the baseline; a second matrix entry follows the next LTS line as it arrives, because the engine's own runtime claim (`engines.node: ">=24"`) is a promise to users that only a matrix keeps honest.
