# deploy-pad v2 documentation

Working design artifact for the next version of deploy-pad. Each file describes one config in isolation — purpose, structure, schema, example — so we can iterate on the v2 design one file at a time.

## Status

**Design artifact for v2 — the source of truth the new version will be built from.** The set started as a v1-faithful description in the proposed v2 format and has since absorbed the v2 design decisions ([specs/design-decisions.md](specs/design-decisions.md)): significant parts now describe v2-only behavior (presets-only plans, chain sets, the resume freeze, preflight checks, multisig mode, method variants). Where behavior is unchanged from v1, the docs simply describe it in v2 vocabulary; open-question callouts mark what is still unsettled. Migration from v1 (JSONC → YAML, code rename, etc.) is intentionally deferred and will be tackled as a coordinated sweep once these docs stabilize.

## Folder layout

- **[specs/](specs/)** — the config and interface specifications: one doc per config file, plus the cross-cutting specs (references, naming, secrets, CLI) and the per-step engine deep-dive. Companion [schemas/](specs/schemas/) and [examples/](specs/examples/) live alongside them.
- **[architecture/](architecture/)** — how the engine works end to end, above the level of any single config: the [arc42 architecture document](architecture/arc42.md) (the umbrella view, with the C4 diagrams inline), the run lifecycle, and one design doc per phase.
- **[implementation/](implementation/)** — the code-level layer: the field-level contracts between run phases, the stack decisions, the delivery order, and the test strategy. Written for engineers building the engine, and deliberately separate from `architecture/`, which stays free of type definitions and code (OC-4). Downstream of everything above it: **where an implementation doc and a spec disagree, the spec wins.**
- Root — this index, [requirements.md](requirements.md) (the numbered business-requirements document derived from this design set), and [TODO.md](TODO.md) (raw ideas scratchpad).

## Files

