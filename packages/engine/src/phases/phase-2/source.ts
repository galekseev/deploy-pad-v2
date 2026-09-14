/**
 * The config source — reading only.
 *
 * Phase 2 has a seam in the same sense phase 1 does
 * ([phase 2 → The config source is a seam too](../../../../../docs/architecture/phase-2-load-validation.md#the-config-source-is-a-seam-too)):
 * gate 1 compares a declared version and gates 2–4 operate on the parsed object
 * graph, so reading and parsing YAML is *one producer* of that graph and not what
 * validates it. This module is that producer. The gates arrive with S2 and sit on
 * top of it, in front of the same interface.
 *
 * Which is why a document's `data` is `unknown` and stays that way: until the
 * schema gate exists there is nothing that has earned a narrower type, and
 * handing out an optimistic one would let a consumer skip the gate that S2 adds.
 *
 * **The source is the allowlist.** "What is mounted is what the run can use"
 * (NFR-033) is the file-shaped statement of a broader rule — a caller that builds
 * the graph in memory inherits the responsibility that mounting otherwise
 * discharges.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { isAlias, isPair, isScalar, parseDocument, visit } from 'yaml';
import { PLANS_SUBDIRECTORY } from '../phase-1/plan-ref.ts';

/**
 * The single-document files of a mount, from
 * [cli.md → `--configs-dir`](../../../../../docs/specs/cli.md#common-flags).
 * `plans` is the seventh name the schemas package carries and the one exception:
 * it is a directory of documents, reached through `plans()`.
 */
export const MOUNT_FILES = [
  'actions',
  'workflows',
  'known-chains',
  'global-params',
  'multisig',
  'engine',
] as const;

export type MountFile = (typeof MOUNT_FILES)[number];

/**
 * A YAML feature a v2 config may not use (FR-CFG-011): reuse is expressed
 * exclusively through `${...}` references, so that a diff shows what a value is
 * rather than where it was borrowed from.
 *
 * These are facts about the *syntax*, and the parser is the only thing that can
 * see them — by the time there is an object graph, an alias has been expanded
 * and a merge key has either merged or become an ordinary key. So reading
 * records them and the gate judges them, which is the same split the four gates
 * already follow.
 */
export interface ForbiddenYamlFeature {
  readonly feature: 'anchor' | 'alias' | 'merge-key';
  /** The anchor or alias name, or the key that performed the merge. */
  readonly name: string;
}

export interface ConfigDocument {
  /**
   * Where it came from, relative to the mount — the `file` half of a
   * diagnostic's location. `null` for a document that was never a file, which
   * the diagnostic model already tolerates.
   */
  readonly file: string | null;
  readonly data: unknown;
  /** Empty for a document that was never YAML. */
  readonly forbidden: readonly ForbiddenYamlFeature[];
}

/**
 * Absence and unreadability are different answers, so they are different
 * variants: `engine.yaml` is optional and `multisig.yaml` is only read in
 * multisig mode, while a file that exists and will not parse is a config error.
 */
export type Read<T> =
  | { readonly kind: 'found'; readonly value: T }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed'; readonly file: string; readonly reason: string };

export interface ConfigSource {
  /** What the source is, for a message: the mount as the operator wrote it. */
  readonly origin: string;
  read(name: MountFile): Read<ConfigDocument>;
  plans(): Read<readonly ConfigDocument[]>;
  /**
   * A document the caller located itself, rather than one this source names.
   *
   * It exists for the plan reference, which [cli.md](../../../../../docs/specs/cli.md#plan-argument-resolution)
   * defines in two forms: a short name resolves inside the mount, but a path is
   * "used as-is, relative to the project root" and may therefore point outside
   * it. Everything else the engine reads is mount-relative by construction, and
   * `read` is the method that says so.
   */
  readAt(path: string): Read<ConfigDocument>;
}

/**
 * A mount file is `<name>.yaml` exactly, as the spec names them. A plan file may
 * also be `.yml`, because the plan-reference rule tolerates that suffix on a
 * short name (FR-CLI-002) and a plan the CLI accepts has to be discoverable.
 */
