/**
 * The plan argument rule (FR-CLI-002), from
 * [cli.md → Plan argument resolution](../../../../../docs/specs/cli.md#plan-argument-resolution).
 *
 * Phase 1 resolves the *reference* — which file the later load will open — and
 * stops there. The file is never opened here; a nonexistent plan is a phase-2
 * load error, so that `validate` can report it alongside everything else a file
 * gets wrong.
 *
 * The resolved path stays relative. Records must carry no absolute path
 * (NFR-043), and a run context is what phase 4 copies its launch parameters
 * from.
 */
import { join } from 'node:path';

export const PLANS_SUBDIRECTORY = 'plans';

const PLAN_EXTENSION = '.yaml';

/** A trailing `.yaml` / `.yml` on a short name is tolerated rather than doubled. */
const TOLERATED_SUFFIX = /\.ya?ml$/iu;

/** A short name has no separator; anything with one is a path the author meant literally. */
export function isShortName(input: string): boolean {
  return !input.includes('/') && !input.includes('\\');
}

/**
 * @param input      The `-e, --plan` argument exactly as typed.
 * @param configsDir The mount a short name resolves inside of.
 */
export function resolvePlanPath(input: string, configsDir: string): string {
  if (!isShortName(input)) return input;

  const stem = input.replace(TOLERATED_SUFFIX, '');
  return join(configsDir, PLANS_SUBDIRECTORY, `${stem}${PLAN_EXTENSION}`);
}
