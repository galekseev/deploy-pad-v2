# Design decisions (v2)

The single home for cross-cutting v2 design decisions — **what was decided and why**. This is a design record, not a how-to: the normative spec for each topic lives in the per-config docs (linked inline). Recording the intent here keeps settled ground from being relitigated and gives open questions one place to live.

**Legend** (used in the index below): ✅ decided · 🔭 open / deferred.

## Index

- [Terminology rename](#terminology-rename) ✅
- [Substitution model](#substitution-model) ✅
- [Built-in command parameters](#built-in-command-parameters) ✅
- [Deploy method placement](#deploy-method-placement) ✅
- [CREATE3 factory flavors: per-step `factory` field](#create3-factory-flavors-per-step-factory-field) ✅
- [Plan value layer: presets only](#plan-value-layer-presets-only) ✅
- [Single-action plans](#single-action-plans) ✅
- [Chain connection registry](#chain-connection-registry) ✅
- [Chain sets: selector-carrying groups in known-chains](#chain-sets-selector-carrying-groups-in-known-chains) ✅
- [Resume freeze: frozen parameters, fingerprinted structure](#resume-freeze-frozen-parameters-fingerprinted-structure) ✅
- [Multisig execution backends: multisend first, merkle second](#multisig-execution-backends-multisend-first-merkle-second) ✅
- [Multisig deferrals: batch barriers, proposal staleness, multi-Safe](#multisig-deferrals-batch-barriers-proposal-staleness-multi-safe) 🔭
- [Value transforms](#value-transforms) ✅ — the bulk of this file
- [Removed: legacy output-name transform](#removed-legacy-output-name-transform) ✅
- [Strict miss behavior](#strict-miss-behavior) ✅
- [`${random.N}`: test-only, no determinism](#randomn-test-only-no-determinism) ✅
- [Config format versioning: every file](#config-format-versioning-every-file) ✅
- [Vault redaction: show the reference, never the secret](#vault-redaction-show-the-reference-never-the-secret) ✅
- [Results persistence in CI: commit the tree back](#results-persistence-in-ci-commit-the-tree-back) ✅
- [The CLI is an adapter, not the engine](#the-cli-is-an-adapter-not-the-engine) ✅
- [Pluggable step components: collectors and verifiers](#pluggable-step-components-collectors-and-verifiers) ✅
- [Format migration](#format-migration) 🔭
- [Rejected namespace candidates](#rejected-namespace-candidates) ✅
- [Future: `address` validate/normalize transform](#future-address-validatenormalize-transform) 🔭

## Terminology rename

**Decision.** The v2 names are **action** (v1: atomic target), **workflow** (v1: complex target), and **plan** (v1: execution config). The full map — derived terms, YAML keys, file renames — is in [naming.md](naming.md). These docs already use the new vocabulary.

**Status.** The rename of code, workspace configs, v1 docs, and cursor rules still lands as a single coordinated sweep in one PR (see [Format migration](#format-migration)).

## Substitution model

**Decision.** The `${...}` reference system uses **explicit namespacing** — every token starts with one of six prefixes (`global.`, `system.`, `secret.`, `vault.`, `random.`, `env.`). Bare `${VAR}` is removed; the ad-hoc `${chain}` is removed (routed through `${system.CHAIN_NAME}`); `${secret.*}` and `${vault.*}` namespaces were added with secret tagging/redaction; the user-identifier naming rule was formalized (`^[a-zA-Z][a-zA-Z0-9_]*$`, `SCREAMING_SNAKE_CASE` recommended, legacy `OPS_*` accepted); engine-native command parameters live under the `builtin.` key class (see [Built-in command parameters](#built-in-command-parameters) — the earlier single reserved constant `callAddress` is replaced); deployment strategy moved out of constants (method on the workflow step — see [Deploy method placement](#deploy-method-placement) — factory/salt in the plan `deploy` block).

**Detail.** The canonical spec is [references.md](references.md); its "Resolved by this revision" callout lists each settled substitution item. No substitution question is currently open — the last ones were closed by [Strict miss behavior](#strict-miss-behavior), [`${random.N}`: test-only, no determinism](#randomn-test-only-no-determinism), and [Rejected namespace candidates](#rejected-namespace-candidates).

## Built-in command parameters

**Decision.** Engine-native action types declare their own **built-in parameters** in engine code — a per-type list of `{ name, required, default? }` entries (v1 already declared built-in inputs per target type the same way). Built-ins are keyed `builtin.<NAME>` (`builtin.` prefix + SCREAMING_SNAKE_CASE name, grammar `^builtin\.[A-Z][A-Z0-9_]*$`) and resolve through the **ordinary input pipeline**: per-step workflow `mappings` (step output refs, bare renames, production-pipeline values), else the plan constant under the literal `builtin.<NAME>` key, else the type-declared default, else an error for required ones. Mapping a `builtin.` key the step's type doesn't declare is a load-time error. This replaces the earlier single reserved constant `callAddress` — `contract-call` now declares `builtin.CALL_ADDRESS` (required) — and is the extension point for future specialized engine-native commands (e.g. an ownership-transfer type declaring `builtin.TARGET_ADDRESS` / `builtin.NEW_OWNER`): no new reserved names, no engine-core parameter-surface changes. Normative spec: [references.md → Built-in command parameters](references.md#built-in-command-parameters-builtin-names); [actions.md → Built-in parameters](actions.md#built-in-parameters); [engine-internals.md → Built-in parameter resolution](engine-internals.md#built-in-parameter-resolution).

**Why.** A single globally reserved name doesn't scale: each new engine-native command would add another global reservation, another loader special case ("must not appear in `inputs`"), and another ad-hoc resolution path. Type-declared built-ins make the set self-describing (the type owns its parameters), reuse the existing mapping/constants machinery wholesale (v1 already had the per-type declaration mechanism — the earlier v2 reserved-constant draft was a regression from it), and give validation real teeth: the engine knows every type's set, so undeclared mapping keys and unsatisfied required parameters are precise errors. The dot in the key grammar makes collision with user identifiers (which cannot contain dots) structurally impossible — no reservation list, no shadowing rules. The prefix carries the "engine-declared" signal, so the name part can follow the same SCREAMING_SNAKE_CASE convention as every other parameter name.

**Rejected.**

- *A single reserved constant per behavior* (the earlier `callAddress` design) — doesn't scale past one or two names; every addition is a new global reservation plus loader special cases.
- *Bare camelCase names* (`callAddress`, `newOwner`) — visually distinct from user names but only by convention: they match the user-identifier regex, so real reservation/shadowing rules would still be needed, and generic names would eventually collide with user constants.
- *Un-namespaced SCREAMING_SNAKE names* (`CALL_ADDRESS`, `NEW_OWNER`) — indistinguishable from user constants without opening the action type's docs; plausible user names guarantee shadowing conflicts in practice.
- *Colon separator* (`builtin:CALL_ADDRESS`) — technically valid YAML in key position but fragile across parsers/highlighters and unreadable next to the key's own colon.
- *Other prefixes* (`cmd.`, `native.`, `engine.`) — `cmd` collides with the `command` field (which `contract-call` explicitly rejects); `native`/`engine` are less self-describing than `builtin`, which matches the concept name used in docs and error messages.
- *Folding the private key in as a `{ secret: true }` built-in* — the key flows through the secrets channel (`${secret.privateKey}`, `SEC_` injection, tagging/redaction, `mode`-driven on `contract-call`) with materially different mechanics; unifying only the rename surface (already shared) keeps the secrets story in one place ([secrets.md](secrets.md)).
- *Folding deploy salts/factories in as built-ins* — they fail the model on three axes: requiredness depends on the *resolved method* (workflow- and chain-conditional, not type-constant); salts are per-step data needing per-step plan keying (`deploy.salts.<stepId>`), which a shared constant key cannot express; and salt fallbacks are *derived* (`saltBase` + step id), not static defaults. Built-ins are parameters of a specific command's operation; deployment strategy belongs to the deployment layer (see [Deploy method placement](#deploy-method-placement)).

**Consequences.** The unmapped `builtin.<NAME>` plan constant is a shared fallback across all unmapped steps of a type — per-step differentiation (two `contract-call` steps targeting different contracts) always happens in the workflow via mapping renames or step output refs. Docs need a per-type built-ins table (kept in references.md) since the set is distributed across type providers rather than a single reservation list.

## Deploy method placement

**Decision.** The deployment method (`create` / `create2` / `create3`) is resolved **entirely in the workflows file**. Each contract/module step declares its `method` (default `create`); when the same steps must run with a different deploy strategy, a **method variant** (`variantOf`) re-skins an existing workflow, overriding *only* per-step deploy strategy — the **method** (`methods`, with a `"*"` wildcard) and, because a method flip can demand a different wallet (plain CREATE derives the address from deployer + nonce; CREATE3 doesn't care who signs), the **signing-key slot** (`keys`, no wildcard) — chain-agnostically and/or per chain (`chains.<c>.methods` / `chains.<c>.keys`). **The plan cannot change the method** — the earlier plan-side override surface (`deploy.methods`, `force_method`) was removed; the plan `deploy` block carries only data (`salts`, `factories`, `saltBase`). Key *slots* in a variant are names only; the credential values stay in the plan's `secrets:`. Normative spec: [workflows.md → Per-step `method`](workflows.md#per-step-method) and [→ Method variants](workflows.md#method-variants--variantof); [plans.md → Deploy parameters](plans.md#deploy-parameters-deploy-block).

**Why.** The method is structural — it determines *how* a contract deploys and what address identity it gets — so it belongs to the layer that owns structure, keeping the three-layer model clean (*action = interface, workflow = structure + wiring, plan = values*). The plan-side override precedence (four levels, "silent win + warning" on conflicts, preset merge special cases for `methods`/`force_method`) let the values layer silently rewrite structure and made the resolved method depend on plan state. With variants, method resolution is fully static — workflow id + chain determine every step's method at load time — and every deviation from the base is an explicitly named, reviewable config entry. The two real needs the plan overrides served are both covered: per-environment clamps (a `-plain` variant for staging) and per-chain capability gaps (a chain-aware variant clamping e.g. zksync, which lacks the canonical CREATE3 factory, to `create`).

**Rejected.**

- *Plan-side `methods` / `force_method` overrides* (the earlier design) — values layer mutating structure; silent-win semantics; per-step env overrides had no motivating case that variants don't cover.
- *Full workflow inheritance* (extends + override anything) — scope creep; overriding mappings or steps makes the result a different workflow, which should be declared as one. Variants are deliberately deploy-strategy-only (methods + key slots, never data wiring), one level deep (no variant-of-variant).
- *Plan-side per-chain variant selection* (`chains.<c>.workflow`) — workable but adds a plan field and a relatedness validation; chain-aware overrides inside the variant cover the same need with the plan untouched.
- *Handling method-driven wallet changes purely in the plan* (no `keys` in variants) — covers the whole-variant and per-chain cases (slot values are plan-side and per-chain already), but not the per-step case: steps sharing one slot in the base (e.g. the default `privateKey`) cannot diverge in a variant without a per-step slot rename, which lives in the workflow layer. Requiring every base workflow to pre-assign distinct slots per step "just in case" would tax every plan for a hypothetical variant.

**Consequences.** A variant is a first-class workflow id (plans point at it; results are keyed by it; it can be nested as a `workflow:` step). Steps not mentioned keep the base method and key slot. One-off method flips via deployment overrides are gone by design — changing the deploy strategy always means an explicit variant in `workflows.yaml`. Slot-naming hygiene: name secret slots by role (`escrowFactoryDeployer`), not by method (`create3Deployer`), so re-binding them in a variant's plan doesn't produce misleading names.

## CREATE3 factory flavors: per-step `factory` field

**Decision.** `create3` is not one contract — several factory implementations exist with different interfaces, address-derivation formulas, and front-running protection models. v2 supports three flavors — `oneInch` (1inch `Create3Deployer`; ownership-protected, address independent of the caller), `createx` (canonical CreateX singleton; salt-protected, no factory address to author), `solady` (a Solady-CREATE3-based factory; salt-protected) — selected by a new **optional per-step `factory` field** next to `method` (default `oneInch`, valid only with `method: create3`). Method variants gain a third override map, `factories` (chain-agnostic and `chains.<c>.factories`, `"*"` wildcard targeting create3 steps), with the same precedence shape as `methods`. The plan keeps supplying only data: `deploy.factories.<stepId>` is required for `oneInch`/`solady`, unused for `createx`. Normative spec: [workflows.md → CREATE3 factory flavors](workflows.md#create3-factory-flavors--factory); [plans.md → Deploy parameters](plans.md#deploy-parameters-deploy-block).

**Why.** The flavor determines the address-derivation formula — i.e. the deployed address identity — which is exactly the property that made `method` structural (see [Deploy method placement](#deploy-method-placement)). So it belongs to the workflow layer and must resolve statically (workflow id + chain → every step's method *and* flavor at load time, before the plan is consulted). Keeping it a **separate field** rather than growing the method enum keeps the two axes independent: `method` says *what strategy*, `factory` says *whose implementation* — and validation rules ("needs a factory address", "salt is caller-guarded") key off the flavor without name-based special cases spreading through the docs. The name is deliberate: "CREATE3 factory" is the established term for these contracts, and it frees "deployer" to mean only the *signing wallet* everywhere in the docs; the flavor and the plan's `deploy.factories` addresses are the same concept at two layers — the workflow picks the factory kind, the plan supplies its address. Per-chain capability gaps (CreateX absent on e.g. zkSync Era) reuse the existing variant machinery via the `factories` maps.

**Rejected.**

- *Extending the `method` enum* (v1-style: `create3` = 1inch, `createx`, `solady` as sibling values) — smallest migration delta (v1 code already ships `createx` as a method) and zero new variant surface, but it conflates the strategy and vendor axes in one enum, grows multiplicatively (flavors × strategies), and turns every flavor-specific rule into a name-based exception (`factory required for create3 and solady but not createx`). A wildcard clamp like `"*": create3` also couldn't express "all CREATE3 steps → CreateX" without enumerating steps.
- *Flavor in the plan next to the factory address* (`deploy.factories.<stepId> = { address?, kind }`) — attractive because the kind is arguably a property of the concrete deployed factory contract and per-chain divergence would ride the existing per-chain factories merge, but it breaks the core v2 invariant that the plan cannot change structure: the address-derivation formula would become plan state, method/flavor resolution would stop being static, and two presets of one plan could silently deploy through different flavors. It also makes the `factories` value polymorphic (string vs object) and the "missing factory = error" rule conditional in the values layer.

**Consequences.** Variants carry three override maps (`methods` / `factories` / `keys`); a variant with only `factories` entries is valid — note the variant map holds *flavors* while the plan's `deploy.factories` holds *addresses*, both keyed by step id. The plan's missing-factory hard error becomes flavor-conditional (exempt for `createx`). The v1 `createx` *method* value maps to `method: create3` + `factory: createx` in the v2 migration. A detailed user-facing flavor comparison (derivation formulas, salt-guarding mechanics, per-chain availability, how to choose) is deferred to the user guide (tracked in [TODO.md](../TODO.md)).

## Plan value layer: presets only

**Decision.** The plan's base level is **structural only** — `workflow`, `chains` (name references into known-chains with profile selectors — see [Chain connection registry](#chain-connection-registry)), `releases`, `default_preset`. **Presets are the only value layer**: every constant, secret, and `deploy` entry (salts / factories / saltBase) lives inside a preset, which is complete and isolated — no inheritance from a base `defaults` block (removed) or from other presets. Within a preset, its own `defaults` merges into its chain blocks at load time. `active_preset` is renamed **`default_preset`** (the fallback when the CLI passes no `--preset`; a plan with exactly one preset uses it implicitly). The plan-level `type` field is removed (the tag lives on each preset). **`deployment_id` is no longer a plan field**: the id is resolved at run time — CLI `--deployment-id`, else the selected preset's name — and the engine auto-resumes an unfinished deployment under that id (unless `--restart`), starting a fresh ordinal-suffixed one when all prior deployments are complete. Normative spec: [plans.md → Presets](plans.md#presets), [→ Preset selection](plans.md#preset-selection), [→ Deployment id & re-runs](plans.md#deployment-id--re-runs).

**Why.** The v1 surface had a base value layer (`defaults` + per-chain constants/secrets) that a preset replaced *wholesale*, which made the base values dead config the moment any preset was active. A survey of all 28 live v1 execution configs showed the pattern unambiguously: every single one had an `active_preset` set, base per-chain constants were empty in all of them, and base `defaults.constants` were empty or shadowed. In practice a new launch is captured as a new preset (kept for history), so the preset — not the file — identifies the launch; deriving the deployment id from the preset name removes the last reason to mutate a plan file per launch, and the same fact makes `deploy` data (salts are per-launch: same salt + factory + deployer = same address) belong inside the preset. Keeping presets wholesale-isolated (rather than merging over a base) preserves the property that made the old wholesale rule right: **a preset is auditable in isolation** — no silent cross-environment inheritance of a deployer key or owner address because an override was forgotten.

**Rejected.**

- *Presets as deltas merged over base defaults* — destroys isolation: a `staging` preset that forgets to restate `secrets.privateKey` silently deploys with the prod key inherited from the base. Merge mechanisms already exist where merging is wanted (deployment overrides; the preset-internal `defaults` → chains merge).
- *Keeping the base value layer as an optional no-preset path* — unused in practice (28/28 configs preset-driven), and it forced the "preset replaces wholesale, except `salts`/`factories` which deep-merge across layers" carve-out. With values preset-only, the cross-layer carve-out disappears; what remains is the ordinary merge inside one preset.
- *`deploy` block at the base plan level as shared structure* — considered on the grounds that salts determine address identity (structure-adjacent), but salts are per-launch data: repeat launches need fresh salts, vanity salts are mined for one specific address, and staging vs prod want different addresses. Genuinely universal factories are `${global.X}` refs anyway.
- *Auto-generating deployment ids from timestamps/random* — breaks retry: results are keyed by deployment id (`run-N.yaml` attempts accumulate under it), so a fresh id per invocation would fork a new results tree on every retry. The preset-derived id plus resume-unfinished/new-when-complete keeps retries in the same deployment by default.

**Consequences.** Plan files are static launch surfaces — a launch adds a preset, never edits identity fields. The load order loses the "defaults merged into chains then emptied" top-level step (it survives only preset-internally). A `saltBase` embedding `${system.DEPLOYMENT_ID}` now depends on a run-time-derived id — addresses are reproducible only if the id is (see [plans.md → Deployment id & re-runs](plans.md#deployment-id--re-runs)). (The `verificationApiKey` tri-state that once inherited through the preset's `defaults.secrets` was later removed altogether — see [Chain connection registry](#chain-connection-registry).)

## Single-action plans

**Decision.** A plan may run **one action without a workflow** — for launches that are genuinely one step run once on one or many chains (transfer ownership, mint an NFT, one standalone contract deployment). The plan's `workflow:` field takes **two forms**: a string (a workflow id, the normal case) or an **inline step object** — the same grammar as a `workflows.yaml` step, restricted to `action` (required), `method`, and `factory`; `id`, `mappings`, and nested `workflow` are rejected. The engine lifts the inline step into a one-step workflow (step id = the action's default step id; results keyed by the FQ action id in place of the workflow id) and everything downstream runs unchanged: presets, deployment overrides, release selection, the salt ladder, idempotency/resume, dry run, records, and multisig mode. There is **no wiring surface**: inputs resolve from same-named preset constants, built-ins from `builtin.<NAME>` constants, the signing key from `secrets.privateKey` — no `mappings`, no multi-PK renames. Normative spec: [plans.md → Single-action plans](plans.md#single-action-plans).

**Why.** Authoring a one-step workflow in `workflows.yaml` for every one-off call is pure ceremony: it adds a file entry, a name, and a review surface for something with no order, no wiring, and no reuse — the three things workflows exist for. Putting the declaration in the **plan file** (rather than the CLI) keeps the launch auditable the same way every other launch is: the plan is the committed record of what ran, presets capture per-launch values, and the deployment-id/results machinery keys off it unchanged. Making the object form **literally a step** keeps the method-placement invariant intact with zero new grammar: `method`/`factory` stay step fields (the step just happens to be written in the plan file), presets still cannot touch structure, and promotion to a real workflow is cut-and-paste — the inline object moves into a `steps:` list unchanged.

**Rejected.**

- *A CLI selector* (`run --action <id> -e <values-plan>`) — the action choice would live only in shell history; the plan would stop being the self-contained launch record, and results keying, deployment-id derivation, and `validate` would all need an invocation-supplied structural input. The CLI selects *among* declared config (plans, presets, multisig entries); it never declares structure.
- *Sibling top-level fields* (`action:` mutually exclusive with `workflow:`, plus plan-level `method:`/`factory:`) — the earlier draft. It scatters one concept across four top-level keys, needs a both/neither `oneOf` error class, and hosts step fields at a level where they exist nowhere else. The inline-step form expresses the same thing with the existing step grammar and one field.
- *Auto-generated one-step workflows in `workflows.yaml`* (tooling writes the wrapper for you) — solves typing, not ceremony: the generated entries still pollute the workflow namespace and reviews, and drift when the action interface changes.
- *A `mappings` surface on the inline step* — with no prior steps there is nothing to wire; renames alone don't justify importing the workflow wiring grammar into plans. Constants-by-name plus `builtin.<NAME>` keys cover the entire input surface of one step.

**Consequences.** The plan's `workflow` field is the one deliberately polymorphic field in the config set (string | inline step) — acceptable because both forms answer the same question, "what does this plan run". The results tree gains FQ-action-id keys alongside workflow ids (dots in the directory name distinguish them naturally). Multisig covers the flagship use case — a Safe-executed ownership transfer is `run -e <plan> --multisig <entry>` with no workflow authored. Deploy salt/factory data keys off the implicit step id, so promoting a single-action plan to a workflow later may require re-keying `deploy.salts` / `deploy.factories` entries.

## Chain connection registry

**Decision.** [known-chains.yaml](known-chains.md) is the **single source of truth for all chain connection settings** — chain identity plus named **RPC profiles** (`rpc.<name>: { url, headers }`) and named **verification profiles** (`verification.<name>: { type, api, api_key }`, where `type` is the API dialect: `etherscan` / `blockscout` / `sourcify`). Plans reference chains by **name only**, with two optional selectors on the chain reference: `rpc: <profileName>` and `verifiers: <name> | [names] | false` (both defaulting to the `default` profile). The plan-side connection fields (`chain_id`, `rpc_url`, `verification_api`) are removed, as is the plan secret slot `verificationApiKey` with its `""` tri-state — explicit disable is `verifiers: false`. Connection credentials route through the vault like every other credential: `api_key` is a single `${vault.X}` / `${env.X}` token (no literals); RPC `url` and header values may embed refs **inline** (the documented exception to the single-token vault rule), with resolved ref fragments displayed as their labels in engine output (originally headers-only with wholesale redaction — extended and refined by [Vault redaction](#vault-redaction-show-the-reference-never-the-secret)). Load-time behavior is a **pure lookup + selection** — no merge; unknown chain or profile names are hard errors. One-off endpoint changes go through CLI / deployment overrides, never plan fields. Normative spec: [known-chains.md](known-chains.md); plan-side selectors: [plans.md → ChainConfig fields](plans.md#chainconfig-fields); credential rules: [secrets.md → Connection credentials](secrets.md#connection-credentials-known-chains).

**Why.** Chain connectivity is environment infrastructure, not launch data — the same RPC endpoint and explorer account serve every workflow, so redeclaring them per plan produced drift and made rotation an every-file edit. The earlier halfway design (known-chains holds *defaults*, plans may *override*) still left two sources of truth and a merge whose outcome depended on both files. Named profiles solve the two real multiplicities without overrides: several endpoints per chain (public default, authenticated private, archive) and several verification targets per chain (Etherscan and Blockscout; the same explorer under different team accounts). The plan keeps only **choices** — which chain, which profiles — which matches the three-layer model (structure / wiring / values) and the way `releases:` already works: the plan selects, another file owns the data. Moving `verification_api_key` out of plan secrets also removed the last credential authored outside the vault indirection.

**Rejected.**

- *Defaults + per-plan override merge* (the previous design) — two sources of truth; a plan could silently pin a stale endpoint; the merge made resolved connectivity depend on plan state.
- *Keeping `verificationApiKey` as a plan secret* — per-launch explorer keys had no motivating case that named profiles (different accounts = different profiles) don't cover, and the `""` tri-state was a poor disable switch.
- *Ordered failover URL lists instead of named profiles* — failover is engine runtime behavior, not config shape; named profiles cover the "several providers" need and a `urls:` list can be added to a profile later without structural change (still open).
- *Per-connection verification settings* — the explorer does not depend on which RPC endpoint a run uses; coupling them would force profile duplication.

**Consequences.** A chain used by any plan needs a known-chains entry with a selectable RPC profile. The "chain missing from known-chains" check hardens from warning to error. `${system.RPC_URL}` resolves from the selected RPC profile. Multi-verifier selection means one verification pass per selected profile in the bundled machinery; author-written commands receive the first profile's context (a known interface limitation — see [engine-internals.md → Verification](engine-internals.md#verification)). Profile names join chain names as wide-blast-radius identifiers (renames break plan references).

## Chain sets: selector-carrying groups in known-chains

**Decision.** `known-chains.yaml` gains a reserved top-level `sets:` key declaring **named chain sets** — chain groups whose members carry the same `rpc:` / `verifiers:` selectors a plan chain entry does (a set is a named, pre-authored plan `chains:` block). A plan references at most one set via the reserved `$set` key of its `chains` block; the set expands at the chain-resolution step (before preset selection), explicit plan entries **merge over** set entries by chain name (plan wins) and may add chains beyond the set. Preset chain filters apply after expansion, unchanged. For a fresh deployment, `deployment.yaml` records the set name and the resolved chain list; a **resume runs against the recorded list, never a re-expansion** — a chain added to the set mid-deployment is skipped with a warning, includable only via explicit `--chain`. Set integrity (members exist with selectable profiles) validates at registry load; sets do not nest. The run header and `--dry-run` print the expanded chain list with the set name. Normative spec: [known-chains.md → Chain sets](known-chains.md#chain-sets), [plans.md → Chain sets](plans.md#chain-sets-set).

**Why.** With explicit-only chain lists, growing the fleet is one edit per plan — the one fleet-level change the "changing connectivity never touches a plan" invariant didn't cover. Sets centralize membership *and* the selector policy that goes with it ("prod uses the private RPC and verifies on both explorers" is fleet policy, owned by whoever maintains the registry, not something restated per plan). Making a set member the exact `ChainConfig` shape keeps one grammar — `$set` is macro expansion of a chains block someone already wrote — and keeps the capability/selection layering: chain entries declare capabilities, sets declare named selections, plans pick a selection. Housing sets in known-chains makes their validation self-contained (members and profiles resolve within the same file, checked once at registry load, not per consuming plan). The `$` prefix makes the reference collision-proof inside a map of chain names (`set` itself is a legal chain name). The deployment record plus the resume freeze preserve the audit and safety story that explicit lists provided: `deployment.yaml` fixes intent (set name) and fact (membership at creation), and a grown set can never silently widen a half-finished launch — the failure mode that makes implicit chain scope dangerous in a tool that signs transactions.

**Rejected.**

- *Making the plan's `chains` block optional with a registry-side default set* — the original motivating idea. Omission as meaning kills the load-time guard (a deleted `chains:` block silently becomes "deploy everywhere"), changes every defaulted plan's blast radius on a single registry edit, and behaves inconsistently across plans (preset chain filters make the default invisible to some presets and not others). An explicit reference keeps intent in the plan file and in its git history.
- *Name-only sets (selectors stay per plan)* — forfeits the fleet-policy centralization that is half the benefit; every plan referencing the set would restate the same `rpc: private` / `verifiers:` lines, drifting independently.
- *Sets in a separate `chain-sets.yaml` (or in `global-params.yaml`)* — turns the self-contained registry-load validation into another cross-file pass and adds a config file for no gain; global-params is a value registry, not structure.
- *`${set.NAME}` substitution syntax* — wrong tool: `${...}` namespaces are value substitutions resolved in the ten-step pipeline; the set reference is structural, in key position, resolved at chain-resolution time.
- *Re-expanding the set on resume* — reintroduces silent widening exactly where it is most dangerous (an unfinished deployment with recorded addresses and a deployment id that predates the new chain). Records-win is the established rule (multisig `proposed` batches); the chain list follows it.

**Consequences.** Set names join chain and profile names as wide-blast-radius identifiers (a rename breaks every referencing plan). A set-referencing plan targets chains its file never names — offset by the expanded-list display in the run header / `--dry-run` and by the `deployment.yaml` provenance record. The strict-resolution rules (`${global.X}` miss, missing create3 factory) become the load-bearing guard for under-parameterized chains joining a set: a new fleet chain a preset lacks values for fails at load, per chain, rather than deploying with wrong fallbacks. Presets that filter chains explicitly opt out of fleet tracking — pinning for production presets is a feature, but fleet changes don't reach them. A built-in `all` set (every registry chain) is deferred until a need shows up.

## Resume freeze: frozen parameters, fingerprinted structure

**Decision.** A deployment's resolved inputs are **fixed at creation**, and every resume reconciles this invocation against the records instead of re-deriving from the current configs. Three layers, one records-win principle:

1. **The chain list** — recorded in `deployment.yaml`; resume never re-expands a chain set (decided with [Chain sets](#chain-sets-selector-carrying-groups-in-known-chains)).
2. **The parameter set** — phase 4 writes `config_snapshot.yaml` at creation: resolved constants and deploy data for **every declared chain** (in scope or not), `${random.N}` generated once and fixed, secret-tagged values excluded (they re-resolve live and never persist). A resume runs with the snapshot; plan edits since launch produce a **warning naming the changed keys** and the frozen values win; `--set` / `--overrides` on a resume error. Adopting new values is explicit: `--refreeze` (discard the snapshot, re-resolve as a first run — current plan, this invocation's overrides, fresh randoms — rewrite the snapshot, record the event in the attempt record) or `--restart`. A chain added to the plan *file* after launch resolves fresh on its first attempt, then freezes.
3. **The structure** — `deployment.yaml` records a **fingerprint**: a hash over the canonical execution-plan structure (ordered step ids, action ids and definitions, resolved methods, factory flavors, key slots, declared pin refs — not values, not the chain list, not `branch`-pin HEADs). A mismatch on resume is a **hard error** recommending a new deployment under a new id.

Normative spec: [phase 4 → The parameter freeze](../architecture/phase-4-deployment-resolution.md#the-parameter-freeze-on-resume) and [→ The structural fingerprint](../architecture/phase-4-deployment-resolution.md#the-structural-fingerprint-no-resume-across-a-changed-shape); [plans.md → Deployment id & re-runs](plans.md#deployment-id--re-runs).

**Why.** A deployment routinely spans invocations across hours or days — multisig signature waits, failed-chain retries — and the plan file keeps living meanwhile. Without a freeze, chains resumed later silently run with different owners, salts, or addresses than the chains launched first: a divergence no record explains and no operator intended. The severity split matches recoverability. Value drift is representable — the frozen values simply *are* what the deployment is, so the engine warns and continues, and a 2 a.m. retry isn't blocked because a colleague edited the plan for next week's launch. Structural drift invalidates resume's premise — recorded results are keyed by step ids whose meaning changed, and replaying them against a different plan fabricates history — so it refuses. Randoms freeze with everything else because a random salt regenerated between invocations would put sibling chains at different addresses — the exact franken-deployment the freeze exists to prevent. (This narrows [`${random.N}`: test-only, no determinism](#randomn-test-only-no-determinism): fresh per *deployment*, no longer per load.)

**Rejected.**

- *Re-resolve on every invocation (no freeze)* — the failure mode above; also what v1 effectively did.
- *Hard error on value drift* — punishes the common benign case (a plan edited for a future launch while this one finishes) and pushes operators toward `--restart`, abandoning recoverable work.
- *Silently honoring `--set` / `--overrides` on resume* — per-invocation divergence with no single record of what the deployment ran with. The explicit `--refreeze` keeps one authoritative snapshot and leaves an audit trail.
- *Freezing secrets* — key rotation mid-deployment is normal operations, not drift; secrets re-resolve live on every invocation and never persist (redaction guarantees stay intact).
- *Hashing resolved `branch`-pin HEADs into the fingerprint* — a mutable pin pulling new commits is declared, recorded behavior ([phase 6](../architecture/phase-6-repo-prepare.md)); freezing it would contradict the pin's own contract. The declared *ref* is hashed, so retargeting a pin does trip the check.

**Consequences.** `config_snapshot.yaml` is promoted from convenience record to **normative resume input** — and becomes the one record that can be rewritten, by explicit `--refreeze` only, the event recorded. A refreeze regenerates randoms: remaining `create2`/`create3` steps derive new salts while already-deployed addresses keep the old ones — deliberate, but worth knowing before refreezing a half-deployed run. `--dry-run` against an unfinished deployment prints the frozen-vs-current diff, so drift is inspectable before an invocation runs. The multisig `proposed`-batch rule (re-verify, never re-plan) becomes an instance of the same principle rather than a special case.

## Multisig execution backends: multisend first, merkle second

**Decision.** Multisig deployment (sender = a Gnosis Safe instead of an EOA) is built as **one planning phase + two execution backends** over a shared, backend-agnostic planned-transactions artifact. The mode is a **run parameter** (`--multisig <name>` selecting a named entry in a new registry file, `multisig.yaml`) — never a plan field; plans, workflows, and actions are untouched. The two backends:

- **`multisend`** (ships first) — the run's transactions per chain are wrapped in one Safe MultiSend batch and proposed to the Safe Transaction Service via a delegate proposer key. Owners sign one hash per batch per chain in the standard Safe UI. Zero custom on-chain code.
- **`merkle`** (second) — every transaction of the run (all chains, all batches) becomes a leaf of a Merkle tree; owners sign the root **once**; an executor key runs the leaves through a **Safe module** enabled on the Safe, one on-chain transaction per leaf. The module contracts are **reused from Sphinx** (`sphinx-labs/sphinx` — MIT-licensed, audited; the Gnosis Safe contracts they consume as a library are LGPL v3, the same license the Safe itself carries) rather than written in-house.

There is **no automatic chunking by gas**: a multisend batch that exceeds one-transaction limits fails at planning time with a recommendation to switch the entry to `backend: merkle` (each leaf is its own transaction — no ceiling). Batches split only at semantic boundaries (a step must read chain state created earlier in the same pending batch). Normative spec: [multisig.md](multisig.md).

**Why.** The two backends have opposite cost profiles, and both profiles occur in practice. MultiSend rides entirely on standard Safe infrastructure — no contract to audit or deploy, owners keep the UI they already trust — which makes it the right first implementation and the right default for single-chain or few-chain launches. Its costs are structural: signatures scale as `chains × batches` (a Safe transaction is a per-chain, per-nonce object), and the whole batch must fit one transaction. The Merkle design inverts both costs (one signature total, per-leaf execution) at the price of a trust-critical module: an enabled Safe module executes without per-transaction owner signatures, so a module bug is a Safe compromise. That price is acceptable because (a) the Sphinx module exists, is MIT-licensed, audited, and spec-documented — reusing it avoids shipping novel security-critical Solidity; and (b) deploy-pad already operates per-chain infrastructure contracts (the CREATE3 factories), so a per-chain module is operationally familiar. Making both backends drive off one planned-transactions artifact keeps the expensive part (planning, address prediction, review reports, resume) written once.

Sender-mode configuration lives in its **own registry file** (not in plans, not in global-params) for two reasons: which Safe deploys is infrastructure identity, not launch data — the same argument that moved connection settings to known-chains; and a separate file is a natural allowlist — CI environments mount only the multisigs they are permitted to use.

**Rejected.**

- *Per-transaction Safe signing (no batching)* — the naive mapping of the current one-tx-per-step flow onto a Safe; ten deployments = ten ceremonies per chain. The problem statement, not a design.
- *Sender config in the plan preset (a `sender:` block)* — earlier draft. It couples a reusable launch surface to an infrastructure identity and forces plan edits to switch sender; run-parameter + registry keeps one plan launchable as EOA on staging and as a Safe on prod unchanged.
- *Sender config in `global-params.yaml`* — workable, but global-params travels wholesale; a separate file lets CI mount only the allowed multisigs.
- *Automatic gas-based batch chunking (multisend)* — silently changes what owners sign; batch composition must be deliberate. The failure-plus-recommendation keeps the decision with a human, and the merkle backend is the honest fix.
- *Writing our own Safe module* — novel security-critical Solidity with an audit bill, duplicating an existing MIT-licensed, audited implementation.
- *Adopting Sphinx wholesale as the deployment platform* — Sphinx is a full product (its own CLI, plugin surface, and a since-sunset hosted service) built around Foundry projects; deploy-pad needs multisig execution under its own planning/results model. Reusing the on-chain layer and the Merkle-tree spec takes the audited part without importing the platform.

**Consequences.** A run gains a *waiting for signatures* state — the engine exits cleanly mid-deployment and any later invocation under the same deployment id polls and continues (the existing auto-resume model absorbs this; the recorded `safeTxHash` / root is authoritative — re-planning a signed batch is forbidden). Verification moves out of the execute phase into a post-execution verify-only pass (nothing deploys while the command runs). Author-command deploying actions need an explicit `supportsMultisig: true` opt-in plus honoring a planning contract (`SYS_MULTISIG` / `SYS_SENDER_ADDRESS` in, `.deploy-pad-transactions.json` + predicted `.env.outputs` out); bundled contract types comply automatically; Hardhat 3 types are unsupported in this mode (Ignition exposes no dry-run transaction extraction). Caller-namespaced CREATE3 flavors (`createx` / `solady`) bind predicted addresses — and mined vanity salts — to the Safe's address; `oneInch` addresses don't move, but the Safe must own the factory.

## Multisig deferrals: batch barriers, proposal staleness, multi-Safe

**Status.** All three follow-up questions the multisig design opened were reviewed and **deliberately deferred** — none blocks the engine's architectural design, and each returns to the table when a real workflow hits its case. The live tracker is [multisig.md → Open questions](multisig.md#open-questions).

- **Batch-boundary declaration (`barrier: true`).** Semantic batch boundaries are engine-detected only for `contract-call` reads; an author command that reads the chain *internally* is invisible to the engine and would plan against a chain that lacks its batch-mates' effects. The candidate fix is an explicit per-step hint ("execute everything planned so far before this step"). Deferred: no real workflow has hit the case yet, and until one does the cost is a documented authoring constraint rather than a trap the engine could otherwise detect.
- **Proposal staleness.** A `proposed` batch signed weeks later executes against a chain that moved on — the predicted addresses stay valid (deterministic methods), but gas prices and factory ownership may not. Candidate: a resume warning when a proposal is older than N days. Deferred: a cheap, purely additive warning whose threshold wants operational data before it is picked.
- **Multi-Safe runs.** One registry entry = one Safe identity across chains (differing per-chain Safe *addresses* are already covered). Steps of one chain alternating between different Safes would need per-step sender selection — a new structural surface with no motivating case. Deferred until a real need shows up.

**Consequence for the engineering design.** Phase 7's multisig branch should treat these as known extension points — a place a boundary rule could be injected before batch cutting, a staleness check on the poll-and-advance path, sender identity resolved once per run rather than per step — without designing the features themselves.

## Value transforms

How a deployment input's value is *shaped* before it reaches the contract or command. Normative spec:

- [actions.md → Input shape: arity and encoding transforms](actions.md#input-shape-arity-and-encoding-transforms) — action-side surface.
- [workflows.md → Production pipeline: transforms, combine, and split](workflows.md#production-pipeline-transforms-combine-and-split) — workflow-side surface.
- [references.md → Transforms vs. `${...}` substitution](references.md#transforms-vs--substitution) — relation to substitution.
- [engine-internals.md → Transforms](engine-internals.md#transforms) — mechanics.

### The problem

A deployment input frequently needs its value *shaped* before it reaches the contract or command:

- A constructor wants a `bytes32` but the operator has a human-readable label (`"1inch SwapVM v1"`).
- An upgradeable-proxy step needs `initData` — ABI-encoded calldata assembled from several values, one of which must itself be `keccak256`'d first.
- A constructor takes an `address[]` whose elements come from a mix of prior step outputs and plan constants.

These are different *kinds* of shaping, they depend on **different knowledge** (the contract's required format vs. where the data comes from), and they sometimes **chain**. The design question: where does each kind live — on the action (structure), the workflow (wiring), or the plan (values)?

### The core tension

Two positions framed the discussion:

- **"Put transforms on the action."** The action knows the contract's required format (a salt is `bytes32`, period). Putting the coercion there makes it an invariant fact stated once.
- **"Put transforms on the workflow."** Transforms depend on the *data source* and its format — and the source (another step, a constant) is only known to the workflow. Compositional cases (`abiEncode` of several sources, with `keccak256` applied to one of them first) are inherently a wiring concern. Action-only placement kills that flexibility.

Both are right about different things. The resolution is a **hybrid** built on a clean split of *kinds*.

### Decision 1 — Three orthogonal axes

**Decision.** Split shaping into three independent axes:

- **Extraction (array→scalar, split)** — pick one element out of an array-valued source. Schema slot: `pick` (with index sugar `stepId.OUTPUT[i]`).
- **Encoding transforms (1→1)** — coerce a single value's form. Schema slot: `transform`. Bounded set (`salt`, `keccak256`).
- **Structural transforms (N→1)** — combine multiple source values into one. Schema slot: `combine`. (`array`, `abiEncode`, `abiEncodePacked`, `abiEncodeWithSignature`.)

**Why.** The axes have different cardinality, different required knowledge, and different validation. Conflating them into one "transform" concept forces every rule to special-case which kind it's talking about. As orthogonal axes, each gets a clean home and a clean rule set, and they still compose (`keccak256(abiEncode(...))`, `keccak256(pick(...))`). `pick` is the dual of `combine` — it exists because v2 has first-class `array: true` step outputs and a downstream step may need one element in a scalar input.

**Rejected.** A single flat "transforms: [...]" list mixing coercion and grouping — it muddies cardinality (is the output one value or many?) and placement (grouping can't live on an action; coercion can). Also rejected: **transform steps** (dedicated pseudo-steps in the workflow `steps:` array performing shaping). Steps carry lifecycle semantics — result records, idempotency lookup keyed by step id, unique ids, aggregated-interface participation — that pure, deterministic in-engine computations don't need; step-ifying them would pollute run records, invite stale idempotent replays when inputs change, and kill the terse list sugar for the common cases.

### Decision 2 — Placement follows the three-layer model

**Decision.**

| Axis | Lives on | Role |
|---|---|---|
| Encoding (`transform`) | the **action input** | *authoritative* input-format coercion (the contract's required form) |
| Encoding (`transform`) | a **workflow source** | *adaptation* — massage an incoming value toward the action's format |
| Structural (`combine`) | the **workflow mapping** | assembly of multiple sources into one value |

Plans still supply only leaf values.

**Why.** This keeps the existing mental model intact — *action = structure, workflow = wiring, plan = values*. The action declares the invariant (the format the contract demands); the workflow knows the data sources, so it owns adaptation and assembly. Structural combine is *necessarily* workflow-only: only the workflow knows there are multiple sources.

**Rejected.** Action-only (loses source-dependent adaptation and all compositional/`abiEncode` cases) and workflow-only (loses the invariant input-format contract — every workflow would have to restate the salt coercion, and could get it wrong).

### Decision 3 — The action transform is authoritative and not overridable

**Decision.** An action's declared `transform` is part of the input's contract. A workflow can **add** adaptation transforms (applied before), but it cannot disable or replace the action's transform, which is always applied **last**.

**Why.** The input's format is a fact about the contract, not a per-environment choice. If a workflow could override it, a workflow could feed the contract a wrong-format value and silently break the deployment. Making it additive-only means a workflow can only ever move a value *toward* the required format, never away from it.

**Rejected.** Letting a workflow transform override the action default. It reads as flexible but actually breaks the contract guarantee — and the legitimate flexibility (adapting a differently-shaped source) is fully served by additive per-source transforms.

### Decision 4 — Fixed application order

**Decision.** For an input `K`:

```
final = actionTransform( combine( perSourceTransform( pick(source_i) ) ) )
```

1. resolve each source, 2. apply per-source `pick` (extraction), 3. apply per-source encoding (adaptation), 4. apply `combine` (assembly), 5. apply the action's encoding (authoritative) last.

**Why.** Each stage operates on the right granularity: adaptation normalizes *each source* before they're mixed; assembly needs already-adapted elements; the destination-format coercion must be the final word, so it composes correctly even on a `bytes` value produced by a combine. The order falls directly out of Decisions 2 and 3.

### Decision 5 — Encoding transform is scalar-only

**Decision.** An action `transform` is valid only on a **scalar** input (including `bytes`); it is rejected on `array: true`. Per-element encoding of an array lives in the workflow, per source.

**Why.** An encoding transform coerces *one* value. An array has no single value to coerce, and "apply this to every element" is a different operation that belongs where the elements are known and may differ (the workflow). Allowing it on arrays would invite ambiguity (whole array? each element?).

### Decision 6 — Per-source transforms are independent (heterogeneous)

**Decision.** Inside one `combine`, each source carries its own (optional) encoding chain. You can hash some elements and pass others through, mixing step outputs and constants freely.

**Why.** Real cases are heterogeneous: a `bytes32[]` where some entries are already-hashed `0x` values and others are human labels to `keccak256`; a proxy `initData` where one argument is hashed and the rest are passed as-is. Forcing one uniform transform across all sources would make these impossible without a pre-step.

### Decision 7 — Bounded encoding set; `checksum` dropped

**Decision.** The encoding registry is `salt` and `keccak256` only. `checksum` (EIP-55 address casing) was considered and dropped. A future honest `address` validate/normalize transform is the candidate if address hygiene is wanted (see [below](#future-address-validatenormalize-transform)).

**Why.** A small, meaningful registry beats an open-ended one. `salt` and `keccak256` change on-chain behavior in well-understood ways. `checksum` only changes casing — cosmetic, and weak as validation (it doesn't verify the address is real or correct), so it earns little for the surface-area it adds.

### Decision 8 — Full structural set in scope (not deferred)

**Decision.** `array`, `abiEncode`, `abiEncodePacked`, and `abiEncodeWithSignature` all ship together — the `abiEncode*` variants are **not** deferred.

**Why.** They share one mechanism with `array` (resolve sources → per-source encode → combine), differing only in output type and whether they take an argument. The motivating use case (upgradeable-proxy `initData`) *requires* `abiEncodeWithSignature` on day one, so deferring it would leave a first-class workflow unbuildable while shipping the strictly-easier `array`.

### Decision 9 — "Array is just one structural transform"

**Decision.** `array` is not a special case — it is the simplest `combine`. The bare list form `[a, b, ...]` is sugar for `combine: array`.

**Why.** Unifying array-building and ABI-encoding under one `combine` concept means one parser, one validation path, one application stage. The list sugar keeps the overwhelmingly common case (assemble an array) terse, while the object form scales up to the encode variants.

### Decision 10 — The encode variants take an explicit type/signature argument

**Decision.** `abiEncode("address,uint256")` / `abiEncodePacked(...)` take a comma-separated type list; `abiEncodeWithSignature("initialize(address,bytes32)")` takes a full function signature (which also yields the 4-byte selector).

**Why.** deploy-pad values flow as **untyped strings**, and the destination is a `bytes` input — opaque. Neither the source nor the action carries the ABI types, so they cannot be inferred and must be stated on the `combine`. `abiEncodeWithSignature` doubles as the selector source for calldata.

### Decision 11 — Transforms are a separate mechanism from `${...}` substitution

**Decision.** The transform/combine machinery is a wiring-layer mechanism distinct from `${...}` substitution. `${...}` still does not apply inside workflows; `transform` values are transform names and `combine` values are op strings — never `${...}` tokens. Pipeline sources remain plain ref/rename strings.

**Why.** `${...}` resolves *named values into strings* at plan-load time; transforms *reshape already-resolved values* at step-input resolution. They operate at different times on different things. Keeping them separate preserves the rule that workflows are pure wiring (no substitution) and avoids overloading `${...}` with value-manipulation semantics.

### Decision 12 — `salt` transform is distinct from the deploy salt

**Decision.** The `salt` *encoding transform* (coerce an input value to `bytes32`) and the *deploy salt* (`deploy.salts.<stepId>`, used for CREATE2/CREATE3 address derivation) are separate concepts that happen to share one normalization rule (`0x`+64hex verbatim, else `keccak256(string)`).

**Why.** They look alike but serve different roles — one is an ordinary input's format, the other is engine deployment plumbing keyed by step id and never a declared input. Documenting them as distinct (with a shared rule) prevents authors from conflating them.

### Decision 13 — `combine` as the field name

**Decision.** The structural-axis field is named `combine` (over alternatives like `group` / `assemble`).

**Why.** It reads naturally for both `array` (combine values into a list) and the encode variants (combine values into a blob), and it's neutral about output type.

### Settled defaults and validation (consequences)

These fall out of the decisions above and are enforced at load / input-resolution:

- A list `from` with no explicit `combine` defaults to `combine: array`; the `abiEncode*` combines must be named explicitly and target a scalar `bytes` input.
- `combine` output type must match the input's arity: `array` requires `array: true`; `abiEncode*` require a scalar `bytes` input.
- Source count must match the `combine` argument's type/arg count.
- `pick` / `[i]` is valid only on an array-valued source (arity checked at validation time; index range at resolution time); an array source into a scalar input without a `pick` is an error (the dual of scalar-into-array).
- An action `transform` is rejected on `array: true`; a `combine` cannot nest inside a single source (a source's `transform` is encoding-only).

## Removed: legacy output-name transform

**Decision.** The old `${input.X | UPPER_SNAKE}` output-name transform was removed from the v2 design (unused in every live config).

**Why.** It was a string-casing helper on an output *key template*, not a value transform — a different surface entirely, and confusingly named like the new value transforms. Dropping it (along with the whole `${input.X}` output-template namespace) removes the collision. The rest of the output-mapping surface (`reported`/`exposed`, `${system.X}` templates in reported keys) was subsequently dropped too: templated output names existed to encode multiple values into dynamic keys, which first-class `array: true` outputs replace ([actions.md → Output shape](actions.md#output-shape-names-and-arity)). Output names are now plain declared identifiers. See [references.md → Transforms vs. `${...}`](references.md#transforms-vs--substitution).

## Strict miss behavior

**Decision.** **Strict by default, with a per-plan opt-out.** The plan gains a top-level **`strict` flag (boolean, default `true`)**. With `strict: true`, every `${...}` namespace throws on miss at its own resolution step — a lookup that fails aborts the plan load with an error naming the token, its location, and the chain (v1's asymmetry, where only env and vault threw, is gone). With `strict: false`, load-time misses of `${global.X}` / `${system.X}` / `${env.VAR}` in **plan values** (the selected preset's constants, `deploy`, and `secrets` values) are left in place and surfaced as **one aggregated warning pass**; a step that actually consumes an unresolved token still hard-fails at step input resolution, so an unresolved token never reaches a command in either mode. Always strict regardless of the flag: `${vault.X}` lookups, known-chains connection fields, actions `repository.auth`, and `${secret.X}` at step input resolution. Normative spec: [references.md → Overview](references.md#overview) and each namespace's "Behavior on miss."

**Why.** Fail-fast at load beats a literal `${global.WETHX}` string reaching a deployment command, and one uniform default beats per-namespace lore — so strict is the default. The opt-out exists because leave-in-place had legitimate uses — deliberate placeholder keys, chain-asymmetric globals in `defaults`, plans loaded on machines without deployment env vars — and each has an explicit strict-mode spelling (below), but the flag keeps a cheap escape hatch while those spellings prove themselves in practice.

**Obsolescence path.** The flag is transitional: if no real `strict: false` cases accumulate, it is removed and strict becomes unconditional. New plans should not set it without a concrete reason.

**Consequences (the explicit spellings that work in either mode).**

- **Intentional empties**: write `KEY: ""` — an empty string is a resolved value, not a miss. A dangling ref is never a valid way to say "no value."
- **Placeholders / templates**: keep them in a **non-selected preset** — only the selected preset is resolved, so misses there are invisible. (`strict: false` additionally tolerates unconsumed placeholders in the active preset.)
- **Chain-asymmetric globals**: a `defaults.constants` ref merges into and must resolve on *every* active chain. Reference globals that exist only on some chains from those chains' per-chain `constants` blocks instead.
- **Secrets** keep their existing timing (hard error at step input resolution, where the slot name is finally known after `mappings.privateKey` renames) — already throw-on-miss, unaffected by the flag.

**Rejected.**

- *Unconditional all-throw (no flag)* — the initial pick; softened to flag-with-strict-default because the explicit spellings above are untested against real authoring flows, and a boolean opt-out is cheaper to remove later than a missing escape hatch is to add under pressure.
- *Leave-in-place as the default + a post-resolution validation pass* — reports all misses at once, but makes the silent mode the default; strict-by-default inverts that. (The `strict: false` mode *is* this design, opt-in.)
- *Consumption-gated errors as the default* — the most permissive sound option, but it makes validity depend on the workflow × chain × variant combination as the baseline behavior. Consumption-gating survives only as the safety net inside `strict: false`.

## `${random.N}`: test-only, no determinism

**Decision.** `${random.N}` **generates fresh on each resolution, with no seeded form**. It is a test-only convenience for throwaway uniqueness (test salts, scratch identifiers, collision-free names in staging/testing presets). Anything that must be reproducible across runs — production CREATE2/CREATE3 salts, audited identifiers — uses a fixed plan value. Normative spec: [references.md → `${random.N}`](references.md#randomn--random-alphanumeric-strings).

**Scope narrowed by the [resume freeze](#resume-freeze-frozen-parameters-fingerprinted-structure):** "fresh" now means fresh per *deployment*, not per load. The value resolved at deployment creation freezes in `config_snapshot.yaml` with every other resolved value and is reused on resume — not because randoms gained replay machinery, but because *all* untagged resolved values did. A fresh deployment (or an explicit `--refreeze`) regenerates as before.

**Why.** The determinism candidates (persist-and-replay via `deployment.yaml`, a `seed=` form) all exist to make random values safe for production reruns — but a value that must be stable across runs is by definition a fixed value, and the plan already has a place for those. Adding replay machinery would blur the one clear property random has (fresh every load) and invite production use of a test tool.

**Rejected.**

- *Persist resolved randoms into `deployment.yaml` and replay* — as random-specific machinery, rejected: it would turn a stateless generator into hidden per-deployment state. (The resume freeze later delivered the same *effect* without the special case — randoms persist because every untagged resolved value does, uniformly, in `config_snapshot.yaml`.)
- *`${random.N|seed=...}`* — a seeded random is just an obfuscated constant.
- *A separate `debug.`/`test.` namespace replacing `random.`* — renaming doesn't change behavior, and one generator doesn't justify a seventh namespace. The test-only intent is carried by documentation and the caveat against use in production-typed presets instead.

## Config format versioning: every file

**Decision.** **Every v2 config file** carries the reserved top-level `version` key — `actions.yaml`, `workflows.yaml`, `plans/<workflow>.yaml`, `known-chains.yaml`, `global-params.yaml`, `multisig.yaml`, and `engine.yaml`. The semantics are identical per file: an exact comparison against the single format version the engine supports; a mismatch is a load-time error unless `--ignore-version` downgrades it to a warning; a missing key is always a warning. In map-shaped files the key is excluded from the name space by the same reservation mechanism as known-chains' `sets` (a chain, repo id, or workflow id cannot be named `version`). Normative spec: [engine-internals.md → Config version check](engine-internals.md#config-version-check); each file spec documents its own `version` row.

**Why.** Uniformity — one gate, one rule, applied at the same point of every file's load. The earlier state (only `actions.yaml`, `workflows.yaml`, and `engine.yaml` carried the key, while the other schemas *rejected* it) reflected where structural churn had happened so far, not a principle: it left the plan, registry, and multisig formats unguarded against exactly the silent-misinterpretation risk the gate exists to stop, and it made the loader's behavior file-class-dependent for no user-visible benefit.

**Consequences.** `version` joins `sets` as a reserved top-level name in `known-chains.yaml`; every schema declares the key; existing v2 files gain one line. `--ignore-version` remains a single run-level flag downgrading the gate on every file.

## Vault redaction: show the reference, never the secret

**Decision.** A value resolved through `${vault.X}` is **never displayed by the engine**. Wherever a string containing vault-resolved content would appear in engine output — terminal at any log level, the log file, every record — each vault-resolved fragment is replaced by its reference label, **`[vault.<name>]`**: `https://someurl.url/api?key=[vault.alchemyKey]`, `Authorization: Bearer [vault.rpcAuthToken]`, `privateKey: [vault.create3Deployer]` (a single-token value displays as exactly the label). The substitution follows the value wherever it flows — including a vault-carrying RPC URL surfacing through `${system.RPC_URL}` or `SYS_RPC_URL` in any engine output. Subprocesses and the network still receive the real resolved string (a URL must be callable; a key must sign). In known-chains connection strings (`rpc.<p>.url`, `rpc.<p>.headers`), inline `${env.VAR}` fragments are displayed the same way, as `[env.<VAR>]` — preserving the protection headers already had, now at fragment granularity. Non-vault secrets elsewhere (direct `${env.X}` or literals under plan `secrets:`) keep the existing whole-value redaction (`********` / `[redacted: <slot>]`). Normative spec: [engine-internals.md → Vault resolution and secret tagging](engine-internals.md#vault-resolution-and-secret-tagging); [known-chains.md → Credentials & secret handling](known-chains.md#credentials--secret-handling); [references.md → `${vault.NAME}`](references.md#vaultname--vault-registry).

**Consequences.**

- **`rpc.<p>.url` now accepts inline `${vault.X}`** (alongside `${env.VAR}`) — the recommended form for URL-embedded credentials (`https://eth-mainnet.g.alchemy.com/v2/${vault.alchemyKey}`). This closes the residual gap tracked as TODO item 7: a URL-embedded key routed through the vault can no longer appear resolved in logs, records, or the displayed `SYS_RPC_URL`.
- **The header-wholesale rule is superseded**: RPC header values switch from whole-value redaction to the same fragment display — strictly more informative (the non-secret parts of a header are author-written config), same protection for the secret bytes.
- The **single-token rules are unchanged** where the whole value *is* the credential: plan `secrets:` values, `verification.<p>.api_key`, `repository.auth`, multisig `proposer` / `executor`. There, the label display and the old redaction coincide.

**Why.** Label substitution keeps operational output readable — *which* endpoint, *which* header, *which* vault role fed a value — while guaranteeing the secret bytes never surface; it is the same debugging affordance the redaction labels always carried, generalized from whole values to fragments. Wholesale redaction could not extend to URLs without destroying their readability, and leaving URL-embedded keys unredacted (the previous state) was the last secret-flow gap in the config surface.

## Results persistence in CI: commit the tree back

**Decision.** The **results tree is committed back to the repository that carries the configs**, after every invocation, whatever its exit code — the recommended pattern for running unattended on an ephemeral runner. The engine is unchanged by this: it performs **no git operations on the workspace repository** (there is no `--commit-results` flag, and no credential is handed to it for that purpose), because persistence is workflow mechanics, not run behavior. What the engine owes the pattern instead is a **portable tree** — every path relative to `--results-dir`, no hostname or absolute path in any record — so that a deployment resumes from a fresh checkout on a different machine exactly as it would on the machine that started it. Normative spec: [ci.md](ci.md); the record-side properties are in [results.md → Designed for version control](results.md#designed-for-version-control).

**Why.** The resume model is entirely file-based by design ([Resume freeze](#resume-freeze-frozen-parameters-fingerprinted-structure)): retrying incomplete work, replaying idempotent steps, and polling a Safe proposal all read the tree the previous invocation wrote. A hosted runner starts from a clean disk, so without persistence every invocation looks like a fresh deployment — the failure is silent and expensive (a re-deploy instead of a resume; a second batch proposed while owners are still signing the first). Committing to git is then the option that costs nothing and *adds* something: the records are secret-free by construction and append-mostly immutable, so git holds them safely and conflict-free, and deployment history lands in the same reviewable diffs as the configs that produced it — the [config reviewability](../requirements.md) principle extended to the engine's output.

**Rejected.**

- *Build artifacts* (`upload-artifact` / `download-artifact`) — retention is capped while a multisig deployment can legitimately wait longer, and artifacts are scoped per workflow run, so "the latest state of this deployment" is not a thing you can check out. Kept for the `run.json` log, which is genuinely per-invocation.
- *`actions/cache`* — best-effort and evictable. Silently losing deployment state is the one failure mode this must not have. Right for `--repos-dir`, which is disposable by design ([phase 6](../architecture/phase-6-repo-prepare.md)).
- *External object storage* — works, and is the honest answer at organization scale, but it costs infrastructure plus a credential and moves the records out of the reviewable-git world. Documented as an option, not the default.
- *Engine-side persistence* (the engine commits and pushes its own results) — would hand the engine write access to the repository it was invoked from, add a git-remote failure mode to the end of every run, and duplicate what one workflow step already does well. The engine clones the *deploy* repositories it was told about; it does not touch the one its configs came from.

**Consequences.** `workspace/results/` is tracked and `workspace/repos/` is not. A workflow needs `contents: write` for its own repository (which the automatic workflow token grants — unrelated to the broader credential needed for cloning deploy repos), a `concurrency:` group so two invocations of one deployment cannot overlap, and a commit step that runs on failure and on the waiting state, not only on success. The portability obligation becomes a stated requirement (NFR-043) rather than an accident of the current implementation.

## The CLI is an adapter, not the engine

**Decision.** The CLI is the only interface the project **ships**, but it is not where behavior lives: it is a thin adapter that parses argv into the run context and hands it to the pipeline. Everything a command does is invocable **in-process**, with no dependency on argv, `process.exit`, or the console. Two seams follow from the existing phase boundaries, and both are stated as producer-agnostic:

- **The run context** ([phase 1](../architecture/phase-1-invocation.md)) — the invocation parameters. The CLI parser produces one today; a future SDK would construct one directly and enter at phase 2.
- **The config source** ([phase 2](../architecture/phase-2-load-validation.md)) — the raw config object graph (actions, workflows, plans, chains, and friends). The YAML loader over the mounted directory produces one today; a programmatic producer would build the same shapes, for which the `@deploy-pad/schemas` generated types are already the contract.

Two invariants keep the seams honest. **Validation is source-agnostic**: constructing configs programmatically replaces *parsing*, never the gates — schema, referential and value-resolution checks run identically whatever produced the graph, and diagnostics already model a fileless location. And **post-validation artifacts are never inputs**: nobody hands the engine a resolved plan or an execution plan, because that would bypass the gates and freeze internal artifacts into a public API. The mount-is-the-allowlist rule generalizes accordingly — the *config source* is the allowlist; for the directory source that is the mount, and for a programmatic source the embedding application owns it.

**Status.** The layering is decided and constrains the code now (NFR-060). The **published SDK surface is deferred** — exported entry points, semver commitments, progress events, typed results, and the resume story for non-file config sources are open (OI-17), and the visual editor remains out of scope. Until then the boundary is internal: real, tested, and not yet a promise to anyone outside the repository.

**Why.** Both future consumers — a UI that launches deployments and the visual editor that authors configs — need the engine's rules rather than its command line, and the alternative to a boundary is reimplementation, which is exactly the engine-versus-editor divergence the shared config contract exists to prevent. Deciding the *layering* now is nearly free because the phase model already provides it (each phase is a contract with a named input artifact); deciding the *published API* now is not, since an API with one caller is a guess about the second. Keeping validation on the far side of the seam is what makes the offer safe: a UI-built run fails the same way, with the same diagnostics, as a file-built one, so `validate` stays meaningful for both.

**Consequences.** The command-line layer holds argv parsing, output rendering and the exit code, and nothing else; a phase that wants to stop the run returns rather than exits. The generated raw-config types in `@deploy-pad/schemas` acquire a second job as the future builder contract, and because the schemas major equals the config format version, a programmatic builder's format compatibility is expressed by its dependency range — the version gate becomes a compile-time property for configs that were never parsed. Auditability is unaffected: a programmatically launched deployment records the same resolved values and is exactly as resumable, since the records freeze the *resolved* state rather than its source.

## Pluggable step components: collectors and verifiers

**Decision.** The step lifecycle's remaining engine-fixed machinery — **artifact/ABI collection** (the collect side) and **verification** — becomes pluggable **registered components under the same model as enrichers and writers**: each action type wires a minimal required default set in engine code (not removable, not reorderable from YAML), and authors may append extra registered components per action, exactly like the existing `enrichers:` / `writers:` fields. This closes TODO item 1 in the direction it proposed.

**Why.** Symmetry with the proven enricher/writer model: new collection or verification behavior (an extra artifact format, a bespoke verification flow for a script-class action) becomes an appended component instead of an engine-core edit, while per-type defaults preserve the correctness guarantees — the same engine-defaults-first / author-extras-appended argument documented in [engine-internals.md → Why most of this is engine-internal](engine-internals.md#why-most-of-this-is-engine-internal-in-v2).

**Status.** Direction decided; the **component contracts are not yet designed** — interfaces, per-type default sets, registry/naming, and how the [deployment interface's inline-verification contract](engine-internals.md#the-deployment-interface) (`SYS_VERIFY`, command-side verification) and the multisig verify-only pass map onto verifier components are specified as part of the step-lifecycle architectural design (the engine-internals / phase-7 work). Until then, [engine-internals.md](engine-internals.md) describes collect and verification as engine-fixed behavior — that text is the current state, this entry is the agreed direction.

## Format migration

**Status.** v2 moves all configs to YAML (JSONC → YAML), plus the code/workspace/v1-doc rename from [Terminology rename](#terminology-rename). The migration plan (when, how, backward compatibility) is **deferred** — tackled as a coordinated sweep once this design set stabilizes.

## Rejected namespace candidates

**Decision.** The two candidate namespaces are **rejected — no use case**. The six existing namespaces (`global.`, `system.`, `secret.`, `vault.`, `random.`, `env.`) are the closed set. With this, no substitution-system question remains open ([references.md → Open questions](references.md#open-questions--candidates-for-v2-redesign) records everything as resolved).

- **`${chain.FIELD}`** (general accessor into the current chain's known-chains entry) — the chain fields plans actually consume already have `${system.X}` forms (`CHAIN_ID`, `CHAIN_NAME`, `RPC_URL`). A general accessor adds nothing consumed today and would leak connection-registry internals — profile lists, credentialed header values — into the values layer, cutting across the secret-tagging boundary.
- **`${prev.STEP_ID.OUTPUT}`** (prior step outputs in plan constants) — step-output wiring is the workflow's job: `mappings` already reference `stepId.OUTPUT`, with the full transform/combine machinery, at step input resolution. Constants resolve at load time, before any step runs, so supporting this would break the load-time resolution model to duplicate a channel that exists where it belongs.

## Future: `address` validate/normalize transform

**Candidate.** An honest `address` encoding transform that validates an address and/or normalizes it (the reframed, useful successor to the dropped `checksum` — see [Decision 7](#decision-7--bounded-encoding-set-checksum-dropped)). Only worth adding if address hygiene becomes a real requirement; it would slot into the existing encoding registry with no structural change.
