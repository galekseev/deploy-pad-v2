/**
 * Command dispatch: a run context in, an exit code out.
 *
 * This is the whole of what the command line hands over. Dispatch takes the
 * artifact rather than argv, and its io is injected rather than reached for, so a
 * command runs in-process with nothing touching the real environment (NFR-060).
 * Nothing here calls `process.exit`: an exit code is returned up the stack so the
 * log's tail cannot be truncated.
 *
 * The schema registry is built once per dispatch and shared: compiling seven
 * schemas is the expensive part of a validation, and a command that loads several
 * files should pay it once.
 */
import type { ExitCode, RunContext } from '../contracts/index.ts';
import type { Logger } from '../cross/logging/index.ts';
import {
  directoryConfigSource,
  schemaRegistry,
  type ConfigSource,
  type SchemaRegistry,
} from '../phases/phase-2/index.ts';
import { list } from './list.ts';
import { run } from './run.ts';
import { unimplemented } from './unimplemented.ts';
import { validate } from './validate.ts';

export interface CommandIo {
  readonly logger: Logger;
  /** Defaults to the mount the context names. A caller may supply the graph instead. */
  readonly source?: ConfigSource | undefined;
  readonly schemas?: SchemaRegistry | undefined;
  readonly cwd?: string | undefined;
}

export function dispatch(context: RunContext, io: CommandIo): ExitCode {
  const reading = (): { readonly source: ConfigSource; readonly schemas: SchemaRegistry; readonly logger: Logger } => ({
    source: io.source ?? directoryConfigSource(context.configsDir, io.cwd),
    schemas: io.schemas ?? schemaRegistry(),
    logger: io.logger,
  });

  switch (context.command) {
    case 'list':
      return list(context, reading());
    case 'validate':
      return validate(context, reading());
    case 'run':
      return run(context, reading());
    case 'status':
    case 'report':
      return unimplemented(context, io.logger);
  }
}

export { renderDiagnostics, reportDiagnostics } from './diagnostics.ts';
export { list } from './list.ts';
export { run } from './run.ts';
export { unimplemented } from './unimplemented.ts';
export { validate } from './validate.ts';
