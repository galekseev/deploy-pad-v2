/**
 * Phase 2's front half: read the mount, run gates 1 and 2 over it, and report in
 * one of two modes.
 *
 * **One phase, two reporting modes**, per
 * [phase 2](../../../../../docs/architecture/phase-2-load-validation.md#one-phase-two-reporting-modes).
 * The gates are identical for `run` and `validate`; what differs is that a run is
 * heading toward on-chain state and aborts at the first failing file, while
 * `validate` accumulates everything so an author fixes their config once instead
 * of six times (NFR-022).
 *
 * Gates 3 and 4 — referential rules and value resolution — arrive with S3 and sit
 * behind the same call.
 */
import {
  blocksRun,
  type Diagnostic,
  diagnosticError,
} from '../../contracts/index.ts';
import { checkVersion, checkYamlFeatures } from './version.ts';
import type { SchemaName, SchemaRegistry } from './schema.ts';
import type { ConfigDocument, ConfigSource, MountFile } from './source.ts';

export type ReportingMode = 'collect' | 'abort';

/**
 * What a caller needs out of the mount. Stated rather than assumed, because the
 * commands genuinely differ: `validate` needs the chain registry, `list` never
 * looks at it, and failing `list` over a `global-params.yaml` it will not read
 * would be an error about nothing.
 */
export type Want =
  | { readonly kind: 'file'; readonly name: MountFile; readonly required: boolean }
  /** One plan, named by phase 1's resolved reference. */
  | { readonly kind: 'plan'; readonly path: string }
  /** Every plan under `plans/`, for a command that enumerates them. */
  | { readonly kind: 'plans' };

export interface LoadRequest {
  readonly source: ConfigSource;
  readonly schemas: SchemaRegistry;
  readonly want: readonly Want[];
  readonly ignoreVersion: boolean;
  readonly mode: ReportingMode;
}

export interface LoadedConfigSet {
  /** Keyed by the document's path within the mount. Absent optional files are simply not here. */
  readonly documents: ReadonlyMap<string, ConfigDocument>;
  readonly diagnostics: readonly Diagnostic[];
}

export function hasErrors(set: LoadedConfigSet): boolean {
  return set.diagnostics.some(blocksRun);
}

/**
 * Gate 1 then gate 2, over one already-read document.
 *
 * A version **error** suppresses gate 2 for that file: the engine has just said
 * it does not speak this file's format, and shape errors that follow are as
 * likely to be the format gap as the author's mistake. With `--ignore-version`
 * the mismatch is a warning, gate 2 runs, and its errors are exactly the ones
 * engine-internals says the warning makes explainable.
 */
function gates(
  document: ConfigDocument,
  schema: SchemaName,
  request: LoadRequest,
): readonly Diagnostic[] {
  const version = checkVersion(document, request.ignoreVersion);
  const collected: Diagnostic[] = version === null ? [] : [version];

  collected.push(...checkYamlFeatures(document));

  if (version !== null && blocksRun(version)) return collected;

  collected.push(...request.schemas.validate(schema, document));
  return collected;
}

function readFile(
  request: LoadRequest,
  name: MountFile,
  required: boolean,
): { readonly document: ConfigDocument | null; readonly diagnostics: readonly Diagnostic[] } {
  const file = `${name}.yaml`;
  const read = request.source.read(name);

  switch (read.kind) {
    case 'missing':
      return {
        document: null,
        diagnostics: required
          ? [
              diagnosticError({
                code: 'config.file-missing',
                phase: 2,
                location: { file },
                requirement: 'FR-CFG-015',
                message: `no ${file} under ${request.source.origin} — the mount is the allowlist, so a file the run needs has to be in it`,
              }),
            ]
          : [],
      };
    case 'failed':
      return { document: null, diagnostics: [unparseable(read.file, read.reason)] };
    case 'found':
      return { document: read.value, diagnostics: gates(read.value, name, request) };
  }
}

