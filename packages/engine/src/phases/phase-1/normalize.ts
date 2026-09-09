/**
 * One argv rewrite, for one flag commander cannot declare.
 *
 * [cli.md](../../../../../docs/specs/cli.md#flags-by-command) and FR-CLI-010
 * spell the chain-exclusion flag `-xc, --exclude-chain` — a two-character short
 * flag, carried over from v1. Commander refuses it at option-creation time ("a
 * short flag is a single dash and a single character"), so the option is declared
 * as `--exclude-chain` alone and `-xc` is translated here, before the parser sees
 * it. The spec keeps its flag and nothing extra becomes accepted: `-x` and
 * `--xc` are still unknown options.
 */
export const EXCLUDE_CHAIN_SHORT_FLAG = '-xc';
export const EXCLUDE_CHAIN_LONG_FLAG = '--exclude-chain';

/** Everything after the argv terminator is an operand, never a flag. */
const TERMINATOR = '--';

export function normalizeArgv(argv: readonly string[]): readonly string[] {
  const normalized: string[] = [];
  let terminated = false;

  for (const token of argv) {
    if (terminated) {
      normalized.push(token);
      continue;
    }

    if (token === TERMINATOR) {
      terminated = true;
      normalized.push(token);
    } else if (token === EXCLUDE_CHAIN_SHORT_FLAG) {
      normalized.push(EXCLUDE_CHAIN_LONG_FLAG);
    } else if (token.startsWith(`${EXCLUDE_CHAIN_SHORT_FLAG}=`)) {
      normalized.push(
        `${EXCLUDE_CHAIN_LONG_FLAG}=${token.slice(EXCLUDE_CHAIN_SHORT_FLAG.length + 1)}`,
      );
    } else {
      normalized.push(token);
    }
  }

  return normalized;
}
