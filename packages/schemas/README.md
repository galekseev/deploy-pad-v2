# @deploy-pad/schemas

The deploy-pad configuration contract: one JSON Schema per config file, plus the
config format version those schemas describe.

This package exists because the schemas serve four consumers — the engine at
load time, a config author's editor, the specs that document them, and the
visual editor that will be built separately. That makes them a contract between
repositories rather than an engine asset, and a browser application should not
have to depend on `ethers` and `execa` to obtain seven YAML files.

## Versioning

**The major version equals the config format version.** `2.x` means config
format `2`, so an engine that declares `@deploy-pad/schemas@^2` has declared
which format it speaks, and changing the format is a major release by
construction.

## Contents

| Subpath | What it is |
|---|---|
| `@deploy-pad/schemas` | `CONFIG_FORMAT_VERSION` and the list of schema names |
| `@deploy-pad/schemas/<name>.schema.yaml` | The **authored** schema — the only editable copy |
| `@deploy-pad/schemas/<name>.schema.json` | Generated twin, for consumers without a YAML parser |

`<name>` is one of `actions`, `workflows`, `plans`, `known-chains`,
`global-params`, `multisig`, `engine`.

## Editor wiring

A workspace repository that installs nothing can point a config file's modeline
at the published JSON through a CDN, with the **major pinned in the URL** so the
schema behind it cannot follow the config format across a version boundary:

```yaml
# yaml-language-server: $schema=https://cdn.jsdelivr.net/npm/@deploy-pad/schemas@2/dist/plans.schema.json
```

A repository that does install the package maps `yaml.schemas` into
`node_modules/@deploy-pad/schemas/src/` instead — one place to point, and config
files that carry no path at all.

## Editing a schema

The authored YAML under `src/` is the only editable copy; `dist/` is generated
by `pnpm build` and is not committed. The specs under
[`docs/specs/`](../../docs/specs/) own what each field *means* and are reviewed
together with any schema change.