const MOUNT_FILE_EXTENSION = '.yaml';
const PLAN_EXTENSIONS = ['.yaml', '.yml'] as const;

function isAbsent(cause: unknown): boolean {
  const code = (cause as { code?: unknown } | null)?.code;
  // ENOTDIR covers a mount whose parent is a file rather than a directory.
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The `<<` merge key, which YAML 1.1 merged and YAML 1.2 leaves as a plain key. */
const MERGE_KEY = '<<';

function forbiddenFeatures(document: ReturnType<typeof parseDocument>): ForbiddenYamlFeature[] {
  const found: ForbiddenYamlFeature[] = [];

  visit(document, {
    Alias: (_key, node) => {
      found.push({ feature: 'alias', name: node.source });
    },
    Pair: (_key, pair) => {
      if (isPair(pair) && isScalar(pair.key) && pair.key.value === MERGE_KEY) {
        found.push({ feature: 'merge-key', name: MERGE_KEY });
      }
    },
    Node: (_key, node) => {
      // An anchor with no alias pointing at it is still a reuse mechanism the
      // format does not have, and catching it here is what keeps the error at
      // the definition rather than at a use site far away.
      if (typeof node.anchor === 'string' && !isAlias(node)) {
        found.push({ feature: 'anchor', name: node.anchor });
      }
    },
  });

  return found;
}

/**
 * @param at   Where to read from, already resolved.
 * @param file What to call it in a document and a diagnostic — mount-relative for
 *             the mount's own files, as-written for a plan named by path.
 */
function readDocument(at: string, file: string): Read<ConfigDocument> {
  let text: string;
  try {
    text = readFileSync(at, 'utf8');
  } catch (cause) {
    if (isAbsent(cause)) return { kind: 'missing' };
    return { kind: 'failed', file, reason: reasonOf(cause) };
  }

  // `parseDocument` rather than `parse`, because the syntax facts above exist
  // only before the document becomes plain data.
  const document = parseDocument(text, { merge: false });
  const failure = document.errors[0];
  if (failure !== undefined) return { kind: 'failed', file, reason: failure.message };

  // An empty file yields null — a document that declares nothing, which is a
  // different thing from a file that is not there.
  return {
    kind: 'found',
    value: { file, data: document.toJS() as unknown, forbidden: forbiddenFeatures(document) },
  };
}

export function directoryConfigSource(configsDir: string, cwd: string = process.cwd()): ConfigSource {
  const root = isAbsolute(configsDir) ? configsDir : resolve(cwd, configsDir);

  return {
    origin: configsDir,

    read: (name): Read<ConfigDocument> => {
      const file = `${name}${MOUNT_FILE_EXTENSION}`;
      return readDocument(join(root, file), file);
    },

    // Resolved against the working directory rather than joined onto the mount:
    // a plan named by path is relative to the project root and may be absolute.
    // The document keeps the path as written, so a diagnostic names what the
    // operator typed rather than where it ended up.
    readAt: (path): Read<ConfigDocument> => readDocument(resolve(cwd, path), path),

    plans: (): Read<readonly ConfigDocument[]> => {
      let entries: readonly string[];
      try {
        entries = readdirSync(join(root, PLANS_SUBDIRECTORY), { withFileTypes: true })
          .filter(
            (entry) =>
              entry.isFile() && PLAN_EXTENSIONS.some((suffix) => entry.name.endsWith(suffix)),
          )
          .map((entry) => entry.name)
          // Sorted so that two runs over one mount report in the same order.
          .sort((left, right) => left.localeCompare(right));
      } catch (cause) {
        if (isAbsent(cause)) return { kind: 'missing' };
        return { kind: 'failed', file: PLANS_SUBDIRECTORY, reason: reasonOf(cause) };
      }

      const documents: ConfigDocument[] = [];
      for (const name of entries) {
        const file = join(PLANS_SUBDIRECTORY, name);
        const outcome = readDocument(join(root, file), file);
        // A file listed a moment ago and gone now is a race, not an absence.
        if (outcome.kind === 'failed') return outcome;
        if (outcome.kind === 'found') documents.push(outcome.value);
      }

      return { kind: 'found', value: documents };
    },
  };
}