function unparseable(file: string, reason: string): Diagnostic {
  return diagnosticError({
    code: 'config.unparseable',
    phase: 2,
    location: { file },
    requirement: 'FR-CFG-010',
    message: `${file} is not readable as YAML: ${reason}`,
  });
}

/**
 * The one plan phase 1 named. Read by path rather than looked up among the
 * mount's plans, because the path form of `-e` is relative to the project root
 * and need not be inside the mount at all.
 *
 * A plan that is not there is the load error phase 1 deliberately did not raise:
 * it resolved the reference and left opening the file to here.
 */
function readPlan(
  request: LoadRequest,
  path: string,
): { readonly documents: readonly ConfigDocument[]; readonly diagnostics: readonly Diagnostic[] } {
  const read = request.source.readAt(path);

  switch (read.kind) {
    case 'missing':
      return {
        documents: [],
        diagnostics: [
          diagnosticError({
            code: 'config.file-missing',
            phase: 2,
            location: { file: path },
            requirement: 'FR-CLI-002',
            message: `no plan at ${path}`,
          }),
        ],
      };
    case 'failed':
      return { documents: [], diagnostics: [unparseable(read.file, read.reason)] };
    case 'found':
      return { documents: [read.value], diagnostics: gates(read.value, 'plans', request) };
  }
}

function readAllPlans(
  request: LoadRequest,
): { readonly documents: readonly ConfigDocument[]; readonly diagnostics: readonly Diagnostic[] } {
  const read = request.source.plans();

  if (read.kind === 'failed') {
    return { documents: [], diagnostics: [unparseable(read.file, read.reason)] };
  }

  const available = read.kind === 'found' ? read.value : [];

  return {
    documents: available,
    diagnostics: available.flatMap((document) => gates(document, 'plans', request)),
  };
}

export function loadConfigSet(request: LoadRequest): LoadedConfigSet {
  const documents = new Map<string, ConfigDocument>();
  const diagnostics: Diagnostic[] = [];

  const keep = (document: ConfigDocument | null): void => {
    if (document?.file != null) documents.set(document.file, document);
  };

  for (const want of request.want) {
    if (want.kind === 'file') {
      const outcome = readFile(request, want.name, want.required);
      keep(outcome.document);
      diagnostics.push(...outcome.diagnostics);
    } else {
      const outcome = want.kind === 'plan' ? readPlan(request, want.path) : readAllPlans(request);
      for (const document of outcome.documents) keep(document);
      diagnostics.push(...outcome.diagnostics);
    }

    // A run is heading toward on-chain state, so speed of abort matters more
    // than completeness of report; `validate` is the other way round.
    if (request.mode === 'abort' && diagnostics.some(blocksRun)) break;
  }

  return { documents, diagnostics };
}

/**
 * The mount a plan-driven command reads, in the order phase 2 lists it. Plans are
 * last because a missing plan is the error an author most wants to see attributed
 * to the plan rather than buried under the catalogs.
 */
export function configSetFor(options: {
  readonly plan: string | null;
  readonly multisig: boolean;
}): readonly Want[] {
  return [
    { kind: 'file', name: 'actions', required: true },
    { kind: 'file', name: 'workflows', required: true },
    { kind: 'file', name: 'known-chains', required: true },
    { kind: 'file', name: 'global-params', required: true },
    // Not merely optional — skipped outright outside multisig mode. The registry
    // is the sandboxing surface, and a run that is not going through a Safe has
    // no business opening it at all.
    ...(options.multisig
      ? [{ kind: 'file', name: 'multisig', required: true } satisfies Want]
      : []),
    // Optional everywhere: absent means the shipped default applies (S8).
    { kind: 'file', name: 'engine', required: false },
    ...(options.plan === null
      ? []
      : [{ kind: 'plan', path: options.plan } satisfies Want]),
  ];
}
