# Secrets

The end-to-end guide to secret management in deploy-pad: private keys, verification API keys, RPC auth tokens, and git access tokens — where they live, how they flow, and how the engine keeps them out of logs and files. This is the conceptual home for the topic; the file-specific schema details stay in each config's own doc, and the canonical `${...}` substitution rules live in [references.md](references.md).

> **Scope.** A *secret* is any credential: a deployer private key, an Etherscan-style verification API key, an RPC bearer token, or a git token for a private repo. None of these ever appear as literal values in committed YAML — configs carry only **pointers**, and the real value exists only in the environment at execute time.

## Why a vault layer at all?
Today the vault only resolves secrets from environment variables (`${env.VAR}`). The vault still exists as a **designated indirection layer** rather than referencing env vars directly, because it is the planned home for additional secret sources — e.g. encrypted secret storage, cloud secret managers, and similar backends. Routing every credential through the vault now means those future sources can be added behind the same `${vault.X}` references without touching any plan, workflow, or action.

## Big picture

Credentials flow through up to four layers before the engine hands them to a deployment command. Each layer has exactly one job, and no layer ever holds a literal credential except the environment itself.

```
process.env                  PK_CREATE3=0xabc...
      │
      ▼
[1] Vault (global-params.yaml)   create3Deployer: "${env.PK_CREATE3}"
      │
      ▼
[2] Plan (secrets:)             privateKey1: "${vault.create3Deployer}"
      │
      ▼
[3] Workflow step (mappings)    privateKey: privateKey1
      │
      ▼
[4] Engine                      ${secret.privateKey}  →  SEC_PRIVATE_KEY
```

- **Vault** names a stable *role* and points it at an env var.
- **Plan `secrets:`** declares named *slots* and which vault entry feeds each.
- **Workflow `mappings`** optionally *renames* `privateKey` per step to a different slot.
- **Engine** injects the resolved value under a fixed name (`${secret.privateKey}`) at run time.

Authors write `${vault.X}`; the engine runs with `${secret.X}`. You never write `${secret.X}` yourself.

**Connection credentials take a shorter path.** Verification API keys and RPC auth tokens are not launch parameters — they belong to the chain's connection settings, so they live in [known-chains.yaml](known-chains.md) (as `api_key` on a verification profile, or inside an RPC profile's `headers`), pointing at the same vault. The plan never carries their values; it only *selects* profiles via the chain reference's `rpc:` / `verifiers:` selectors. See [Connection credentials](#connection-credentials-known-chains).

> **Env-var prefix.** The engine injects a command's environment under three role-based prefixes: **`SEC_`** for secrets (`SEC_PRIVATE_KEY`, `SEC_VERIFICATION_API_KEY`), **`SYS_`** for engine system context (`SYS_CHAIN_ID`, `SYS_VERIFY`, `SYS_ARTIFACTS_DIR`, …), and **`OPS_`** for author-declared params and the remaining engine-managed deploy params. The dedicated `SEC_` prefix marks a value as sensitive — both for the engine's own redaction and as a signal to script authors that the value must not be logged or persisted.

## The authoring layers

