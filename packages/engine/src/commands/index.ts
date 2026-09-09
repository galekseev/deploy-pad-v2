/**
 * Command dispatch: a run context in, an exit code out.
 *
 * This is the whole of what the command line hands over. Dispatch takes the
 * artifact rather than argv, and its io is injected rather than reached for, so a
 * command runs in-process with nothing touching the real environment (NFR-060).
 * Nothing here calls `process.exit`: an exit code is returned up the stack so the
 * log's tail cannot be truncated.
 */
import type { ExitCode, RunContext } from '../contracts/index.ts';
import type { Logger } from '../cross/logging/index.ts';
import { directoryConfigSource, type ConfigSource } from '../phases/phase-2/index.ts';
import { list } from './list.ts';
import { unimplemented } from './unimplemented.ts';

export interface CommandIo {
  readonly logger: Logger;
  /** Defaults to the mount the context names. A caller may supply the graph instead. */
  readonly source?: ConfigSource | undefined;
  readonly cwd?: string | undefined;
}

export function dispatch(context: RunContext, io: CommandIo): ExitCode {
  switch (context.command) {
    case 'list':
      return list(context, io.source ?? directoryConfigSource(context.configsDir, io.cwd), io.logger);
    case 'run':
    case 'validate':
    case 'status':
    case 'report':
      return unimplemented(context, io.logger);
  }
}

export { list } from './list.ts';
export { unimplemented } from './unimplemented.ts';
