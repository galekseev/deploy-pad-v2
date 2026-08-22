# Stack and code-level decisions

The decisions that shape the **codebase** rather than the system's behavior: runtime baseline, TypeScript configuration, package manager, repository layout, the schemas package, dependency choices, and how the thing is built and released. One entry per decision, each stated with the consequence that follows from it.

> **Status:** Draft, written before the first slice ([delivery-plan.md](delivery-plan.md)). Decisions here are revisable until the slice that implements them lands; after that a change is a migration.
> **Audience:** engineers writing the engine.
> **Position in the doc set:** [specs/](../specs/) owns field-level semantics, [architecture/](../architecture/) owns the conceptual design of the run, and this folder owns how it is built in code. Architecture docs deliberately stay code-free (OC-4), which is exactly why these decisions need a home of their own. **Where a decision here contradicts a spec, the spec wins** and this document needs correcting.

---

## 1. Runtime baseline: Node 24 or newer

`engines.node: ">=24"`, ESM everywhere, no CommonJS entry points.

Node 24 is chosen over 22 for one reason with several consequences: **native TypeScript type stripping**. It is enabled by default since 23.6, stable since 24.12, and Node 26 removed the transform mode entirely — so erasable-only TypeScript is the direction the runtime is going, not a temporary convenience.

What follows from it:

- **Preflight checks need no bundled TypeScript runtime.** [Phase 5](../architecture/phase-5-preflight.md) requires the engine to execute operator-authored TypeScript check scripts out of process. The engine spawns `node <check>.ts` directly — one less dependency to ship, one less binary to be present on the operator's `PATH`, and TC-11 ("out-of-process TypeScript scripts") is satisfied by the runtime itself.
- **Shipped checks are compiled, operator checks are not.** Node refuses to strip types from files inside `node_modules`, so the three checks that ship with the engine (`engine:rpc`, `engine:balance`, `engine:create3-factory`) are built to JavaScript before publishing. Operator checks live in the config mount, outside `node_modules`, and run as authored `.ts`. The check contract is identical either way — exit code plus captured output — so nothing about the mechanism becomes privileged for the shipped ones.
- **Operator scripts are limited to erasable syntax.** No `enum`, no `namespace` with runtime code, no parameter properties, no `import =`. The engine cannot lift that restriction (Node 26 dropped the escape hatch), so the constraint is documented for check authors rather than worked around.
- **Stack traces stay honest.** Type stripping replaces types with whitespace, so line numbers survive and no source maps are needed for the dev loop.
- **The wrapper loads the env file natively.** FR-CLI-003 requires the invocation wrapper to make `workspace/configs/.env` available before the engine resolves `${env.VAR}`. Node loads it natively; `dotenv` is not needed. The wrapper's job is unchanged — only its implementation shrinks, and further than expected: `process.loadEnvFile()` works at runtime, so the wrapper is the first thing the CLI *does* rather than a script that re-execs node to pass `--env-file`. One process, no duplicated flag parsing, and the behavior sits in a module a unit test can drive.

## 2. TypeScript configuration

```jsonc
{
  "module": "nodenext",
  "target": "esnext",
  "strict": true,
  "erasableSyntaxOnly": true,
  "verbatimModuleSyntax": true,
  "rewriteRelativeImportExtensions": true,
  "noUncheckedIndexedAccess": true
}
```

Two of these are load-bearing rather than taste:

