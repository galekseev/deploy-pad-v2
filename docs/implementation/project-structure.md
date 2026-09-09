# Target project structure

Every directory the repository grows into, what belongs in each, and the rule that answers "where does this new file go" without a discussion each time.

> **Status:** Draft. The unmarked entries are what the delivered slices needed; the rest is a plan, and a slice tag marks the earliest slice that needs the directory rather than a promise about its contents. When a directory lands in a different shape than drawn here, this document is what needs correcting.
> **Audience:** engineers writing the engine, and reviewers deciding whether a file is in the right place.
> **Position in the doc set:** [stack.md §4](stack.md#4-repository-layout) decides *that* the repository is a two-package monorepo decomposed along the run phases, and why the published bin is a shim. This document is the map that follows from those decisions — where a contradiction exists, **stack.md wins**, because it owns the decision and this file only draws it.

---

## How to read the trees

| Marker in a comment | Meaning |
|---|---|
| none | Exists today. |
| `S2` … `S9` | Arrives with that slice of the [delivery plan](delivery-plan.md). |
| `generated` | Produced by a build; never edited by hand. |
| `untracked` | Machine-local, ignored by git. |
| `open point` | Not decided yet — §9 says what the decision is. |

## 1. The repository root

A file earns a place at the root by being read by a tool that looks only there. That is the whole selection rule, and it is what keeps the root readable as a list of entry points rather than a junk drawer.

```
deploy-pad-v2/
  package.json              # workspace root: the scripts, the pinned pnpm, the Node floor
  pnpm-workspace.yaml       # packages/*
  pnpm-lock.yaml
  .npmrc                    # engine-strict: an install on Node < 24 fails here, not at first run
  tsconfig.base.json        # the compiler settings of stack.md §2 — extended by every package
  tsconfig.json             # the typecheck-only project over src, test and scripts
  eslint.config.js          # including the console / process bans outside the logger
  vitest.config.ts          # both test homes (§5)
  README.md
  LICENSE                   # absent today — open point (§9)
  .github/workflows/
    ci.yml                  # four jobs, ordered by how fast they fail
    release.yml             # the two packages, versioned in lockstep, with provenance
  .vscode/settings.json     # yaml.schemas → the authored schemas, not a build artifact
  docs/                     # the design set — the source of truth (OC-1)
  packages/                 # §2, §3
  scripts/                  # repository checks
  test/                     # cross-package tests and fixtures — §5
  workspace/                # the default config mount and the run's own state — §6
```

**`scripts/` holds checks on the repository, never engine behavior.** One file per check, each invoked by a `pnpm run check:*` script *and* by exactly one CI job, so a check can never exist that only CI knows how to run:

```
scripts/
  check-versions.ts         # the schemas major equals the config format version, and both packages share it
  check-traceability.ts     # requirement ids in test titles against slices.yaml and requirements.md
  smoke-packed.ts           # pack, install outside the workspace, drive the installed binary
```

A check that needs engine code imports it from the package. Nothing here is published, and nothing here is a place for logic a phase should own.

## 2. `packages/schemas` — the config contract

The authored YAML is the only editable copy, and everything else in the package is downstream of it ([stack.md §6](stack.md#6-the-schemas-package)).

```
packages/schemas/
  package.json              # exports: *.yaml → src, *.json → dist, types → types
  tsconfig.build.json
  README.md                 # the npm page for the contract
  src/
    actions.schema.yaml         # the seven authored config schemas
    workflows.schema.yaml
    plans.schema.yaml
    known-chains.schema.yaml
    global-params.schema.yaml
    multisig.schema.yaml
    engine.schema.yaml
    schema-names.ts             # the exhaustive list — the generator, the editor settings and the contract test all read it
    format-version.ts           # CONFIG_FORMAT_VERSION, the single source of truth for the version gate
    index.ts
    records/                    # S5 — one schema per record kind (results.md); see §9
  scripts/
    generate-json.ts        # the JSON twin for consumers without a YAML parser
    generate-types.ts       # S2 — the raw config shapes
  types/                    # S2 — generated and committed: the raw config types (stack.md §6.1)
  dist/                     # generated, untracked: *.schema.json, *.js, *.d.ts
  test/                     # S2 — the package's own tests, when it has behavior beyond the lists
```

**A new config file is added in one place.** `schema-names.ts` is read by the generator, by the modeline contract test and by the editor settings, so adding a name there is what makes the new schema exist everywhere it needs to.

**Three directories, three lifecycles**, which is the one thing to keep straight here: `src/` is authored, `types/` is generated *and committed*, `dist/` is generated and disposable. The split exists because a fresh clone must type-check without running a generator while `dist/` stays deletable — [stack.md §6.1](stack.md#61-where-the-generated-types-live) has the reasoning.

## 3. `packages/engine`

```
packages/engine/
  package.json
  tsconfig.build.json
  README.md                 # absent today — open point (§9)
  bin/deploy-pad.js         # the published shim — plain JS by necessity (stack.md §4)
  src/
    main.ts                 # the executable entry: sets process.exitCode and returns
    cli.ts                  # argv in, exit code out — commander lives here and nowhere else
    index.ts                # the package entry: re-exports the module barrels
    version.ts
    commands/               # §3.1
    contracts/              # §3.2
    phases/                 # §3.3
    cross/                  # §3.4
    checks/                 # S8 — the three shipped preflight checks, compiled for publishing
  dist/                     # generated, untracked
  test/                     # §5
```

Four buckets under `src/`, and the boundary between them is what the code is *about* rather than what it looks like:

| Bucket | Holds | Never holds |
|---|---|---|
| `contracts/` | The phase artifacts and the cross-cutting types: type definitions plus the pure constructors and predicates that enforce their invariants. | I/O of any kind, or a rule that belongs to one phase's transformation. |
| `phases/` | One directory per run phase, owning the transformation from the previous artifact to its own. | Anything a second phase needs — that is a `cross/` candidate the moment it has two callers. |
| `cross/` | Concerns that must have exactly one implementation for a guarantee to hold. | General-purpose helpers (§7). |
| `commands/` | The CLI's own composition: which phases a command runs, and how its outcome is rendered. | Run behavior. A command orchestrates phases; it does not implement one. |

### 3.1 `commands/` — one file per command

```
    commands/
      index.ts              # dispatch: a run context in, an exit code out
      list.ts
      unimplemented.ts      # the placeholder each command below replaces as it lands
      validate.ts           # S2
      run.ts                # S5
      status.ts             # S6
      report.ts             # S6
```

Dispatch takes the `RunContext` artifact, not argv, and its io is injected rather than reached for — which is what makes every command runnable in-process (NFR-060). A command that starts reaching for `process.env` or a real stream has broken the property the directory exists to hold.

### 3.2 `contracts/` — one file per artifact

```
    contracts/
      index.ts
      exit-code.ts              # the closed set, asserted against the table in cli.md
      diagnostic.ts             # Diagnostic, DiagnosticCode, and the factories that supply the nulls
      freeze.ts                 # deepFreeze — every artifact is frozen when its phase returns it
      run-context.ts            # artifact 1
      tagged-value.ts           # S3 — the secret-channel wrapper
      resolved-plan.ts          # S3 — artifact 2
      execution-plan.ts         # S4 — artifact 3
      deployment-decision.ts    # S5 — artifact 4
      prepared-checkouts.ts     # S5 — artifact 6
      chain-outcomes.ts         # S5 — artifact 7
      preflight-clearance.ts    # S8 — artifact 5
```

The field-level shape of each is [artifacts.md](artifacts.md); the file names match its section titles so the document and the directory stay navigable from each other. Two things deliberately do **not** live here: raw config types, which are generated from the schemas, and record shapes, which [results.md](../specs/results.md) owns ([artifacts.md §9](artifacts.md#9-what-is-deliberately-not-here)).

### 3.3 `phases/` — one directory per phase, named for its number

The number is in the directory name because the run's phases are numbered everywhere else in the doc set, and a name would need translating at every link.

```
    phases/
      phase-1/                  # argv → RunContext
        index.ts
        parse.ts                # the per-command flag matrix, built so an absent cell cannot be represented
        normalize.ts
        context.ts              # the constructors: consistency rules live here, not in the parser
        plan-ref.ts
        set-arg.ts
      phase-2/                  # four gates → ResolvedPlan
        index.ts
        source.ts               # the config source seam: a mount, or a graph a caller supplies
        version.ts              # S2 — gate 1
        schema.ts               # S2 — gate 2, ajv over @deploy-pad/schemas
        referential.ts          # S3 — gate 3, everything a schema cannot see
        resolve/                # S3 — gate 4: the ten steps, six namespaces, per chain
      phase-3/                  # S4 → ExecutionPlan
        flatten.ts              # nested workflows, dotted ids, mapping composition
        variants.ts             # the method precedence ladder
        wiring.ts               # inputs as wiring: pick, transforms, combine
        required-data.ts        # the salt ladder, factory coverage, key slots
        fingerprint.ts          # canonicalisation and the hash
      phase-4/                  # S5 fresh, S6 resume → DeploymentDecision
        deployment-id.ts
        resume.ts
        freezes.ts              # chain list, parameter set, structural fingerprint
      phase-5/                  # S8 → PreflightClearance
        scheduler.ts
        check-context.ts        # the curated, versioned document — a published type
        run-check.ts            # out-of-process, with the backstop limit
      phase-6/                  # S5 → PreparedCheckouts
        pin-set.ts
        checkout.ts             # clone or fetch, with ephemeral auth
        prepare.ts              # install, build
      phase-7/                  # S5 → ChainOutcomes
        chain-loop.ts           # the chain modes and the per-checkout mutex
        step/
          lifecycle.ts          # the six step phases in order
          inputs.ts             # values, where phase 3 produced wiring
          enrichers/            # type defaults first, author extras appended
          writers/              # tagged secrets excluded from every output
          commands/             # one per action type
          collect.ts            # .env.outputs is the only channel; artifacts persisted after
          verify.ts             # gated on the action flag and a selected profile
        multisig/               # S9 — plan, batch, propose, poll, collect, report
      phase-8/                  # S5
        summary.ts              # the printed summary and summary.json
        outcome.ts              # the worst outcome across chains → the exit code
```

**A phase directory owns its artifact and nothing else.** The test for whether something belongs to a phase is whether the next phase would notice its absence: if two phases need it, it is `cross/`, and if it only shapes a type, it is `contracts/`.

`step/` is the least settled part of this tree, deliberately: the pluggable collector and verifier contracts are decided in direction but undesigned ([artifacts.md §10](artifacts.md#10-open-items)), so `collect.ts` and `verify.ts` may well become directories in the shape `enrichers/` and `writers/` already have. That is a decision for S5 and S7, not for this document.

### 3.4 `cross/` — one implementation, on purpose

`cross/` is not a shared-utilities folder. A module belongs here when a **second implementation would be a hole** — in a security guarantee, or in a contract with something outside the process. That is a much narrower test than "more than one caller uses it", and it is the reason the directory cannot fill up with orphans.

```
    cross/
      env-file.ts             # FR-CLI-003: the mount's .env, loaded before anything resolves ${env.VAR}
      logging/
        index.ts
        levels.ts             # the one ordered scale
        logger.ts             # the two sinks
        redaction.ts          # the secret registry — every line leaves through it
        serialize.ts          # safe stringification, error serialization, truncation
        streams.ts
      secrets/                # S3 — tagging at the load layer, SEC_ delivery, nothing else
      records/                # S5 — the writer, the reader status and report use, the idempotency index
      rpc/                    # S5 — ethers v6: providers, receipts, address prediction, probes
      process/                # S5 — the execa boundary: argv arrays, no shell, per-process env
```

Each of those has a requirement behind the singularity: `logging/` because every byte must pass the redactor (NFR-003), `secrets/` because a tag applied anywhere later than the load layer is a tag an enricher can outrun (FR-SEC-012), `records/` because redaction is a property of the writer rather than a habit of its callers, `process/` because argv-array spawning is what keeps a credential out of a command line (NFR-031).

The one asymmetry worth naming: `Diagnostic` is a *type* in artifact fields, so it lives in `contracts/` ([artifacts.md §8](artifacts.md#8-cross-cutting-types)) even though every phase produces one. Types go by where they appear; machinery goes by who must not duplicate it.

## 4. Two published packages, two npm surfaces

| Package | Published contents | Consumed by |
|---|---|---|
| `@deploy-pad/schemas` | The authored `*.schema.yaml`, the generated `*.json`, the generated types, the format version | The engine at load time, an author's editor, the specs, the visual editor to come |
| `@deploy-pad/engine` | `bin/`, `dist/`, the compiled shipped checks | The CLI user, and eventually an embedding application |

Inside a package, a cross-package import uses the **package name** (`@deploy-pad/schemas`), never a relative path across the boundary — the published artifact has no `../..` to reach through, so an import that works only in the monorepo is a bug the packed-artifact smoke test is there to catch. Root-level tests are the exception, since they are not published and deliberately reach into both packages.

## 5. Tests have two homes, and the boundary is what a test reads

| Level ([test-strategy.md](test-strategy.md)) | Home | Why there |
|---|---|---|
| Unit — pure functions, no I/O | `packages/<pkg>/test/` | It tests that package's modules and imports them relatively. |
| CLI — argv in, exit code out | `packages/engine/test/` | `runCli` is an engine export; the cases are about the engine, not about a document. |
| Contract — artifacts against the documents that define them | `test/contract/` | It reads `docs/` and both packages. A package cannot own a test about a document above it. |
| Integration — the real thing, offline | `test/integration/` | It spans packages, needs foundry and anvil, and is the only level with system dependencies. |

```
packages/engine/test/
  cli.test.ts
  in-process.test.ts            # a command driven from a hand-built context — NFR-060
  env-file.test.ts
  commands/{dispatch,list}.test.ts
  logging/{logger,redaction,serialize}.test.ts
  phase-1/{failure-modes,normalize,run-context}.test.ts
  support/capture.ts            # the captured streams, clock and log sink every CLI test drives

test/
  contract/
    exit-codes.test.ts          # the enum against the table in cli.md
    diagnostics.test.ts
    flag-matrix.test.ts         # every cell, both directions, read out of the spec
    schemas.test.ts             # every modeline and doc link still resolves
    examples.test.ts            # S2 — every example validates against its schema
    records.test.ts             # S5 — every written record against its schema, plus a golden per kind
  integration/                  # S5 — a full run against a local anvil
  fixtures/
    configs/<case>/             # complete mounts: the shape --configs-dir expects
    repos/<name>/               # S5 — the foundry project a helper turns into a bare repo
  support/
    paths.ts
    markdown.ts                 # reads a table out of the doc set, so a test uses the spec as its data
    flag-matrix.ts              # the flag table, parsed into cells
    canary.ts                   # S3 — the shared no-secret-anywhere assertion
  traceability/slices.yaml      # the authoritative record of what each delivered slice claims
```

A test file mirrors the **module** it exercises, not its full path: `logging/logger.test.ts`, `phase-1/failure-modes.test.ts`. Helpers sit in a `support/` directory at the root of each test tree and are named for what they build; a helper is never a `.test.ts` file, so vitest's `include` cannot pick one up as a suite. A root-level test may import a package's helper — the flag matrix drives `runCli` through `packages/engine/test/support/capture.ts` — which is the one direction that reach is allowed, and the reason `support/` is not duplicated.

## 6. `workspace/` — the mount, not source

This is where a run's *data* lives: the config mount the engine reads, the checkouts it builds, the records it writes. The three directories are the defaults behind `--configs-dir`, `--repos-dir` and `--results-dir` ([cli.md](../specs/cli.md#common-flags)), and the tracked/untracked split is already fixed by `.gitignore`.

```
workspace/
  configs/                                     # --configs-dir: the mount, and therefore the allowlist
    actions.yaml
    workflows.yaml
    plans/<workflow>.yaml
    known-chains.yaml
    global-params.yaml
    multisig.yaml
    engine.yaml                                # optional; the shipped default is replaced wholesale
    .env                                       # untracked, always — real credentials
  repos/<repoId>/<generationId>/<releaseId>/    # untracked: disposable clones and build output
  results/<workflow>/<deployment_id>/           # the system of record — committable by design
```

Two rules keep it from leaking into the codebase. **No code and no test hardcodes a path inside it** — the three directories are flags precisely so that a test can point them at a temporary directory, and `results/` is relocatable by requirement (NFR-043). And **in this repository `workspace/` is a developer's own mount, not a fixture**: test inputs live under `test/fixtures/configs/`, which is why the mount can be absent from a fresh clone without a single test noticing. The layout is still fixed here, because `.vscode/settings.json` maps the schemas onto these paths for editor completion.

The shape of `results/` is owned field-by-field by [results.md](../specs/results.md); a consumer's own workspace repository has this tree at *its* root, which is what makes the CI commit-back pattern possible ([ci.md](../specs/ci.md)).

## 7. Naming and file conventions

- **Files are kebab-case and name what they own** — `plan-ref.ts`, `env-file.ts`, `required-data.ts` — never what they are: no `types.ts`, `helpers.ts`, `misc.ts`. A file whose honest name would be `utils` is two files that have not been separated yet.
- **A directory that groups files exposes a barrel**, and nothing imports past it. Module barrels enumerate their exports explicitly, so removing a name is a visible diff in review; the package entry `src/index.ts` is the one place that re-exports whole barrels. A single-file module needs no barrel and is imported directly.
- **Relative imports carry the `.ts` extension** (`rewriteRelativeImportExtensions`), which is what lets the dev loop run the source and the published build resolve `.js`.
- **A module that implements a rule opens with a short header comment naming it** — the requirement id, or the spec section it follows. `cli.ts` naming the two load-bearing properties of the CLI surface is the pattern: it tells the next reader which lines are not free to change.
- **A test title carries one requirement id in brackets** — `it('[FR-CHN-012] rejects an unknown chain name at load', …)`. Never a range, since the traceability check reads the ids and a range covers requirements no test proves.
- **Keep the I/O at the edge of a module.** Anything unit-testable without the filesystem, a subprocess or a logger is a `packages/shared` candidate by construction ([stack.md §4](stack.md#4-repository-layout)), so the purity is what keeps a later extraction a move rather than an untangling.

## 8. Where a new file goes

In order — the first question that answers yes is the answer:

1. Does it define a shape that crosses a phase boundary? → `src/contracts/`, one file per artifact, no I/O.
2. Does it transform one phase's input artifact into its output? → `src/phases/phase-N/`.
3. Would a second implementation of it be a hole in a guarantee — output, secrets, records, subprocess, chain access? → `src/cross/`.
4. Is it the CLI's own composition or rendering? → `src/commands/`, or `cli.ts` if it is about argv itself.
5. Does it check a document rather than exercise a module? → `test/contract/`.
6. Does it check the repository rather than the engine? → `scripts/`.

If none of them fits, the file is doing two things and wants splitting before it is placed. The failure mode this list exists to prevent is a rule ending up in `commands/` because that is where the caller was.

## 9. Open points

- ~~**Where the generated raw-config types live.**~~ **Settled:** a tracked `types/` beside `src/` and `dist/`, per [stack.md §6.1](stack.md#61-where-the-generated-types-live). The alternative — un-ignoring a corner of `dist/` — foundered on git being unable to re-include a file under an excluded directory, and on the package's `clean` script deleting the tree. S2 writes the generator and moves the `exports` and `files` entries.
- **Whether record schemas sit in `src/records/` or flat beside the config schemas.** They validate what the engine *wrote*, not what an author writes, and `schema-names.ts` is exhaustive for the config seven — so a subdirectory and its own `exports` subpath keeps the two audiences separable. Decided by S5, which authors them.
- **`LICENSE` and the engine's README.** Both packages declare MIT and no license text exists anywhere in the tree; npm packs `README` and `LICENSE` from the package directory only, so the first publish of `@deploy-pad/engine` would carry neither. Cheap to fix before a release, awkward after.
- **When `packages/shared` appears**, and what moves into it — open by design, with the trigger being a second consumer rather than the anticipation of one ([stack.md §9](stack.md#9-open-questions)). Until then the purity invariant of §7 is the whole of the preparation.
