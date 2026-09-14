/**
 * Gate 1 — the config format version, and the two other things that can be wrong
 * with a file before its shape is worth looking at.
 *
 * Runs per file, as the very first step on that file: the engine knows a file
 * written against a different format may have moved or repurposed fields, and
 * the safest thing to do with that knowledge is stop before misinterpreting them
 * ([engine-internals.md → Config version check](../../../../../docs/specs/engine-internals.md#config-version-check)).
 *
 * Everything here is a pure function of already-read facts. Nothing opens a file.
 */
import { CONFIG_FORMAT_VERSION } from '@deploy-pad/schemas';
import {
  diagnosticError,
  diagnosticWarning,
  type Diagnostic,
} from '../../contracts/index.ts';
import type { ConfigDocument } from './source.ts';

/** The one key of a config file that is not part of its own name space. */
export const VERSION_KEY = 'version';

function declaredVersion(data: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined;
  return (data as Record<string, unknown>)[VERSION_KEY];
}

/**
 * The comparison is exact, never a range: the format version is one integer
 * bumped on a breaking change and the engine speaks exactly one at a time
 * (FR-CFG-014, TC-4).
 *
 * @param ignoreVersion Downgrades a mismatch to a warning — and nothing else.
 *                      It is the version gate's escape hatch alone; a file that
 *                      is the wrong shape still fails gate 2.
 */
export function checkVersion(document: ConfigDocument, ignoreVersion: boolean): Diagnostic | null {
  const declared = declaredVersion(document.data);
  const location = { file: document.file };

  // The engine has no declared version to compare against, so it cannot
  // conclude a mismatch — always a warning, `--ignore-version` or not.
  if (declared === undefined || declared === null) {
    return diagnosticWarning({
      code: 'config.version-missing',
      phase: 2,
      location,
      requirement: 'FR-CFG-013',
      message: `${document.file ?? 'the config'} declares no ${VERSION_KEY} key — add ${VERSION_KEY}: ${String(CONFIG_FORMAT_VERSION)} so the format gate can check it`,
    });
  }

  if (declared === CONFIG_FORMAT_VERSION) return null;

  const message = `${document.file ?? 'the config'} declares config version ${JSON.stringify(declared)} but this engine supports version ${String(CONFIG_FORMAT_VERSION)}`;

  return ignoreVersion
    ? diagnosticWarning({
        code: 'config.version-mismatch',
        phase: 2,
        location,
        requirement: 'FR-CFG-013',
        message: `${message} — proceeding because --ignore-version was passed; validation errors below may be caused by the format gap`,
      })
    : diagnosticError({
        code: 'config.version-mismatch',
        phase: 2,
        location,
        requirement: 'FR-CFG-013',
        message: `${message} — re-run with --ignore-version to proceed anyway`,
      });
}

/**
 * FR-CFG-011: reuse is expressed exclusively through `${...}` references, so
 * anchors, aliases and the merge key are rejected. A schema cannot see any of
 * them — the parser has already expanded an alias by the time ajv looks — which
 * is why the facts travel on the document and the judgement happens here.
 *
 * A validation error rather than a configuration one: the file parsed and the
 * engine understood it perfectly well; what it contains is against the rules.
 */
export function checkYamlFeatures(document: ConfigDocument): readonly Diagnostic[] {
  return document.forbidden.map((found) =>
    diagnosticError({
      code: 'config.yaml-feature-forbidden',
      phase: 2,
      location: { file: document.file },
      requirement: 'FR-CFG-011',
      message:
        found.feature === 'merge-key'
          ? `${document.file ?? 'the config'} uses the YAML merge key — v2 configs express reuse through \${...} references instead`
          : `${document.file ?? 'the config'} uses a YAML ${found.feature} (${found.name}) — v2 configs express reuse through \${...} references instead`,
    }),
  );
}
