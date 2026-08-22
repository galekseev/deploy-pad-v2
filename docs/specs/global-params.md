# Global parameters

Two kinds of well-known data shared across workflows:

- **Constants** — chain-aware reusable values (e.g. `WETH`, `PERMIT2`) referenced via `${global.NAME}`.
- **Vault** — a registry mapping stable secret names to environment-variable references (e.g. `create3Deployer: "${env.PK_CREATE3}"`). Referenced via `${vault.NAME}` from plan `secrets:` values, from the connection-credential fields in known-chains.yaml (verification `api_key`, RPC `headers`), and from `repository.auth` in actions.yaml. The vault is **pointers only — it never holds literal credentials.**

## Purpose

### Constants

Without this file, every plan that needs WETH on every chain has to redeclare the same address per chain. Two problems with that:

- Drift — different workflows diverge over time as people copy-paste.
- Knowledge concentration — onboarding requires "where do I find WETH on linea again?" lookups for every config author.

The `defaults.constants` + `chains.<name>.constants` blocks solve both by being the single registry of "well-known" addresses and constants. Plans reference these by name (`${global.WETH}`), and the engine resolves them per-chain at load time, falling back to defaults when a chain doesn't override.

This part of the file is **chain-aware**: a value can be defined once for all chains (in `defaults.constants`) and overridden per chain (in `chains.<name>.constants`). The chain context comes from the surrounding plan that referenced the global.

### Vault

Without a vault, every plan that needs a deployer key has to write `${env.PK_DEPLOYER}` directly in its `secrets:` block. That makes rotating keys, sharing setups across teams, and auditing "which env var feeds which deployer role" all harder than they need to be.

The `vault:` block is the single registry of named secret pointers. Plans reference these by name (`secrets.privateKey: "${vault.create3Deployer}"`), and the engine resolves the pointer to the env-var ref at load time, then to the actual env value at execute time.