- **`erasableSyntaxOnly`** keeps the engine inside the same syntax budget operator check scripts must live in. Without it the engine could drift into constructs its own extension surface cannot use, and the mismatch would only surface when someone copied engine code into a check. It also means `tsc` reports the violation at authoring time instead of Node throwing `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at runtime.
- **`noUncheckedIndexedAccess`** matters more here than in an average codebase: most of the engine's data is `Record<chainName, …>` and `Record<stepId, …>` lookups over user-supplied keys, and the whole design premise is that a missing key produces a named error rather than `undefined` flowing onward.

The rest of the settings are ordinary strictness, with one worth naming because it shapes how types get written: **`exactOptionalPropertyTypes`** makes `field?: T` mean "absent", not "possibly `undefined`", which is exactly the distinction the artifact convention rests on ([artifacts.md](artifacts.md#conventions-that-apply-to-all-seven)). Artifact fields model absence explicitly and are never optional; the internal option bags that forward a caller's maybe-value are declared `field?: T | undefined`, which is the honest shape for a pass-through and keeps the two kinds of "missing" visibly different.

Type checking is a separate step from running: Node never type-checks, so `tsc --noEmit` runs in CI and in the pre-commit path, and the dev loop runs `.ts` directly.

## 3. Package manager: pnpm

Yarn Classic (what v1 uses) is out, and the replacement is **pnpm**, pinned through the `packageManager` field.

- **Not Yarn Classic:** no `workspace:` protocol, which is the mechanism the schemas package depends on ([§6](#6-the-schemas-package)).
- **Not npm:** the `workspace:` protocol is still unsupported (`EUNSUPPORTEDPROTOCOL` as of npm 11; the RFC is open). npm workspaces do symlink local packages, but they never rewrite the declared range at publish time, so "symlink in development, exact version in the published manifest" would have to be a home-grown release script. Installing pnpm once is less machinery than maintaining that script.
- **Not Yarn 4:** functionally equivalent to pnpm here, but Plug'n'Play is on by default and would have to be switched off. The engine spawns `node <script>.ts` and third-party toolchains inside cloned checkouts; all of that assumes ordinary `node_modules` resolution.
- **The side benefit that matters:** pnpm's strict, non-hoisted `node_modules` catches phantom dependencies. For a package published to a registry, importing something that was never declared is a bug that is invisible in development and breaks on the consumer's first install.

**Corepack is no longer bundled with Node** as of 25 (Node TSC decision; 24 keeps it as experimental). So `packageManager` records the version, but pnpm is installed explicitly: one command locally, `pnpm/action-setup` in CI. Nothing in the repository may depend on `corepack enable` being available.

## 4. Repository layout

A small monorepo, two published packages today and room for a third:

```
packages/
  schemas/                  # @deploy-pad/schemas — the config contract
    src/*.schema.yaml       #   authored, the only editable copy
    src/format-version.ts   #   the config format version constant
    dist/                   #   generated: *.json + *.d.ts
  engine/                   # @deploy-pad/engine — bin: deploy-pad
    src/contracts/          #   phase artifacts (artifacts.md)
    src/phases/             #   one module per run phase, 1..8
    src/cross/              #   secrets, records, logging, rpc, diagnostics
    src/checks/             #   the three shipped preflight checks
    src/main.ts             #   the executable entry: env file, then the CLI
    bin/deploy-pad.js       #   published shim, plain JS by necessity
docs/                       # this doc set
test/                       # cross-package contract tests, fixtures, slice claims
scripts/                    # repository checks: versions, traceability, packed artifact
```

**Why the bin is a two-line shim.** A published bin cannot be TypeScript — node refuses to strip types inside `node_modules` ([§1](#1-runtime-baseline-node-24-or-newer)) — so everything with behavior worth testing lives in `src/`, and `bin/deploy-pad.js` only imports it. Making the shim a `.js` file rather than the extensionless `deploy-pad` also keeps it inside the reach of eslint, which is where the ban on writing to a stream directly is enforced ([§7](#7-logging-and-redaction)).

The decomposition inside `packages/engine/src` follows the run lifecycle, because that is the system's real internal structure — each phase is a contract with a named input and output artifact, and `src/cross/` holds what every phase touches. This mirrors [arc42 §5.2](../architecture/arc42.md#52-level-2--inside-the-engine-process) rather than inventing a second decomposition.

**The third package is expected rather than hypothetical.** The editor will need more than the schemas: to show an author what a step will actually deploy it has to resolve methods, factory flavors and key slots by the same precedence the engine uses, validate mapping arity, derive a salt, and know which namespaces a location accepts. Reimplementing those rules in a separate repository would produce exactly the engine-versus-editor divergence the shared config contract exists to prevent. What keeps that extraction cheap is an invariant rather than an early package: **the rules stay pure — no filesystem, no subprocess, no logger, no `process.env`** — which is the same line the unit level already draws in [test-strategy.md](test-strategy.md). Anything unit-testable without I/O is a `packages/shared` candidate by construction, so promoting it later is a move plus an export list, not an untangling. Until a second consumer actually exists it stays inside `packages/engine`, because publishing an API for one caller costs more than it returns.

## 5. Dependencies

Taken, each because something in the specs requires it:

| Package | Why |
|---|---|
| `commander` | The CLI surface: five commands, per-command flag validation (FR-CLI-006). Carried over from v1, where it did the same job. |
| `yaml` | Every config is YAML (TC-3). Also how the engine reads its own schemas — see [§6](#6-the-schemas-package). |
| `ajv` + `ajv-formats` | JSON Schema Draft 2020-12 validation (FR-CFG-012), with `allErrors` on so gate 2 can report everything at once (NFR-022). |
| `ethers` | In-process chain access and ABI encoding (TC-10): `contract-call`, transforms, preflight probes, Safe interaction. |
| `execa` | Every subprocess: git, install, build, step commands, check scripts. Spawns from an argv array without a shell, so nothing the engine passes can be interpolated into a command line — which is what keeps credentials confined to the environment (NFR-031). |
| `vitest` | Tests, including the CLI-level and integration layers ([test-strategy.md](test-strategy.md)). |
| `eslint` + `typescript-eslint` | Lint. |

**Each arrives with the slice that first imports it.** A declared-but-unused dependency buys nothing under pnpm's strict `node_modules` — the protection is that an *undeclared* import fails loudly — while it does slow every install and widen the audit surface. So the table is the intended set, not the installed set: the scaffold holds `commander` and `yaml`, and `ajv`, `ethers` and `execa` land with validation, chain access and the first subprocess respectively.

One constraint is worth recording because it is not obvious: **`typescript-eslint` caps the TypeScript version.** Type-aware linting needs the compiler's own API, so the lint dependency's supported range decides which TypeScript the repository can use — currently the 6.x line rather than 7's native compiler. Type-aware rules are what make the redaction and exit-code guarantees enforceable at all, so the cap is accepted rather than worked around.

Deliberately **not** taken, in contrast with v1:

| Dropped | Replaced by | Reason |
|---|---|---|
| `tsx` | `node file.ts` | Native type stripping ([§1](#1-runtime-baseline-node-24-or-newer)). Still accepted as a `script` action `runtime` value, for authors whose scripts need non-erasable syntax. |
| `dotenv` | `node --env-file` | Native. |
| `chalk` | `util.styleText` | Native since Node 20.12, and console styling has to pass through the logger anyway. |
| `ora` | — | Spinners fight the levelled console: they write outside the log stream, corrupt `--log-level silent` (NFR-040), and are meaningless in CI and in parallel chain mode where lines interleave. |
| `jsonc-parser` | — | v2 has no JSONC (TC-3). |

## 6. The schemas package

The seven `*.schema.yaml` files serve four consumers: the engine at load time, the config author's editor, the specs that document them, and — once it exists — the visual editor, which is planned as a separate project and possibly a separate repository. That last consumer is what makes the schemas a **contract between repositories** rather than an internal engine asset, and why they get their own package instead of riding along inside the engine. A browser application should not depend on `ethers` and `execa` to obtain seven YAML files.

**Contents of the package.** The authored `*.schema.yaml` files are the single editable copy. The build generates, into `dist/`, a `*.json` twin of each (browsers, CDNs and third-party tooling consume JSON without a parser) and TypeScript types for the raw config shapes. It also exports the config format version as a constant.

**Versioning.** The **major version of the schemas package equals the config format version**: schemas `2.x` means format `2`. The engine's dependency range then reads as "this engine speaks format 2", changing the format becomes a major release by construction, and the version gate of FR-CFG-013/014 has exactly one source of truth — the constant in the package, not a number duplicated in engine code. TC-4 ("exactly one supported format version at a time") ends up expressed by packaging rather than by discipline.

**Physical location.** The authored files move out of `docs/specs/schemas/` into the package. npm cannot include files above a package root, and a build-time copy would recreate a second copy that someone eventually edits — which is precisely how the abandoned `docs-v2` copy of this doc set drifted from the live one, schemas included. The specs keep owning the *meaning* and are reviewed together with any schema change; only the file's address changes.

**The development loop.** A separate package does not mean fetching from a registry while developing — in the monorepo it is a symlink, and the registry is involved only at release. What would slow the loop down is a build step between editing a schema and seeing the effect, so:

- **The engine reads the authored YAML directly**, not the generated JSON. It already depends on `yaml`, and ajv needs a parsed object either way. Editing a schema is immediately visible to the engine and its tests — no build, no version bump. The generated JSON exists purely for external consumers.
- **`exports` separates source from artifact:** `.yaml` subpaths resolve to the authored files, `.json` and type subpaths to `dist/`. Nothing in the development loop depends on `dist/` existing — including the package entry that carries the format-version constant, which resolves to `src/index.ts` locally and to `dist/index.js` once published. The two maps are the `exports` field and a `publishConfig.exports` override, which pnpm substitutes when it packs. That works locally because pnpm's symlink resolves to a real path outside `node_modules`, where node will strip types; the published map is what the packed-artifact smoke test exercises, so the two cannot drift silently.
- **Generated types are committed**, so a fresh clone type-checks without running a generator; CI verifies that regeneration produces no diff. A stale type cannot change a validation verdict — types are compile-time only — so the failure mode is a loud CI diff rather than a wrong result.
- **`workspace:*` is a symlink locally and an exact version in the published manifest**, which is why the "editable locally" and "pinned when published" requirements do not conflict.
- **Editor wiring in development** points at the same local files: a `yaml.schemas` glob mapping in the repository's editor settings, so a schema edit changes completion and validation in live workspace configs immediately.
- **Editor wiring for consumers** rides on the registry being public ([§8](#8-build-and-release)). A workspace repository that installs nothing can point its modelines straight at the published JSON through a CDN that serves npm packages — `# yaml-language-server: $schema=https://cdn.jsdelivr.net/npm/@deploy-pad/schemas@2/dist/plans.schema.json` — with the **major pinned in the URL**, so a modeline cannot silently follow the config format across a version boundary. A repository that does install the package maps `yaml.schemas` into `node_modules` instead. This is the concrete consumer the generated `*.json` twin exists for.

The one place the split genuinely costs something is cross-repository iteration with the editor, which will need a link or an override. That is rarer than daily work inside the monorepo.

## 7. Logging and redaction

The logger is **written, not adopted** — though not because a library could not satisfy NFR-003. Wrapped behind a facade that never exports the underlying instance, `pino` or `winston` would deliver the same guarantee a hand-written logger gets from its module boundary. The decision follows from how little is left for a library to do once the two hard parts are ours anyway:

- **The redactor is ours either way.** No logger implements what the specs require. Pino's `redact` and Winston's equivalents match *keys* (`req.headers.authorization`); the requirement is value substitution inside arbitrary strings — vault-sourced fragments render as their reference label, so an RPC URL with an embedded key stays readable as `.../v2/[vault.alchemyKey]`, while direct-env and literal secrets render as a placeholder plus their slot name ([design-decisions.md → Vault redaction](../specs/design-decisions.md#vault-redaction-show-the-reference-never-the-secret)). That mechanism belongs to the secret registry whatever writes the line.
- **The console is a CLI renderer, not a log stream.** The run header, the dry-run plan, the preflight report, the per-chain per-step summary and the proposal report are formatted human output that happens to be level-gated — and `--log-level silent` suppresses all of it, the summary included ([phase 8](../architecture/phase-8-persistence-report.md)). A JSON logger with a pretty-printer reformats records; it does not render that. Bespoke output is also what makes the per-level snapshots in [test-strategy.md](test-strategy.md) cheap, timestamps and pids not being in the way.
- **What remains is the file sink**, and there the library's distinguishing value — worker-thread transports, async destinations, throughput — is aimed at servers. A CLI that exits with a meaningful code from a dozen places wants synchronous writes, which is the mode in which most of what a logger brings is switched off.

**Two sinks, one path.** A levelled console (`silent` · `error` · `warn` · `info` · `debug`) and an optional structured JSON file that always records at full `debug` detail regardless of the console level (FR-CLI-004). Both are chain-aware: in parallel chain mode every console line carries a chain prefix and every structured record a chain field (FR-RUN-014). Every line leaving either sink passes the one function that consults the secret registry — redaction is a property of the sink, never of the call site.

**What writing it must not lose.** The boring parts an adopted logger would have brought are S0 scope, not later discoveries:

- **Flush before exit.** An asynchronous write stream plus `process.exit()` truncates the tail of the log. Writes go synchronously to a file descriptor, which at this volume is also simpler than any flush protocol.
- **Safe stringification.** `JSON.stringify` throws on a circular reference, and an `ethers` provider or an `execa` result is one.
- **Error serialization** that follows `cause`, keeps stacks, and truncates captured subprocess output — an `execa` failure can carry megabytes of stderr, and a preflight check's message is surfaced verbatim.
- **`EPIPE`**, for a console piped into something that closes early.
- **A record shape that evolves additively**, like every other machine artifact the engine writes: the log file sits beside `summary.json` in the CI contract ([results.md](../specs/results.md#summaryjson--the-machine-readable-summary)).

**The guarantee is enforced, not intended.** "Every line leaves through one function" decays the first time a slice reaches for `console.log`, so eslint forbids `console.*` and `process.stdout.write` outside the logger module, and the canary assertion in [test-strategy.md](test-strategy.md#the-guarantees-that-always-get-a-test) checks both sinks for every fixture credential after every run that any test performs.

## 8. Build and release

- **Build** is `tsc` per package, plus the schemas generator. No bundler: the engine is a CLI with a `node_modules` tree, and bundling would only complicate spawning the shipped check scripts.
- **Published contents.** `@deploy-pad/engine` ships `dist/`, the compiled shipped checks, and the wrapper. `@deploy-pad/schemas` ships the authored YAML, the generated JSON and the generated types.
- **The registry is public.** Both packages publish to the public npm registry — the choice that makes the URL-based schema modelines of [§6](#6-the-schemas-package) available to workspace repositories that install nothing. It also allows publishing with **provenance**, the attestation tying a tarball to the workflow run and commit that produced it, which npm offers only for public packages built in CI: a consumer can then verify where an engine or schema version actually came from.
- **Lockstep versioning.** Both packages are released together from this repository. The schemas major is pinned to the config format version ([§6](#6-the-schemas-package)); the engine follows its own minor/patch cadence within that major.
- **A packed-artifact smoke test gates every release** — install the tarball into a clean directory, run `deploy-pad --help` and validate an example config. It catches an undeclared dependency or a broken `exports` map before a consumer does. Details in [test-strategy.md](test-strategy.md).

## 9. Open questions

- **When `packages/shared` appears, and what exactly moves into it.** v1 has a `shared` workspace and v2 starts without one, but the editor is expected to need engine-owned *rules*, not only schemas and record shapes, so the split is likely rather than speculative ([§4](#4-repository-layout)). What stays open is the timing — the trigger is a second consumer existing, not the anticipation of one — and which of the pure modules the editor actually reaches for. The purity invariant in §4 is what makes waiting for that answer cheap.
