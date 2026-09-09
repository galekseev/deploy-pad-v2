/**
 * The commands whose pipeline has not landed yet.
 *
 * S1's goal is that every invocation the CLI will ever see is either accepted
 * into a run context or rejected with exit `1`. For `run`, `validate`, `status`
 * and `report` the accepting is all there is so far: their contexts are built and
 * frozen, and phases 2–8 arrive with the slices named below.
 *
 * They exit `0` rather than with a failure code, because a refusal is what the
 * flag matrix means by "this flag does not apply here" — an accepted invocation
 * that returned `1` would make the two indistinguishable. The warning is what
 * keeps the `0` from being read as work done, and the context dump at `debug` is
 * the useful half: it shows exactly what phase 1 decided.
 */
import { ExitCode, type RunContext } from '../contracts/index.ts';
import type { Logger } from '../cross/logging/index.ts';

/** Which slice of [the delivery plan](../../../../docs/implementation/delivery-plan.md) lands each. */
const DELIVERED_BY: Record<'run' | 'validate' | 'status' | 'report', string> = {
  run: 'S5',
  validate: 'S2',
  status: 'S6',
  report: 'S6',
};

export function unimplemented(
  context: RunContext & { readonly command: keyof typeof DELIVERED_BY },
  logger: Logger,
): ExitCode {
  logger.warn(
    `${context.command} is not implemented yet — the invocation was accepted and nothing ran (slice ${DELIVERED_BY[context.command]})`,
  );
  logger.debug('run context', context);

  return ExitCode.Success;
}
