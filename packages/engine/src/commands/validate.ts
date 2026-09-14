/**
 * `validate` — everything `run` checks before executing, without executing
 * (FR-CLI-021).
 *
 * At this slice that means gates 1 and 2: the format version and the shape. The
 * referential rules, value resolution and static planning checks that complete
 * FR-CLI-020 arrive with S3 and S4, behind the same `loadConfigSet` call, so this
 * command grows by passing more gates rather than by changing.
 *
 * Its defining property is already here though: **every** error, not the first
 * one (NFR-022). An author fixing one shape error per invocation is an author
 * running `validate` six times.
 */
import { ExitCode, exitCodeFor, type Diagnostic, type ValidateContext } from '../contracts/index.ts';
import type { Logger } from '../cross/logging/index.ts';
import {
  configSetFor,
  loadConfigSet,
  schemaRegistry,
  type ConfigSource,
  type SchemaRegistry,
} from '../phases/phase-2/index.ts';
import { reportDiagnostics } from './diagnostics.ts';

export interface ValidateIo {
  readonly source: ConfigSource;
  readonly schemas?: SchemaRegistry | undefined;
  readonly logger: Logger;
}

export function validate(context: ValidateContext, io: ValidateIo): ExitCode {
  const loaded = loadConfigSet({
    source: io.source,
    schemas: io.schemas ?? schemaRegistry(),
    want: configSetFor({
      plan: context.plan.path,
      multisig: context.multisigEntry !== null,
    }),
    ignoreVersion: context.ignoreVersion,
    // The whole point of the command.
    mode: 'collect',
  });

  reportDiagnostics(io.logger, loaded.diagnostics);

  const exit = exitCodeFor(loaded.diagnostics);
  if (exit === ExitCode.Success) io.logger.info(summary(context, loaded.diagnostics));

  return exit;
}

/**
 * Said explicitly, because a command that prints nothing on success leaves the
 * operator wondering whether it ran — and because naming what was *not* checked
 * is the honest thing while the later gates are missing.
 */
function summary(context: ValidateContext, diagnostics: readonly Diagnostic[]): string {
  const warnings =
    diagnostics.length === 0 ? '' : ` (${String(diagnostics.length)} warning${diagnostics.length === 1 ? '' : 's'})`;

  return `${context.plan.input} loads and matches its schema${warnings} — references and values are not checked yet`;
}
