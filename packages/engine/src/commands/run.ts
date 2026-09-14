/**
 * `run` — at this slice, the other half of phase 2's reporting contract.
 *
 * A run is heading toward on-chain state, so it **aborts at the first failing
 * file** rather than accumulating a report: speed of abort matters more than
 * completeness, which is the whole reason `validate` exists as a separate command
 * ([phase 2 → One phase, two reporting modes](../../../../docs/architecture/phase-2-load-validation.md#one-phase-two-reporting-modes)).
 *
 * Past the gates there is nothing to do yet — phases 3 through 8 arrive with S4
 * and S5 — so an invocation that loads cleanly warns and succeeds. The gates
 * themselves are real, which is what makes the two reporting modes testable
 * against each other now rather than in three slices' time.
 */
import { ExitCode, exitCodeFor, type RunCommandContext } from '../contracts/index.ts';
import type { Logger } from '../cross/logging/index.ts';
import {
  configSetFor,
  loadConfigSet,
  schemaRegistry,
  type ConfigSource,
  type SchemaRegistry,
} from '../phases/phase-2/index.ts';
import { reportDiagnostics } from './diagnostics.ts';

export interface RunIo {
  readonly source: ConfigSource;
  readonly schemas?: SchemaRegistry | undefined;
  readonly logger: Logger;
}

export function run(context: RunCommandContext, io: RunIo): ExitCode {
  const loaded = loadConfigSet({
    source: io.source,
    schemas: io.schemas ?? schemaRegistry(),
    want: configSetFor({
      plan: context.plan.path,
      multisig: context.sender.mode === 'multisig',
    }),
    ignoreVersion: context.ignoreVersion,
    mode: 'abort',
  });

  reportDiagnostics(io.logger, loaded.diagnostics);

  const exit = exitCodeFor(loaded.diagnostics);
  if (exit !== ExitCode.Success) return exit;

  io.logger.warn(
    'run is not implemented past config loading yet — the config set loaded and nothing ran (slice S5)',
  );
  io.logger.debug('run context', context);

  return ExitCode.Success;
}
