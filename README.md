# deploy-pad v2

Repeatable, auditable multi-chain smart-contract deployments from declarative
config. Launching a protocol is rarely one transaction — it is a sequence of
deployments and calls, in a specific order, on many chains at once, each with its
own addresses, keys and explorer accounts. This engine makes that sequence a file
you review rather than a terminal session you hope to remember.

> **Status:** the scaffold. The repository builds, tests, publishes and logs;
> nothing reads a config yet. See
> [docs/implementation/delivery-plan.md](docs/implementation/delivery-plan.md)
> for what lands next and in what order.

## The design set comes first

The documentation is the source of truth, not a description of the code. It has
~250 numbered requirements and thirteen quality scenarios written as
stimulus-and-response, so the test suite is the executable form of a document
that already exists — and where code and a spec disagree, which one is wrong is
a decision rather than a default.

Start at [docs/README.md](docs/README.md). The three folders below it:

| Folder | Owns |
|---|---|
| [docs/specs/](docs/specs/) | Field-level semantics: one doc per config file, plus references, secrets, naming and the CLI |
| [docs/architecture/](docs/architecture/) | The conceptual design of a run — arc42, and one doc per lifecycle phase |
| [docs/implementation/](docs/implementation/) | How it is built in code: the stack, phase artifact contracts, the delivery plan, the test strategy |

## Layout

```
packages/
  schemas/          @deploy-pad/schemas — the config contract, published for the
                    engine, an author's editor, and the visual editor to come
  engine/           @deploy-pad/engine — bin: deploy-pad
docs/               the design set
test/               cross-package contract tests, fixtures, traceability claims
scripts/            repository checks: versions, traceability, packed artifact
```

## Working on it

Node 24 or newer and pnpm — the version comes from the `packageManager` field,
so `pnpm install` is enough and nothing depends on corepack.

```bash
pnpm install
pnpm run verify           # typecheck, lint, tests, version and traceability checks
pnpm run deploy-pad --help
```

The dev loop runs TypeScript directly: node strips the types, so there is no
build step between an edit and a run, and no watcher to keep alive. Type
checking is a separate command because node never does it.

| Command | What it does |
|---|---|
| `pnpm run typecheck` | `tsc --noEmit` over every package, test and script |
| `pnpm run lint` | eslint, including the rules that keep every byte of output inside the logger |
| `pnpm run test` | The unit, contract and CLI levels |
| `pnpm run build` | `tsc` per package, plus the schema JSON generator |
| `pnpm run check:versions` | The schemas major equals the config format version, and both packages share it |
| `pnpm run check:traceability` | Which requirements a delivered slice claims, and whether a test names each one |
| `pnpm run check:packed` | Packs both packages, installs the tarballs into a clean directory outside the workspace, and drives the installed binary |

## Two conventions worth knowing before you write code

**Nothing writes to a stream directly.** Every line the engine emits leaves
through the logger, which passes it through the redactor — so a resolved
credential cannot reach a log, a record or a terminal, at any verbosity level.
`console.*`, `process.stdout` and `process.exit` are lint errors outside
`packages/engine/src/cross/logging/`. Adding a secret to the registry is one
call; there is deliberately nowhere else to put one.

**A test names the requirement it proves.** `it('[FR-CHN-012] rejects an unknown
chain name at load', …)` — one id per test, and
[test/traceability/slices.yaml](test/traceability/slices.yaml) records what each
delivered slice claims. A claim without a test fails CI; a requirement nothing
claims yet is reported as information, and is expected to be most of them for a
while.

## License

MIT
