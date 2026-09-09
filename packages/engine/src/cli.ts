/**
 * The command-line surface — and only that.
 *
 * It parses an invocation, renders output, and returns an exit code; no run
 * behavior lives here (NFR-060). Phase 1 turns argv into a run context, dispatch
 * takes it from there, and neither reads argv again — which is what makes every
 * command invocable in-process from the parameters alone.
 *
 * Two properties are load-bearing and worth keeping: nothing here calls
 * `process.exit` — an exit code is returned up the stack so the log's tail cannot
 * be truncated — and every byte of output, commander's own help and errors
 * included, leaves through the logger and therefore through the redactor.
 */
import { dispatch } from './commands/index.ts';
import { ExitCode, type Diagnostic } from './contracts/index.ts';
import { loadWorkspaceEnv } from './cross/env-file.ts';
import {
  createLogger,
  processStreams,
  serializeError,
  type ConsoleStreams,
  type FileSink,
  type Logger,
} from './cross/logging/index.ts';
import { parseInvocation, type PendingOutput } from './phases/phase-1/index.ts';
import type { ConfigSource } from './phases/phase-2/index.ts';

export interface CliIo {
  readonly streams?: ConsoleStreams | undefined;
  readonly openFile?: ((path: string) => FileSink) | undefined;
  readonly now?: (() => Date) | undefined;
  readonly color?: boolean | undefined;
  readonly cwd?: string | undefined;
  readonly loadEnvFile?: ((path: string) => void) | undefined;
  readonly source?: ConfigSource | undefined;
}

export function runCli(argv: readonly string[], io: CliIo = {}): ExitCode {
  const streams = io.streams ?? processStreams();

  try {
    return invoke(argv, { ...io, streams });
  } catch (cause) {
    // An uncaught stack trace could carry a resolved credential, so even the
    // last-resort report goes through the logger (NFR-003).
    const logger = createLogger({ level: 'error', logFile: null }, { streams, color: io.color });
    const failure = serializeError(cause);
    logger.error(`unexpected engine failure: ${failure.message}`, failure);
    if (failure.stack !== null) logger.print(failure.stack, { level: 'error', stream: 'err' });
    logger.close();
    return ExitCode.Configuration;
  }
}

function invoke(argv: readonly string[], io: CliIo & { streams: ConsoleStreams }): ExitCode {
  const parsed = parseInvocation(argv);

  const logger = createLogger(
    { level: parsed.level, logFile: parsed.logFile },
    { streams: io.streams, openFile: io.openFile, now: io.now, color: io.color },
  );

  try {
    flush(logger, parsed.pending);

    switch (parsed.outcome.kind) {
      case 'self-reported':
        return ExitCode.Success;

      case 'no-command':
        logger.error('no command given');
        logger.print(parsed.outcome.help, { level: 'error', stream: 'err' });
        return ExitCode.Configuration;

      case 'refused':
        report(logger, parsed.outcome.diagnostics);
        return ExitCode.Configuration;

      case 'context': {
        const context = parsed.outcome.context;

        // FR-CLI-003: the mount's `.env` is in the environment before anything
        // resolves `${env.VAR}` or follows a vault pointer into it.
        const envFile = loadWorkspaceEnv(context.configsDir, {
          cwd: io.cwd,
          load: io.loadEnvFile,
        });
        logger.debug(
          envFile.loaded
            ? `loaded environment from ${envFile.path}`
            : `no environment file at ${envFile.path}`,
        );

        return dispatch(context, { logger, source: io.source, cwd: io.cwd });
      }
    }
  } finally {
    logger.close();
  }
}

function report(logger: Logger, diagnostics: readonly Diagnostic[]): void {
  for (const diagnostic of diagnostics) logger.error(diagnostic.message, diagnostic);
}

function flush(logger: Logger, pending: readonly PendingOutput[]): void {
  for (const entry of pending) {
    logger.print(entry.text.trimEnd(), { level: entry.level, stream: entry.stream });
  }
}
