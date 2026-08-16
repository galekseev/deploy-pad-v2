# Known chains

The **single source of truth for all chain-dependent connection settings**: chain identity (name → numeric id), RPC endpoints, and verification (block-explorer) APIs with their credentials. Changing an RPC URL, a verification API, or an API key means changing it **here** — never in a plan. Other configs reference chains by name and, where several options exist, select a named profile.

## Purpose

Three things use chain names:

- **Plans** — keys of `chains.<name>` blocks (name references plus profile selectors — no connection values)
- **Global parameters** — keys of `chains.<name>` overrides
- **Tooling** — editor chain pickers, CLI helpers (e.g. wallet/RPC utilities)

Each consumer needs to map a name back to a numeric chain id and to concrete connection settings. Rather than redeclaring these in every consumer, deploy-pad keeps them in one file. This also gives a deliberate "list of supported chains" — adding a chain to deploy-pad starts with adding an entry here.

Beyond identity, each chain carries its **connection data**:

- **RPC profiles** — one or more named endpoints (different providers, a public default plus an authenticated private one, …). A plan picks one by name via its `rpc:` selector; omitted, the `default` profile is used.
- **Verification profiles** — one or more named explorer APIs (Etherscan, Blockscout, Sourcify; or the same explorer under different accounts). A plan picks one or several via its `verifiers:` selector; omitted, the `default` profile is used.

