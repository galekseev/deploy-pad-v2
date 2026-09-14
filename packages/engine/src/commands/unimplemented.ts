/**
 * The commands whose phases have not landed yet.
 *
 * `status` and `report` read the results tree and engage no phase of the run, so
 * there is nothing for the config gates to do on their behalf — they stay
 * placeholders until S6 builds the tree reader. `run` and `validate` have left
 * this module: both pass phase 2's gates now, and each has a file of its own.
 *
 * They exit `0` rather than with a failure code, because a refusal is what the
 * flag matrix means by "this flag does not apply here" — an accepted invocation
 * that returned `1` would make the two indistinguishable. The warning is what
 * keeps the `0` from being read as work done, and the context dump at `debug` is
 * the useful half: it shows exactly what phase 1 decided.
 */
import { ExitCode, type ReportContext, type StatusContext } from '../contracts/index.ts';
import type { Logger } from '../cross/logging/index.ts';

/** Which slice of [the delivery plan](../../../../docs/implementation/delivery-plan.md) lands each. */
const DELIVERED_BY = { status: 'S6', report: 'S6' } as const;

export function unimplemented(context: StatusContext | ReportContext, logger: Logger): ExitCode {
  logger.warn(
    `${context.command} is not implemented yet — the invocation was accepted and nothing ran (slice ${DELIVERED_BY[context.command]})`,
  );
  logger.debug('run context', context);

  return ExitCode.Success;
}
