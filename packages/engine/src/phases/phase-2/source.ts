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
import { parse } from 'yaml';
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

export interface ConfigDocument {
  /**
   * Where it came from, relative to the mount — the `file` half of a
   * diagnostic's location. `null` for a document that was never a file, which
   * the diagnostic model already tolerates.
   */
  readonly file: string | null;
  readonly data: unknown;
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

function readDocument(root: string, file: string): Read<ConfigDocument> {
  let text: string;
  try {
    text = readFileSync(join(root, file), 'utf8');
  } catch (cause) {
    if (isAbsent(cause)) return { kind: 'missing' };
    return { kind: 'failed', file, reason: reasonOf(cause) };
  }

  try {
    // An empty file parses to null — a document that declares nothing, which is
    // a different thing from a file that is not there.
    return { kind: 'found', value: { file, data: parse(text) as unknown } };
  } catch (cause) {
    return { kind: 'failed', file, reason: reasonOf(cause) };
  }
}

export function directoryConfigSource(configsDir: string, cwd: string = process.cwd()): ConfigSource {
  const root = isAbsolute(configsDir) ? configsDir : resolve(cwd, configsDir);

  return {
    origin: configsDir,

    read: (name): Read<ConfigDocument> => readDocument(root, `${name}${MOUNT_FILE_EXTENSION}`),

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
        const outcome = readDocument(root, join(PLANS_SUBDIRECTORY, name));
        // A file listed a moment ago and gone now is a race, not an absence.
        if (outcome.kind === 'failed') return outcome;
        if (outcome.kind === 'found') documents.push(outcome.value);
      }

      return { kind: 'found', value: documents };
    },
  };
}