| Layer | Owns | Allowed values |
|---|---|---|
| **Vault** ([global-params.yaml](global-params.md#vault)) | The pointer from a stable role name to an env var | `${env.VAR}` only (schema-enforced) |
| **Plan** ([plans.md → Secrets](plans.md#secrets), `secrets:` blocks inside each preset) | The set of named secret slots and which vault entry feeds each one | `${vault.X}` (preferred), `${env.X}` (allowed), or literal (discouraged) — all tagged & redacted |
| **Known chains** ([known-chains.md](known-chains.md), verification `api_key` + RPC `url` / `headers`) | Connection credentials — per-profile verification keys, URL-embedded keys, RPC auth headers | `api_key`: single `${vault.X}` or `${env.X}` token (no literals). `url` / header values: inline `${vault.X}` / `${env.X}` allowed — resolved ref fragments display as `[vault.<name>]` / `[env.<VAR>]` |
| **Multisig registry** ([multisig.md](multisig.md), entry `proposer` / `executor`) | Multisig-mode credentials — the Transaction Service delegate key and the gas-paying executor key (never Safe owner keys) | Single `${vault.X}` (preferred) or `${env.X}` token (no literals, no inline) — tagged & redacted |
| **Workflow** ([workflows.md → Mappings](workflows.md#mappings--the-wiring-layer), per-step `mappings`) | Per-step rename — which secret slot this step reads (a [method variant](workflows.md#method-variants--variantof) can override it per step via `keys`) | Bare name only — must match a `secrets:` key |

This split is what makes per-step credentials reusable: the same workflow runs unchanged against many plans, each of which can wire a different physical key per step name.

### What each layer prohibits

- **Vault values** must be `${env.VAR}` and nothing else. Literals, inline strings, and other namespaces are rejected by schema.
- **Plan secret values** can be `${vault.X}` (preferred), `${env.X}` (allowed), or a literal (discouraged) — all three are tagged and redacted by the engine; the preference is about indirection, not protection. Inline mixing (`"prefix-${vault.X}-suffix"`) is not allowed for vault refs.
- **Known-chains `api_key` values** must be a single `${vault.X}` (preferred) or `${env.X}` (allowed) token — literals are rejected by schema. **RPC `url` and header values** are the one place inline vault/env refs are allowed (`".../v2/${vault.alchemyKey}"`, `"Bearer ${vault.rpcAuthToken}"`); resolved ref fragments display as their labels — see [Connection credentials](#connection-credentials-known-chains).
- **Workflow mapping values** for a secret-targeted input are **bare names** (matching a `secrets:` key) — not `${secret.X}` syntax, not `${vault.X}` syntax, not `${env.X}` syntax, not literal credentials. To swap the physical key for a step, edit `secrets.<name>` in the plan; the workflow stays the same.

## Namespace mechanics

The two namespaces involved in secrets are `${vault.NAME}` (author-facing pointer) and `${secret.NAME}` (engine-facing read). The authoritative specification for all `${...}` namespaces — including the scoping matrix and resolution order — is [references.md](references.md); the relevant parts are restated here for convenience.

### `${vault.NAME}` — the vault registry

Resolves a stable secret name to its environment-variable reference, sourced from the `vault:` block of [global-params.yaml](global-params.md#vault). Valid **only** as the value of a plan `secrets:` entry, of `repository.auth` in actions.yaml, of a connection field in known-chains.yaml (verification `api_key` as a single token; inline in RPC `url` / `headers` values), or of a multisig registry credential (`proposer` / `executor` in multisig.yaml — see [multisig.md → Credentials](multisig.md#credentials)).

**Syntax:**

```yaml
# in a plan (inside a preset)
chains:
  mainnet:
    secrets:
      privateKey: "${vault.privateKey}"
      create3Deployer: "${vault.create3Deployer}"

# in known-chains.yaml — connection credentials
mainnet:
  chain_id: 1
  rpc:
    alchemy:
      url: "https://eth-mainnet.g.alchemy.com/v2/${vault.alchemyKey}"   # inline allowed in connection strings
    private:
      url: "https://web3.1inch.io/1/"
      headers:
        Authorization: "Bearer ${vault.rpcAuthToken}"   # inline allowed in connection strings
  verification:
    default:
      api: "https://api.etherscan.io/v2/api"
      api_key: "${vault.etherscanKey}"                  # single token only

# in actions.yaml — git token for a private repo
my-private-repo:
  repository:
    uri: "https://github.com/my-org/private-contracts.git"
    auth: "${vault.gitHubToken}"
```

**Resolution:**

1. The engine reads the named entry from `global-params.yaml`'s `vault:` block (e.g. `vault.create3Deployer` → `"${env.PK_CREATE3}"`).
2. The resulting `${env.VAR}` ref is then resolved against `process.env`.
3. The fully resolved value is **tagged as a secret** in the engine's param model — see [Secret tagging & redaction](#secret-tagging--redaction) below.

**Behavior on miss:** hard error at config load — `vault entry "<name>" not found in global-params.yaml`. **Always strict** — the plan's `strict: false` flag does not relax vault lookups (see [references.md → Overview](references.md#overview)).

**Inline form:** allowed only in known-chains **connection strings** — RPC `url` and `headers` values, which are naturally inline mixes (`".../v2/${vault.alchemyKey}"`, `"Bearer ${vault.rpcAuthToken}"`). There, redaction is per fragment: every resolved ref fragment is displayed as its reference label (`[vault.<name>]` / `[env.<VAR>]`) in all engine output, while the rest of the string stays readable. Everywhere else — a secret entry, `repository.auth`, a known-chains `api_key` — the whole value must be a single `${vault.X}` token (or a single `${env.X}` token; secret entries also accept a literal, the other two do not): those values *are* the credential. See [Connection credentials](#connection-credentials-known-chains).

**Author-defined names** are arbitrary camelCase identifiers (e.g. `privateKey`, `create3Deployer`, `sameNonceDeployer`, `etherscanKey`). The set of valid names is whatever `vault:` declares. The plan does not invent names — it picks them from the vault.

### `${secret.NAME}` — the credentials registry

Resolves credentials sourced from the plan `secrets:` block (with one engine-sourced exception: `${secret.verificationApiKey}` comes from the selected verification profile in known-chains — see [Built-in names](#built-in-names)). Engine-managed: authors do **not** place `${secret.X}` as a value in their YAML — they place actual secret values (typically as `${vault.X}` refs; `${env.VAR}` and literals are also accepted) under `secrets:` in the plan. The engine then exposes them to deployment commands implicitly. Every value resolved for this namespace is treated as a secret regardless of source — see [Secret tagging & redaction](#secret-tagging--redaction).

**Resolution:**

- **Per-chain with preset-defaults fallback.** The active preset's `chains.<c>.secrets.<name>` wins; if absent, falls back to the preset's `defaults.secrets.<name>`.
- **Resolved before env refs are processed**, so `${env.VAR}` inside a secret value resolves last and ends up as the literal credential.
- **Behavior on miss:** the engine errors — "secret `<name>` not found for chain `<c>`." For deploying steps this is checked statically at planning ([phase 3 → Required-data checks](../architecture/phase-3-static-planning.md#required-data-checks), waived in multisig mode); other key consumers hit it at step input resolution.

## Value forms & preference

In any `secrets:` value (and in `repository.auth` and the known-chains connection-credential fields), use these forms in order of preference. **All three are tagged as secrets and redacted by the engine** (see [Secret tagging & redaction](#secret-tagging--redaction)); the preference is about indirection and operability, not protection.

1. **`${vault.<name>}` (preferred)** — points at an entry in the [vault registry](global-params.md#vault). Preferred for the indirection it buys: one rotation point, an audit surface, reuse across plans, and a place for future secret sources to plug in.
2. **`${env.<VAR>}` (allowed)** — reads `process.env` directly, skipping the vault indirection. Still tagged and redacted; you just lose the vault's rotation/audit benefits. (`repository.auth` and known-chains `api_key` accept this too; neither accepts a literal.)
3. **Literal string (discouraged)** — accepted by the schema for plan `secrets:` entries only. Still tagged and redacted in all engine output, but discouraged because the value sits in plaintext in the **source YAML file itself**, which the engine cannot redact.

`secrets` values must be strings.

### Secret tagging & redaction

Every value resolved for the secret namespace is **tagged as a secret** by the engine — whether it came from a `${vault.X}` ref, a direct `${env.X}` ref, or a literal string. The source does not change the protection. A tagged value gets three guarantees:

- **Excluded from writer output** (`.env.automation`, `config/constants.json`, etc.).
- **Injected to subprocesses via process env only** (under the `SEC_*` prefix — see [Big picture](#big-picture)).
- **Never shown in logs and run records** (`run-N.yaml`, `result.yaml`, `config_snapshot.yaml`, `deployment.yaml`) — a vault-sourced value displays as its reference label, `[vault.<name>]` (fragments of larger strings included); direct-env and literal secrets display as `********` / `[redacted: <slot>]`.

#### Redaction guarantee

The **engine and all native, engine-owned commands** (bundled deployment scripts, the Ignition wrapper, in-process `contract-call`s) never write a secret-namespace value to logs, terminal output, or any report. Anywhere such a value would otherwise appear, it is replaced — vault-sourced values (whole or as fragments of a larger string, e.g. a URL-embedded key) by their reference label `[vault.<name>]`, other tagged values by `********` / `[redacted: <slot>]`. The replacement follows the value wherever it flows, including a vault-carrying RPC URL surfacing through `${system.RPC_URL}` / `SYS_RPC_URL`.

**The one exception is custom scripts.** When an action runs an author-written `command`, the engine hands the real credential to that subprocess in its environment (it has to — the command needs it to sign). Once inside a custom script, the engine can no longer guarantee redaction: a script that prints the value, encodes it (e.g. base64), or writes it to a file of its own will expose it. **Script authors must handle secrets carefully** — never echo them, never persist them, and avoid passing them on argv (which can show up in process listings).

The full runtime mechanics (load-time resolution, why tagging happens at the load layer, source pointers) are in [engine-internals.md → Vault resolution and secret tagging](engine-internals.md#vault-resolution-and-secret-tagging).

## Secret keys in the plan

### Built-in names

These are always-available names the engine consumes for known purposes:

| Name | Consumer | When required |
|---|---|---|
| `${secret.privateKey}` | Every deployment command (deploying action). | Always required for deploying actions. |
| `${secret.verificationApiKey}` | Verification flow on deploying actions with `verify: true`. | **Not a plan slot in v2.** The engine sources it from the **selected verification profile's `api_key`** in [known-chains.md](known-chains.md) (per the chain reference's `verifiers:` selector). When several profiles are selected, the engine runs one verification pass per profile, injecting each profile's key in turn. A keyless profile (e.g. Sourcify) injects nothing. |

### Author-defined slots

Authors may add arbitrary named entries under `secrets:` (matching `^[a-z][a-zA-Z0-9]*$`) for cases like multi-PK setups — different deployers per step (`privateKey1`, `privateKey2`, `create3Deployer`, `sameNonceDeployer`, …). These are not separate secret *types*; they are alternate slots a workflow step can opt into by renaming `privateKey`.

The per-key field reference (types, consumers, tri-state notes) lives in [plans.md → Secrets keys](plans.md#secrets-keys).

## Multi-PK via named secrets

Many workflows need different deployer keys for different steps — e.g. two escrow-factory deployments that must use distinct keys, or a regular deployer plus a same-nonce deployer that must keep its nonce stable. The three-layer chain (vault → plan secrets → workflow rename) handles this without baking any value into the workflow.

**Step 1.** Declare vault entries in `global-params.yaml` (pointers to env vars; never literal credentials):

```yaml
vault:
  privateKey: "${env.PK_REGULAR_DEPLOYER}"
  create3Deployer: "${env.PK_CREATE3}"
  sameNonceDeployer: "${env.PK_SAMENONCE}"
```

**Step 2.** Declare named secret slots in the plan — in a preset's `secrets:` block (each pointing at a vault entry):

```yaml
presets:
  prod:
    chains:
      mainnet:
        secrets:
          privateKey: "${vault.privateKey}"            # default for any deploying step
          privateKey1: "${vault.create3Deployer}"      # slot for the first escrow-factory step
          privateKey2: "${vault.sameNonceDeployer}"    # slot for the second escrow-factory step
```

**Step 3.** In the workflow, rename `privateKey` per step:

```yaml
- action: cross-chain-swap.v1.escrow-factory
  id: escrow-factory-1
  mappings:
    privateKey: privateKey1        # rename: this step reads chains.<c>.secrets.privateKey1

- action: cross-chain-swap.v1.escrow-factory
  id: escrow-factory-2
  mappings:
    privateKey: privateKey2        # rename: this step reads chains.<c>.secrets.privateKey2
```

A step with **no** `privateKey` mapping reads the default `secrets.privateKey`. The rename takes a *name*, not a value — the credential itself is authored only in the plan. This is what lets one workflow be reused unchanged across many plans and presets (dev vs prod, regular-deployer vs same-nonce-deployer) by editing the plan alone.

**Variants can override the rename per step.** A [method variant](workflows.md#method-variants--variantof) that flips a step's deploy method may also need to flip its wallet (plain CREATE derives the address from deployer + nonce; CREATE3 doesn't care who signs). The variant's `keys` map (`keys.<stepId>: <slotName>`, also per chain under `chains.<c>.keys`) overrides the step's effective `privateKey` rename — still a bare slot name resolved against the plan's `secrets:`, never a value. Precedence: variant `chains.<c>.keys.<stepId>` → variant `keys.<stepId>` → the base step's `mappings.privateKey` → the default `privateKey` slot. Note that `keys` is only needed for **per-step divergence**: to re-key a whole variant, just bind the same slot names to different vault entries in the variant's plan.

## Repository authentication (git tokens)

A private repo needs a credential to clone and fetch. Like every credential in v2, it never appears in committed YAML — the repo entry carries only a pointer in the optional `repository.auth` field:

```yaml
my-private-repo:
  repository:
    uri: "https://github.com/my-org/private-contracts.git"
    auth: "${vault.gitHubToken}"    # pointer only — never a literal token
```

Git read tokens are ordinary vault entries — same rotation point, same audit surface, same secret tagging as deployer keys. The value is exactly one `${vault.X}` ref (preferred for the vault indirection) or one `${env.X}` ref (allowed); both are tagged and redacted. Literals and inline mixing are rejected. Omitting `auth` falls back to ambient credentials (SSH agent, git credential helper).

The field definition and authoring rules are in [actions.md → Private repos and authentication](actions.md#private-repos-and-authentication); the ephemeral-injection mechanics (and GitHub Actions setup) are in [engine-internals.md → Repository authentication](engine-internals.md#repository-authentication).

## Connection credentials (known-chains)

Connection credentials — verification API keys and RPC auth tokens — are first-class vault consumers that live in [known-chains.yaml](known-chains.md) rather than the plan `secrets:` block. They belong to the chain's connection settings, not to a launch: known-chains is the single source of truth for them, and a plan can only *select* which profile (and therefore which credential) a run uses — never supply a value of its own.

- **`verification.<profile>.api_key`** — the API key of one verification profile (several profiles per chain support several explorers and several accounts). Value form is the same rule as `repository.auth`: exactly one `${vault.X}` token (preferred) or one `${env.X}` token (allowed); literals are rejected by schema. Tagged as a secret — injected to the verification machinery as `SEC_VERIFICATION_API_KEY` (one pass per selected profile), displayed as its label in logs, `config_snapshot.yaml`, `result.yaml`, and `deployment.yaml`.
- **`rpc.<profile>.url` and `rpc.<profile>.headers`** — connection strings (a URL-embedded key `".../v2/${vault.alchemyKey}"`; a header `Authorization: "Bearer ${vault.rpcAuthToken}"`). They are the documented exception to the single-token vault rule: `${vault.X}` / `${env.X}` may be embedded in a larger string, and redaction is **per fragment** — each resolved ref fragment displays as its reference label (`.../v2/[vault.alchemyKey]`, `Bearer [env.MY_TOKEN]`) everywhere the engine writes output, the rest of the string staying readable. Route connection credentials through the vault; commands and the network receive the real resolved string.

Different accounts for the same explorer are expressed as separate verification profiles pointing at different vault entries (`etherscanKey`, `etherscanKeyTeamB`, …) — rotation and audit stay in the vault, selection stays in the plan.

See [known-chains.md → Credentials & secret handling](known-chains.md#credentials--secret-handling) for the field rules and resolution timing.

## Security rules & common mistakes

- **Always use a reference, never a literal.** Secret values should be `${vault.X}` (preferred) or `${env.VAR}` in committed YAML — never a literal credential. Although the engine still redacts a literal in its output, a literal private key under `secrets.privateKey` sits in plaintext in the **source YAML file**, which the engine cannot scrub.
- **Prefer the vault for rotation and audit.** All three value forms are redacted equally, so the vault is not required for log protection. Prefer it anyway for the indirection it buys: one rotation point, an audit surface, and a home for future secret sources.
- **Custom scripts can still leak secrets.** The engine redacts its own output and that of native commands, but a custom `command` receives the real value and can expose it. Never echo, persist, or argv-pass a secret in an author-written script.
- **Credentials live in `secrets:` or in known-chains connection fields, not `constants`.** A private key (or any secret) does not belong in `constants` — that block is for non-sensitive parameters only, and the engine does not tag or redact constant values. `${vault.X}` is rejected outside `secrets.*`, `repository.auth`, and the known-chains connection-credential fields.
- **Verification keys are not plan secrets.** The v1-era `secrets.verificationApiKey` slot (and its `""` tri-state) is gone — keys live on verification profiles in known-chains. Disable verification for a chain with `verifiers: false` on the plan's chain reference; switch accounts by selecting a different profile.
- **Mapping values are bare names.** A workflow mapping like `privateKey: "${vault.create3Deployer}"` is wrong — mapping values rename to a `secrets.<name>` key; they never contain `${...}` syntax.
- **Never put a token in `repository.uri`.** It would persist in `.git/config` and leak in logs. Use `repository.auth`.

## Relationships to other configs

| Other config | Relationship |
|---|---|
| [global-params.md](global-params.md) | Owns the **vault** registry (the store): stable role names → `${env.VAR}` pointers. Referenced via `${vault.X}` from plan secrets, known-chains connection credentials, and `repository.auth`. |
| [plans.md](plans.md) | Owns the plan **`secrets:` block** (slots + values): value forms, the Secrets keys table, and field-reference rows. Also the chain reference's `verifiers:` selector, which picks the verification profile(s) whose keys a run uses. |
| [workflows.md](workflows.md) | Owns the per-step **`privateKey` rename** mapping mechanics, and the **method-variant `keys` override** of that rename ([Method variants](workflows.md#method-variants--variantof)). |
| [actions.md](actions.md) | Owns `deploys` / `requiresPrivateKey` / `mode: send` (whether a step needs a key) and the `repository.auth` field definition. |
| [known-chains.md](known-chains.md) | Owns the **connection credentials**: verification profiles' `api_key` and RPC profiles' `headers` (see [Connection credentials](#connection-credentials-known-chains)). |
| [multisig.md](multisig.md) | Owns the **multisig-mode credentials**: the registry entry's `proposer` (Transaction Service delegate) and `executor` (gas payer) — single-token vault/env refs, tagged and redacted like every other credential. Safe **owner** keys are out of scope by design: owners sign in their own wallets, outside deploy-pad. |
| [references.md](references.md) | Canonical `${vault.NAME}` / `${secret.NAME}` namespace specs, the scoping matrix, and resolution order. |
| [engine-internals.md](engine-internals.md) | The runtime mechanics: vault resolution, secret tagging, and repository authentication. |