The vault is **not chain-aware**: one entry maps to one env var globally. Per-chain wiring happens in plan `secrets:` blocks (different chains can map their `privateKey` to different vault entries). See [Vault](#vault) below.

## Structure & fields

### Top-level shape

The reserved `version` key (the config format version — same rules as every config file, see [engine-internals.md → Config version check](engine-internals.md#config-version-check)), then three sections, all optional — two for the constants registry (`defaults` + `chains`), one for the vault:

```yaml
version: 2
defaults:
  constants:                 # chain-agnostic baseline
    WETH: "0xC02a..."
chains:
  zksync:
    constants:               # per-chain overrides — win over defaults
      WETH: "0x5AEa..."
vault:                       # flat name -> ${env.VAR} pointer registry
  create3Deployer: "${env.PK_CREATE3}"
```

The field-by-field table lives in [Field reference](#field-reference).

A global constant value is **a plain string**. The substitution system does not recurse: a global constant value cannot itself contain `${global.X}`, `${env.X}`, etc. — those are only resolved on the consuming side, in plan constants.

### Naming conventions

For global parameter names (in `constants`):

- `SCREAMING_SNAKE_CASE` — schema-enforced (`^[A-Z][A-Z0-9_]*$`), unlike plan constants where it is only the recommended style
- Generic, workflow-agnostic — `WETH`, not `WETH_ADDRESS_FOR_AGGREGATION_ROUTER`
- Stable — every plan references these by name; renames are wide-blast-radius

## Vault

`vault:` is a flat map of author-chosen secret names to environment-variable references. Each entry is a **pointer**, not a credential.

```yaml
vault:
  privateKey: "${env.PK_REGULAR_DEPLOYER}"
  create3Deployer: "${env.PK_CREATE3}"
  sameNonceDeployer: "${env.PK_SAMENONCE}"
  etherscanKey: "${env.ETHERSCAN_KEY}"
```

### Rules

- **Keys** are author-chosen identifiers matching `^[a-z][a-zA-Z0-9]*$` (camelCase). They name a secret role (`create3Deployer`, `sameNonceDeployer`) — not the env var, not the chain.
- **Values must be exactly `${env.VAR}` env refs** — nothing else is accepted. Literal credentials, inline strings, and other namespaces (`${global.X}`, `${secret.X}`, …) are rejected by the schema. The whole point of the vault is that committed YAML never contains a credential.
- **Not chain-aware.** A vault entry maps one name → one env var globally. Per-chain wiring (different physical keys per chain) is expressed by mapping `chains.<c>.secrets.privateKey` to different vault entries in the plan.

### Why this layer exists

- **Single rotation point.** Rotating a deployer key means editing one env var (in CI/secret manager) and, if the role itself changes, one line in `vault:`. No plan edits.
- **Audit surface.** "Which env var feeds the create3 deployer?" is one grep against `vault:`. Without it the answer is scattered across every plan.
- **Reuse across workflows.** Multiple plans reference the same vault names; rotating once propagates everywhere.
- **Engine secret tagging.** Values resolved through `${vault.X}` are *tagged as secrets* by the engine — passed to subprocesses via process env only (under the `SEC_` prefix, never written to `.env.automation` or any other file), and displayed in logs as their reference label (`[vault.create3Deployer]`) rather than the value. See [engine-internals.md → Vault resolution and secret tagging](engine-internals.md#vault-resolution-and-secret-tagging). Values written as `${env.X}` directly in plan secrets are tagged and redacted the same way (as `********` / `[redacted: <slot>]`) — the vault is preferred for its rotation/audit indirection, not for the tagging.

### Consumption

A vault entry is referenced via `${vault.<name>}` from four sites:

- **Plan `secrets:` values** — deployer private keys (and author-named key slots), per chain.
- **Known-chains connection credentials** — verification profiles' `api_key` (single token) and RPC profiles' `url` / `headers` values (inline allowed; resolved ref fragments display as labels). See [secrets.md → Connection credentials](secrets.md#connection-credentials-known-chains).
- **`repository.auth` in actions.yaml** — git access tokens for private repos (see [actions.md → Private repos and authentication](actions.md#private-repos-and-authentication)).
- **Multisig registry credentials** — the `proposer` / `executor` keys of `multisig.yaml` entries (single token; see [multisig.md → Credentials](multisig.md#credentials)). Neither is a Safe owner key.

```yaml
# in a plan (inside a preset)
chains:
  mainnet:
    secrets:
      privateKey: "${vault.privateKey}"
      create3Deployer: "${vault.create3Deployer}"

# in known-chains.yaml
mainnet:
  chain_id: 1
  rpc:
    private:
      url: "https://web3.1inch.io/1/"
      headers:
        Authorization: "Bearer ${vault.rpcAuthToken}"
  verification:
    default:
      api: "https://api.etherscan.io/v2/api"
      api_key: "${vault.etherscanKey}"

# in actions.yaml
my-private-repo:
  repository:
    uri: "https://github.com/my-org/private-contracts.git"
    auth: "${vault.gitHubToken}"
```

Git read tokens and connection credentials are ordinary vault entries — same rotation point, same audit surface, same secret tagging as deployer keys.

The engine resolves `${vault.X}` to the vault entry's `${env.VAR}` value, then resolves the env var at execute time. See [references.md → `${vault.NAME}`](references.md#vaultname--vault-registry) for the full substitution semantics and [secrets.md → Multi-PK via named secrets](secrets.md#multi-pk-via-named-secrets) for the per-step rename pattern.

## Secrets management

This file owns the **vault** — the store of secret pointers (above). The end-to-end secret-management story — how vault entries feed plan `secrets:` slots, the per-step rename mechanism, repo access tokens, secret tagging, and the security rules — lives in [secrets.md](secrets.md).

## Relationships to other configs

| Other config | Relationship |
|---|---|
| [actions.md](actions.md) | Actions never carry secret values — they consume vault-backed secrets indirectly through the plan's `secrets:` block. The one direct vault consumer in actions.yaml is `repository.auth` (git tokens for private repos) — still a pointer, never a credential. See [secrets.md](secrets.md). |
| [known-chains.md](known-chains.md) | Keys of `chains.<name>` should be names declared in known-chains. Names not in known-chains are still resolved (no hard error today) but flagged by validation. In the other direction, known-chains' connection credentials (verification `api_key`, RPC `headers`) reference this file's `vault:` block via `${vault.X}`. |
| [plans.md](plans.md) | Consumes globals via `${global.NAME}` in constants blocks and vault entries via `${vault.NAME}` in `secrets:` values. Both are resolved per-chain at plan load — see [load order](plans.md#load--resolution-order). |
| [multisig.md](multisig.md) | The multisig registry's `proposer` / `executor` credentials are `${vault.X}` refs resolved against this file's `vault:` block — an ordinary vault consumer, same tagging and redaction. |
| [references.md](references.md) | Authoritative description of `${global.NAME}` and `${vault.NAME}` syntax, exact-vs-inline form, miss behavior, and resolution order. This file describes only the **store** (the registry); references.md describes the **read** (how consumers resolve names against it). |
| [engine-internals.md](engine-internals.md) | Documents how secret values are tagged and treated by the engine (env-only injection under `SEC_`, log redaction). See [Vault resolution and secret tagging](engine-internals.md#vault-resolution-and-secret-tagging). |

## Validation rules & common errors

### Schema-level (load time)

- Keys under `chains` must match the chain-name pattern (`^[a-z][a-z0-9-]*$`).
- Constant keys (in `defaults.constants` and `chains.<c>.constants`) must match `^[A-Z][A-Z0-9_]*$` (SCREAMING_SNAKE_CASE).
- All constant values must be strings (no integers, booleans, or nulls).
- Unknown top-level keys are rejected (`additionalProperties: false`).
- Vault keys must match `^[a-z][a-zA-Z0-9]*$` (camelCase identifier).
- Vault values must match `^\$\{env\.[A-Za-z_][A-Za-z0-9_]*\}$` exactly — only `${env.VAR}` env refs are accepted. Literal credentials, inline strings, and other namespaces are rejected at the schema level.

### Cross-config

- Global parameter names referenced by the selected preset but not resolvable for an active chain (no per-chain override, no default) — **hard error** at plan load by default; with plan `strict: false`, a load-time warning instead, erroring only if a step consumes the value (see [references.md → Overview](references.md#overview)).
- A chain referenced under `chains.<name>` but missing from [known-chains](known-chains.md) — warning (the entry is dead data until some plan activates that chain).
- Vault entries referenced by a plan but not defined here — **hard error** at plan load (`${vault.X}` lookups hard-fail on miss; see [references.md → `${vault.NAME}`](references.md#vaultname--vault-registry)).

### Common authoring mistakes

- Putting `${env.VAR}` or `${global.X}` inside a global value. Globals are leaves; substitution does not recurse here.
- Defining a value only as a per-chain override with no `defaults.constants` entry, then expecting other chains to "inherit." Chains without an override and no default get nothing back — the `${global.X}` lookup **hard-fails the plan load** on those chains (warning-then-error-on-consumption under plan `strict: false`). Reference chain-asymmetric globals only from the per-chain `constants` blocks of chains that define them (a `defaults.constants` ref is merged into, and must resolve on, every active chain).
- Quoting an integer-looking address (e.g. `0x1234`) without quotes — most addresses contain non-numeric characters and parse as strings, but quote-by-default to be safe.
- Putting a literal credential in `vault:` — rejected by the schema. The whole point of the vault is that it never holds a value, only a pointer.
- Trying to make `vault:` chain-aware (e.g. `vault.mainnet.privateKey`). The vault is intentionally flat. Per-chain wiring lives in plan `chains.<c>.secrets:`, not here.

## Field reference

The field-by-field table. The conceptual narrative lives in the body sections above — [Structure & fields](#structure--fields) and [Vault](#vault).

### Top-level fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `version` | integer | no (warns if missing) | — | Config format version this file is written against (current: `2`). Same rules as every config file — see [engine-internals.md → Config version check](engine-internals.md#config-version-check). |
| `defaults` | object | no | `{}` | Chain-agnostic baseline values for the constants registry. |
| `defaults.constants` | map<string, string> | no | `{}` | Key is the global parameter name (e.g. `WETH`); value is the resolved constant. Plain strings only — no further substitution at this layer. |
| `chains` | map<string, ChainSection> | no | `{}` | Per-chain overrides for the constants registry. Keys must be valid chain names (see [known-chains.md](known-chains.md)). |
| `chains.<chainName>.constants` | map<string, string> | no | `{}` | Same shape as `defaults.constants`. Values here win over `defaults` for that chain. |
| `vault` | map<string, string> | no | `{}` | Registry mapping author-chosen secret names to `${env.VAR}` references. Not chain-aware. See [Vault](#vault). |

The machine-readable schema is [packages/schemas/src/global-params.schema.yaml](../../packages/schemas/src/global-params.schema.yaml).

## Full example

A registry demonstrating both stores — a chain-agnostic constant baseline with per-chain overrides, and a vault of named secret pointers — see [examples/global-params.yml](examples/global-params.yml). The `${env.VAR}` values there are resolved against `process.env` at execute time.

What you'll observe when plans consume these entries:

- When a plan running on `zksync` references `${global.WETH}`, it resolves to `0x5AEa…` (the per-chain override). On `mainnet` it resolves to `0xC02a…`. On `linea` (which isn't listed in `chains`), `${global.WETH}` has no value to resolve to (no default for `WETH`) — the plan load **hard-fails** with an error naming the token, the key, and the chain (under plan `strict: false`: a warning, and an error only if a step consumes the value).
- `PERMIT2` on `zksync` resolves to the override; everywhere else it falls back to the default. `DEFAULT_OWNER` has no per-chain override, so all chains see the default.
- When a plan sets `chains.mainnet.secrets.privateKey: "${vault.create3Deployer}"`, the engine resolves the vault entry to `${env.PK_CREATE3}`, then to the env var's value at execute time. The resolved value is tagged as a secret — injected to the command under `SEC_PRIVATE_KEY`, never written to disk, displayed in logs as `[vault.create3Deployer]`.
- The remaining entries are consumed from the other direction: verification profiles in [known-chains.md](known-chains.md) point their `api_key` at `${vault.etherscanKey}` / `${vault.etherscanKeyTeamB}` / `${vault.blockscoutKey}` and the private RPC profile's header embeds `${vault.rpcAuthToken}`; `gitHubToken` feeds `repository.auth` in actions.yaml; `opsProposer` / `opsExecutor` / `merkleExecutor` feed the [multisig registry](multisig.md). Connection, git, and multisig credentials are ordinary vault entries.