The registry also declares **[chain sets](#chain-sets)** — named, selector-carrying chain groups (under the reserved `sets:` key) that a plan can reference wholesale via `$set` instead of listing chains one by one. Adding a chain to the fleet then means one edit here, not one per plan.

The invariant this buys: **changing connectivity never touches a plan.** Plans carry only choices (which chain, which profile — or which set); the values live here. One-off endpoint changes for a single launch go through the CLI / deployment overrides — also never plan fields.

This config is not workflow-specific and does not vary across deployments.

## Structure & fields

### Top-level shape

A top-level YAML mapping. Each key is a chain **name**, except two reserved keys: `version` (the config format version — same rules as every config file, see [engine-internals.md → Config version check](engine-internals.md#config-version-check)) and `sets:` (see [Chain sets](#chain-sets)). Each chain value is an object with `chain_id` plus `rpc` and optional `verification`:

```yaml
version: 2                          # reserved key — config format version
sepolia:
  chain_id: 11155111
  rpc: "${env.SEPOLIA_RPC_URL}"     # string shorthand -> { default: { url: ... } }
mainnet:
  chain_id: 1
  rpc:                              # named RPC profiles
    default: { url: "${env.MAINNET_RPC_URL}" }
    private: { url: "https://...", headers: {...} }
  verification:                     # named verification profiles
    default: { api: "https://...", api_key: "${vault.etherscanKey}" }
sets:                               # reserved key — named chain sets
  evm-prod:
    mainnet: { rpc: private }
    sepolia: {}
```

The `rpc` string shorthand normalizes to a single `default` profile. The field-by-field tables for every level — chain entry, `RpcProfile`, `VerificationProfile`, set entries — live in [Field reference](#field-reference).

### Naming conventions

**`<chainName>`:**

- Lowercase, hyphenated when multi-word (e.g. `optimistic`, `unichain`)
- Stable — chain names appear in many other config files. Renaming a chain here breaks every reference.
- Free-form within those rules — no enforced relation to ChainList or any other registry.
- `sets` and `version` are **reserved** — the chain-set declaration key ([Chain sets](#chain-sets)) and the config format version; neither can be a chain name.

**`<profileName>`** (RPC and verification profiles):

- Same pattern as chain names (`^[a-z][a-z0-9-]*$`).
- **`default` is the reserved fallback name** — it is what a plan gets when it does not select a profile explicitly. Every chain a plan runs on needs a `default` RPC profile (or an explicit `rpc:` selector in the plan); a `default` verification profile is what implicit verification uses.
- Name profiles by what distinguishes them (`private`, `archive`, `etherscan-teamb`, `blockscout`), not by provider trivia.

**`<setName>`** (chain sets):

- Same pattern as chain names (`^[a-z][a-z0-9-]*$`).
- Stable — set names are referenced by plans (`$set`); renaming a set breaks every plan that references it, the same blast radius as renaming a chain or a profile.
- Name sets by the fleet they describe (`evm-prod`, `evm-staging`, `l2-rollouts`), not by any one launch.

## Credentials & secret handling

Connection credentials live here, but — like every credential in deploy-pad — as **pointers**, never literal values. The vault ([global-params.md → Vault](global-params.md#vault)) is the preferred indirection for all of them, exactly as for deployer keys ([secrets.md](secrets.md)):

- **`api_key`** — same rule as `repository.auth` in actions.yaml: the whole value is a single `${vault.X}` token (preferred) or a single `${env.X}` token (allowed). Literals and inline mixing are rejected by the schema. The resolved value is tagged as a secret: injected to verification machinery under the `SEC_` prefix, and displayed as its reference label (`api_key: [vault.etherscanKey]`) in logs and in `config_snapshot.yaml`, `result.yaml`, `deployment.yaml`.
- **`url` and `headers` values** — connection strings, where refs are naturally *inline* (`"https://eth-mainnet.g.alchemy.com/v2/${vault.alchemyKey}"`, `"Bearer ${vault.rpcAuthToken}"`): `${vault.X}` and `${env.X}` may be embedded in a larger string. Redaction is **per fragment**: everywhere the engine writes output, each resolved ref fragment is displayed as its reference — `.../v2/[vault.alchemyKey]`, `Bearer [env.MY_TOKEN]` — while the rest of the string stays readable, and the display follows the value wherever it flows, including `${system.RPC_URL}` / `SYS_RPC_URL`. Commands and the network receive the real resolved string. **Route URL- and header-embedded credentials through the vault** (`${vault.X}` is the recommended form) — see [design-decisions.md → Vault redaction](design-decisions.md#vault-redaction-show-the-reference-never-the-secret).

Resolution timing: `${vault.X}` and `${env.VAR}` references in `url`, `api_key`, and header values are resolved at plan load, after the plan's chain references are resolved against this file (see [plans.md → Load & resolution order](plans.md#load--resolution-order)). The wallet CLI resolves them best-effort; the run/validate paths resolve strictly. The editor's Settings → Chains UI writes references **literally** — plaintext secrets never land in `known-chains.yaml`.

## How plans reference chains

A plan's `chains` block is a set of **name references with optional profile selectors** — no ids, no URLs, no keys:

```yaml
# in a plan
chains:
  mainnet:
    rpc: private                     # RPC profile; omitted -> "default"
    verifiers: [default, blockscout] # verification profile(s); name | list | false
  zksync:
    verifiers: false                 # explicitly disable verification on this chain
  sepolia: {}                        # name-only reference: default profiles
```

Selector semantics (field reference in [plans.md → ChainConfig fields](plans.md#chainconfig-fields)):

- **`rpc`** — names one RPC profile of the chain's `rpc` map. Omitted, the `default` profile is used; a chain with no `default` profile then fails validation.
- **`verifiers`** — names one or several verification profiles, or `false`. Omitted, the `default` profile is used if the chain declares one; a chain with no verification profiles simply has verification off (a validation warning if the workflow contains `verify: true` steps). `false` is the explicit, warning-free disable. When several profiles are selected, the engine verifies against **each** of them (see [engine-internals.md → Verification](engine-internals.md#verification)).

There is **no override form**: a plan cannot supply its own `chain_id`, URL, endpoint, or key. At load time the engine performs a pure **lookup + selection** — plan chain name → known-chains entry → selected profiles — with no merging.

Instead of listing chains one by one, a plan can reference a **[chain set](#chain-sets)** via the `$set` key — see [plans.md → Chain sets](plans.md#chain-sets-set) for the plan-side grammar and merge rule.

## Chain sets

The reserved top-level `sets:` key declares **named chain sets** — reusable chain groups a plan references wholesale via `$set` in its `chains` block. Each set member is a chain name with the same optional selectors a plan chain entry carries (`rpc:` / `verifiers:`); a set is literally a **named, pre-authored plan `chains:` block**:

```yaml
sets:
  evm-prod:
    mainnet:
      rpc: private                     # fleet policy: prod uses the private RPC
      verifiers: [default, blockscout]
    base: {}                           # name-only member: default profiles
    matic: {}
  evm-staging:
    sepolia: {}
    base: {}
```

Why sets live here, and why they carry selectors:

- **One edit instead of one per plan.** Adding a chain to the fleet means adding the chain entry and putting its name in the right sets — every plan referencing those sets picks it up on its next *fresh* deployment (never mid-deployment; see [plans.md → Chain sets](plans.md#chain-sets-set) for the resume freeze).
- **Selector choices are usually fleet policy, not plan policy.** "Production runs use the private RPC and verify on both explorers" belongs with whoever maintains this registry. Two sets differing only in selectors (`evm-prod` vs `evm-staging`) express environment policy directly.
- **Self-contained validation.** A set's members and selectors reference chain entries in this same file, so set integrity is checked entirely at **registry load**, before any plan is opened: every member chain must be declared here with a selectable RPC profile, and every selector must name a profile the member chain declares. A broken set fails once, here — not separately in every plan that uses it.

Rules:

- **`sets` is a reserved key** — the schema excludes it from the chain-name space; a chain cannot be named `sets`.
- **A set member is always a chain name** declared in this file — sets cannot nest, and a set cannot reference another set.
- **Sets carry no connection values** — like plan chain entries, members are name references plus profile selectors only.
- **Plans can override and extend** — a plan naming a chain alongside `$set` merges over the set's entry for that chain (plan wins), and may add chains beyond the set. The plan-side grammar, merge rule, and resume semantics are specified in [plans.md → Chain sets](plans.md#chain-sets-set).

## Relationships to other configs

| Other config | How it references this file |
|---|---|
| [plans.md](plans.md) | Keys of `chains.<chainName>` must be names declared here (hard error otherwise), and a plan's `$set` reference must name a set declared under `sets:`. The plan's per-chain `rpc:` selector names an RPC profile; `verifiers:` names verification profile(s). Plans carry **no** connection values of their own. |
| [global-params.md](global-params.md) | Keys of `chains.<chainName>` must be names declared here. The `vault:` block is where `${vault.X}` refs in `api_key` / header values resolve. |
| [secrets.md](secrets.md) | The credential model for `api_key` and RPC header values (vault preference, tagging, redaction) — see [Connection credentials](secrets.md#connection-credentials-known-chains). |
| [references.md](references.md) — `${system.CHAIN_NAME}`, `${system.RPC_URL}` | `CHAIN_NAME` resolves to the chain name from the surrounding plan block (must exist here); `RPC_URL` resolves to the **selected RPC profile's** resolved URL. |
| [engine-internals.md](engine-internals.md) | How the selected verification profiles drive the verification gates and what the engine passes to commands (`SYS_VERIFY`, per-profile type/API/key). |

## Validation rules & common errors

Enforced at load time, grouped by where they apply.

### Chain identity and shape

- **Unique chain names** — keys are unique by virtue of being a YAML mapping.
- **Integer chain IDs** — non-integer `chain_id` (or quoted strings that look like numbers) fail schema validation.
- **Naming pattern** — chain, profile, and set names not matching `^[a-z][a-z0-9-]*$` fail schema validation. `sets` and `version` are reserved and cannot be chain names (schema-enforced).
- **`version`** — a value differing from the engine's supported format version is a load-time error unless `--ignore-version` is passed; missing is always a warning. Same rules as every config file ([engine-internals.md → Config version check](engine-internals.md#config-version-check)).
- **`url` required** per RPC profile; **`api` required** per verification profile.

### Chain sets

Checked at registry load, before any plan is opened:

- **Every set member must be a chain declared in this file** — error otherwise. A member is a chain name, never another set — a member key naming a set fails this same check (sets cannot nest).
- **Every member needs a selectable RPC profile** — the member's `rpc:` selector must name a declared profile; a member without a selector must have a `default` RPC profile — error otherwise.
- **Every `verifiers:` selector must name declared verification profiles** — error otherwise. A member without verification profiles and without a selector simply has verification off, exactly as for a direct plan reference.
- **A set must not be empty** — schema-enforced (`minProperties: 1`).

### Credentials

- **`api_key` form** — must be exactly one `${vault.X}` or `${env.X}` token; literals and inline mixing fail schema validation.
- **`${vault.X}` refs must resolve** against the `vault:` block in global-params.yaml — error at plan load on miss.

### Plan-side selection

- **Chain referenced by a plan must exist here** — hard error (there is no plan-local fallback data anymore).
- **Selected RPC profile must exist** — a plan `rpc:` selector naming an unknown profile is an error; an omitted selector on a chain without a `default` RPC profile is an error.
- **Selected verification profiles must exist** — a `verifiers:` entry naming an unknown profile is an error. An omitted selector on a chain without a `default` verification profile is not an error — verification is simply off (with a validation warning when the workflow contains `verify: true` steps; use `verifiers: false` in the plan to silence it deliberately).

### Common authoring mistakes

- Putting a literal API key or bearer token in this file. Credentials are pointers here — `${vault.X}` (preferred) or `${env.X}` — never values.
- Expecting a plan to override an RPC URL or verification endpoint. There is no override surface; add a profile here and select it, or use CLI / deployment overrides for a one-off.
- Renaming a profile that plans already select — same blast radius as renaming a chain. Profile names are references.
- Renaming a set that plans reference via `$set` — same blast radius again. Set names are references.
- Forgetting a `default` RPC profile on a chain that plans reference without an explicit `rpc:` selector.
- Adding a chain to a set and expecting an *unfinished* deployment to pick it up on resume. Resume runs against the chain list frozen in `deployment.yaml`; the grown set applies to the next fresh deployment (see [plans.md → Chain sets](plans.md#chain-sets-set)).

## Field reference

The field-by-field tables for every level of a chain entry. The conceptual narrative lives in the body sections above — [Structure & fields](#structure--fields), [Credentials & secret handling](#credentials--secret-handling), and [How plans reference chains](#how-plans-reference-chains).

At the top level, `version` (integer; warns if missing) is the config format version — same rules as every config file ([engine-internals.md → Config version check](engine-internals.md#config-version-check)); `sets` declares [chain sets](#chain-sets); every other key is a chain name mapping to a chain entry.

### Chain entry fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `chain_id` | integer | yes | — | Numeric EVM chain id (e.g. `1` for mainnet). Must be a positive integer. |
| `rpc` | string \| map<profileName, RpcProfile> | no | — | Named RPC profiles. The string shorthand `rpc: "${env.X}"` normalizes to `{ default: { url: "${env.X}" } }`. Required (with a profile the plan can select) for any chain a plan runs on. |
| `verification` | map<profileName, VerificationProfile> | no | — | Named verification profiles. A chain without any cannot verify contracts. |

### Chain set fields

The reserved `sets:` key maps set names to sets; each set maps member chain names to selector entries (the same `ChainConfig` shape as a plan chain entry — see [plans.md → ChainConfig fields](plans.md#chainconfig-fields)):

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `sets.<setName>` | map<chainName, ChainConfig> | no | — | A named chain set. At least one member. Members must be chains declared in this file; sets cannot nest. |
| `sets.<setName>.<chainName>.rpc` | string | no | `"default"` | RPC profile selector for this member — same semantics as the plan-side selector. |
| `sets.<setName>.<chainName>.verifiers` | string \| list<string> \| `false` | no | `"default"` | Verification profile selector(s) for this member — same semantics as the plan-side selector. |

### `RpcProfile` fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `url` | string | yes | — | RPC endpoint URL. May embed `${vault.X}` / `${env.VAR}` refs inline — vault is the recommended form for URL-embedded credentials (e.g. `.../v2/${vault.alchemyKey}`); resolved ref fragments display as their reference labels in all engine output — see [Credentials & secret handling](#credentials--secret-handling). |
| `headers` | map<string, string> | no | — | Custom HTTP headers sent on every RPC request through this profile (e.g. `Authorization: "Bearer ${vault.rpcAuthToken}"`). Values may embed `${vault.X}` / `${env.X}` inline; resolved ref fragments display as their reference labels in all engine output — see [Credentials & secret handling](#credentials--secret-handling). |

### `VerificationProfile` fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `type` | string | no | `etherscan` | API dialect: `etherscan`, `blockscout`, or `sourcify`. Tells the verification machinery (bundled scripts, forge's `--verifier` flag, …) which protocol to speak. |
| `api` | string | yes | — | Verification API base URL (e.g. `https://api.etherscan.io/v2/api`). |
| `api_key` | string | no | — | API key for this profile. A **single** `${vault.X}` token (preferred) or `${env.X}` token (allowed) — literals are rejected. Omit for keyless APIs (Sourcify, open Blockscout instances). Tagged as a secret and redacted. |

The machine-readable schema is [schemas/known-chains.schema.yaml](schemas/known-chains.schema.yaml).

## Full example

A registry demonstrating every entry form — the string RPC shorthand, the full form with several RPC and verification profiles, keyless verification, and named chain sets — see [examples/known-chains.yml](examples/known-chains.yml). The `${vault.X}` entries there are looked up against the `vault:` block in [global-params.yaml](global-params.md#vault).

What you'll observe when plans reference these entries:

- `sepolia` uses the **string shorthand**: it normalizes to a single `default` RPC profile, so a name-only plan reference (`sepolia: {}`) works. It declares no verification profiles — verification is simply off there (a warning if the workflow has `verify: true` steps).
- `mainnet` is the **full form**. A plan gets the public endpoint by default; `rpc: private` selects the authenticated endpoint, whose `Authorization` header embeds `${vault.rpcAuthToken}` inline — displayed as `Bearer [vault.rpcAuthToken]` in all engine output; `rpc: alchemy` selects the profile whose key rides in the URL path via `${vault.alchemyKey}` — displayed as `.../v2/[vault.alchemyKey]`, including wherever `${system.RPC_URL}` / `SYS_RPC_URL` surfaces. Three verification profiles coexist: the same Etherscan API under two accounts (`default`, `etherscan-teamb` — differing only in `api_key`) plus a `blockscout` profile with a different dialect (`type: blockscout`). A plan can verify against several at once (`verifiers: [default, blockscout]`).
- `matic` shows **keyless verification**: its `default` profile is Sourcify (`type: sourcify`) with no `api_key` — nothing to redact, nothing in the vault.
- The `sets:` block declares two **chain sets**. `evm-prod` carries fleet policy in its selectors — its `mainnet` member selects the private RPC and dual verification, so every plan referencing `$set: evm-prod` gets that policy without restating it. `evm-staging` differs only in membership and selectors — environment policy expressed as two set names. Both validate at registry load: every member is a chain declared above with a selectable RPC profile.
- No literal credential appears anywhere — every `api_key`, URL-embedded key, and header token is a `${vault.X}` pointer resolved at plan load against [global-params.yaml](global-params.md#vault); non-secret operator-specific URLs read `${env.VAR}`.

## Open questions

(Cross-cutting decisions and their open questions are tracked in [design-decisions.md](design-decisions.md).)

- **RPC failover.** A profile currently holds one `url`. An ordered `urls:` list (try in order on connection failure) would slot in without structural change; deferred until a real need shows up — named profiles already cover the "several providers" case.
- **Add chain metadata.** Further candidates beyond connection data: explorer *browse* URL pattern (for human-facing links in reports), native currency symbol, EIP-1559 support, multicall address. Would let the engine and editor stop hardcoding per-chain quirks. Risks scope creep.