| File | What it describes |
|---|---|
| [README.md](README.md) | This file — index, conventions, status |
| [specs/naming.md](specs/naming.md) | The v1 → v2 terminology map (atomic target → action, complex target → workflow, execution config → plan) |
| [specs/references.md](specs/references.md) | Canonical home for all `${...}` substitution rules and the scoping matrix (cross-cutting, no schema) |
| [specs/known-chains.md](specs/known-chains.md) | Chain connection registry — chain identity plus named RPC and verification profiles; the single source of truth for all chain connection settings (`known-chains.yaml`) |
| [specs/global-params.md](specs/global-params.md) | Centralized chain-aware constants and the vault registry (`global-params.yaml`) |
| [specs/actions.md](specs/actions.md) | Per-repo catalog of actions — indivisible deployment units (`actions.yaml`) |
| [specs/workflows.md](specs/workflows.md) | Workflows composed of action steps and nested workflows (`workflows.yaml`) |
| [specs/plans.md](specs/plans.md) | Per-workflow runtime parameters — or, via an inline single-action step, per-action: chains, presets, overrides, secrets (`plans/<workflow>.yaml`) |
| [specs/multisig.md](specs/multisig.md) | Multisig deployments — the registry of named Safe entries, the `--multisig` run selector, and the two execution backends (multisend / merkle) (`multisig.yaml`) |
| [specs/engine.md](specs/engine.md) | The engine's own run-behavior config — the preflight-checks block, the shipped default config, and the wholesale-replacement rule (`engine.yaml`, optional; design owned by [phase 5](architecture/phase-5-preflight.md)) |
| [specs/secrets.md](specs/secrets.md) | End-to-end secret management: vault, plan secrets, multi-PK, repo auth, secret tagging (cross-cutting, no schema) |
| [specs/cli.md](specs/cli.md) | The engine's command-line surface — all commands (`run`, `validate`, `status`, `report`, `list`) and flags in one reference (cross-cutting, no schema) |
| [specs/results.md](specs/results.md) | The results tree — every record the engine writes per deployment (`deployment.yaml`, `config_snapshot.yaml`, `run-N.yaml`, `result.yaml`, `summary.json`, artifacts): layout, field tables, examples (engine-written output, no schema) |
| [architecture/arc42.md](architecture/arc42.md) | The **umbrella architecture document** (arc42, all twelve sections, with the C4 and runtime diagrams inline as Mermaid): goals and quality goals, constraints, system context, solution strategy, the building-block decomposition, runtime scenarios, the deployment view, the cross-cutting concepts, the decision index, quality scenarios, risks and technical debt, glossary. Like [requirements.md](requirements.md) it is **derived** from the specs and phase docs — when it and a spec disagree, the spec wins |
| [architecture/run-lifecycle.md](architecture/run-lifecycle.md) | The end-to-end run: every phase from CLI invocation to the final report — load & validation, static planning, dynamic preflight checks, eager repo prepare, the per-chain execution loop and its modes, the failure model (cross-cutting, no schema). Accompanied by per-phase design docs (below), one file per phase |
| [architecture/phase-1-invocation.md](architecture/phase-1-invocation.md) | Phase 1 design: parsing the invocation and fixing the run context — command selection, requests vs facts, the config-blind boundary, failure modes |
| [architecture/phase-2-load-validation.md](architecture/phase-2-load-validation.md) | Phase 2 design: loading the mounted config set through four ordered gates — version check, schema, referential rules, value resolution — into the resolved plan, with secrets tagged |
| [architecture/phase-3-static-planning.md](architecture/phase-3-static-planning.md) | Phase 3 design: flattening, variant application, and the required-data checks that turn the resolved plan into the per-chain execution plan — the boundary `validate` and `--dry-run` stop at |
| [architecture/phase-4-deployment-resolution.md](architecture/phase-4-deployment-resolution.md) | Phase 4 design: the resume-or-fresh verdict — concrete deployment id, flag-less auto-resume, the resume freezes (chain list, parameter set with `--refreeze`, structural fingerprint), multisig re-checks, and the immutable `deployment.yaml` |
| [architecture/phase-5-preflight.md](architecture/phase-5-preflight.md) | Phase 5 design (new phase): dynamic preflight checks probing the run's on-chain preconditions — one uniform mechanism (TypeScript check scripts configured in `engine.yaml`, fed a curated, versioned context), with the shipped `engine:rpc` / `engine:balance` / `engine:create3-factory` checks enabled by the default config |
| [architecture/phase-6-repo-prepare.md](architecture/phase-6-repo-prepare.md) | Phase 6 design: eager repository prepare — the pin set, per-pin directories, clone/fetch with ephemeral auth, checkout, install, build (sequential across pins; install/build on every invocation, no caching) |
| [architecture/phase-7-per-chain-execution.md](architecture/phase-7-per-chain-execution.md) | Phase 7 design: the chain loop × the step lifecycle — chain execution modes, the per-chain deployment run directory, failure semantics, the multisig branch (known gap: command execution pipeline section pending — see the doc's status note) |
| [architecture/phase-8-persistence-report.md](architecture/phase-8-persistence-report.md) | Phase 8 design: the record model (owned field-level by [specs/results.md](specs/results.md)), the final summary with its machine-readable twin (`summary.json`), and the exit code |
| [specs/engine-internals.md](specs/engine-internals.md) | How the engine processes an action (lifecycle, enrichers, writers) — not part of any config, useful for understanding what runs |
| [specs/design-decisions.md](specs/design-decisions.md) | The single home for cross-cutting v2 design decisions and their rationale (terminology, substitution model, value transforms, open questions) — a design record, no schema |
| [requirements.md](requirements.md) | The numbered business-requirements document (BRD) **derived from** this design set — narrative context plus traceable `FR-*` / `NFR-*` requirements. Downstream of the specs: when it and a spec disagree, the spec wins and the BRD needs regenerating |
| [implementation/artifacts.md](implementation/artifacts.md) | The **field-level contracts between run phases** — run context, resolved plan, execution plan, deployment decision, preflight clearance, prepared checkouts, per-chain outcomes — plus the cross-cutting types (tagged secret values, diagnostics, exit codes). Normative until the TypeScript types exist, its readable index afterwards |
| [implementation/stack.md](implementation/stack.md) | The **code-level decisions**: Node baseline and native TypeScript execution, compiler settings, package manager, repository layout, the schemas package as a cross-repo contract, dependency choices, logging and redaction, build and release |
| [implementation/delivery-plan.md](implementation/delivery-plan.md) | The **build order** — ten vertical slices with acceptance criteria in requirement ids, what gets lifted from v1, and what is deliberately deferred. Not the same as the run's phase order, and the doc explains why |
| [implementation/test-strategy.md](implementation/test-strategy.md) | The **test levels and their boundaries**, the requirement-to-test traceability check, fixtures, and the guarantees that always get a test (no secret in any output, no credential trace from repo auth, no secret in a preflight context) |

Companion schemas and examples live in [specs/schemas/](specs/schemas/) and [specs/examples/](specs/examples/) — one `.schema.yaml` plus one worked `examples/*.yml` per config file (`actions`, `workflows`, `plans` — two examples, a workflow plan and a single-action plan — `known-chains`, `global-params`, `multisig`, `engine`). The cross-cutting specs, `results.md` (engine-written output), and the architecture docs have neither.

## Conventions

### Audience and writing style

- The **primary audience is business analysts** who work with requirements — not engineers reading the codebase. Write for someone who needs to understand and author configs, not someone debugging the engine.
- Keep the style **easily readable by humans**: plain language, short sentences, and concrete examples in place of abstraction.
- Stay **conceptual and example-driven**. Avoid implementation detail, internal function or type names, and links to source code (`.ts` files).
- The one deliberate exception is [engine-internals.md](specs/engine-internals.md), which is explicitly the technical deep-dive for engineers and may reference code.

### File format

- All v2 configs are **YAML** (UTF-8, LF, two-space indent). No JSON, no JSONC.
- Recommended subset: plain mappings, sequences, scalars, and comments. **Do not use** YAML anchors (`&`/`*`), aliases, the merge key (`<<:`), or custom tags (`!foo`). Reuse is expressed via the `${...}` substitution system (see [references.md](specs/references.md)), not via YAML language features. This keeps configs reviewable, parseable by any conformant YAML loader, and validatable against JSON Schema.
- Strings that look like numbers, booleans, or `null` (e.g. RPC URLs that contain `:`, addresses, version strings) should be quoted to avoid YAML coercion surprises.

### Schemas

- Schema language: **JSON Schema Draft 2020-12**, authored in YAML form (`.schema.yaml`). JSON Schema is a data-model spec — it validates the parsed structure regardless of whether the source was JSON or YAML — so authoring it in YAML buys readability and native comments without giving up tooling.
- Each config doc links to its `schemas/<name>.schema.yaml` and inlines the top-level shape as an excerpt.

### Editor wiring

Every YAML config and example in these docs carries a header comment so the [Red Hat YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) (built into Cursor/VS Code) gives autocomplete, hover docs, and inline validation as you type:

```yaml
# yaml-language-server: $schema=../schemas/<name>.schema.yaml
```

The path is relative to **the YAML file itself**, not to the project root — so the same schema is a different path from `configs/actions.yaml` than from `configs/plans/my-plan.yaml`. Example files in this docs folder use `../schemas/...`, which stays short because they sit one level below the schemas.

For **live workspace configs** the published schema location is the `@deploy-pad/schemas` package, and the recommended wiring is not a per-file modeline but a `yaml.schemas` glob mapping in the workspace's editor settings: one place to point at the schemas, and config files that carry no path at all. A modeline still wins where it appears, which makes it the per-file override. Where the package is installed, the schemas resolve under `node_modules/@deploy-pad/schemas/`; where it is not, a modeline can point at the published JSON over a CDN, pinning the major version so that the schema behind the URL cannot change config format underneath the file. See [implementation/stack.md → The schemas package](implementation/stack.md#6-the-schemas-package).

### Substitution references

The `${...}` notation (e.g. `${global.WETH}`, `${system.CHAIN_ID}`, `${secret.privateKey}`, `${vault.create3Deployer}`, `${random.32}`, `${env.MAINNET_RPC_URL}`) is a single, cross-cutting system. Every doc that uses it links to [references.md](specs/references.md), which is the canonical specification.

In v2, **every reference must use an explicit namespace prefix** (`global.`, `system.`, `secret.`, `vault.`, `random.`, `env.`). Bare `${VAR}` (without a namespace) is rejected by the v2 schema — write `${env.VAR}` instead.

### Naming

The core v2 vocabulary — **action** (v1: atomic target), **workflow** (v1: complex target), **plan** (v1: execution config) — is mapped in full in [naming.md](specs/naming.md). Identifier conventions carry forward from v1, with v2 refinements:

- **Action id**: `<repo_id>.<generation_id>.<action_id>` (e.g. `aqua.v1.deploy-router`, where `v1` is the generation; the plan selects which release pin runs). An action may also carry a short `alias`.
- **Author-declared identifier rule**: action `inputs[*]`, action `outputs[*]` names, plan `constants` keys, and workflow `mappings` keys must all match the regex `^[a-zA-Z][a-zA-Z0-9_]*$`. **`SCREAMING_SNAKE_CASE` is the recommended style.** Legacy `OPS_*` names match the same regex and remain valid — there is no migration required, and there is no `OPS_*` prefix requirement for new identifiers. Keys of the form `builtin.<NAME>` (e.g. `builtin.CALL_ADDRESS`) are a separate, engine-owned key class — **built-in command parameters** declared by action types, valid in plan `constants` and workflow `mappings` but never as `inputs`/`outputs` names (the dot keeps the classes disjoint). See [references.md → naming convention](specs/references.md#naming-convention-for-user-declared-inputs-and-constants) and [→ built-in command parameters](specs/references.md#built-in-command-parameters-builtin-names) for the canonical rules.
- **Engine-managed values are not author-named.** They use namespaced references — `${system.CHAIN_ID}` / `${system.CHAIN_NAME}` / `${system.RPC_URL}` / `${system.DEPLOYMENT_ID}` for engine context, `${secret.privateKey}` / `${secret.verificationApiKey}` for credentials — and never appear as `inputs` or `constants` keys. v1's `OPS_PRIVATE_KEY` is gone in v2: it lives under `secrets:` in the plan (whose values typically point at `${vault.X}` entries in [global-params.md → Vault](specs/global-params.md#vault)) and is consumed via `${secret.privateKey}`. The engine injects secret values into commands under a dedicated `SEC_` prefix (`SEC_PRIVATE_KEY`, `SEC_VERIFICATION_API_KEY`) — distinct from the `OPS_` prefix for non-secret engine context — and redacts them everywhere in its output.
- **Env refs**: explicit `${env.VAR}` form. The bare `${VAR}` form is removed in v2.
- JSON keys (in deployment results): convert `OPS_THING_ADDRESS` → `thing` (strip `OPS_`, strip `_ADDRESS`, camelCase). For non-prefixed names, the result conversion drops only the `_ADDRESS` suffix.
- Chain names: lowercase, hyphenated where multi-word (see [known-chains.md](specs/known-chains.md)).

## Design decisions for v2

Cross-cutting design decisions — terminology rename, the substitution model, the value-transform system, format migration, and the open questions — are collected in one place: **[design-decisions.md](specs/design-decisions.md)**. Topic-specific detail still lives in the relevant per-config doc and in [references.md](specs/references.md) (the substitution spec, including its "Open questions" section); `design-decisions.md` records *what was decided and why* and links out.

## Out of scope for this folder (today)

- `editor-settings.yaml` (UI grouping rules) and `.metadata/projects.jsonc` (editor project grouping) — neither is part of workflow definition; documented only in v1 docs for now.
- Migration plan from JSONC → YAML and rename mechanics.
- Code changes (loaders, validators, factories).