/**
 * The command-line surface.
 *
 * At this slice it is the shell of one: the common flags the logger and the
 * environment wrapper need, and nothing else. Command dispatch and the
 * per-command flag matrix (FR-CLI-001, FR-CLI-006) arrive next, built so that a
 * flag outside a command's column cannot be represented.
 *
 * Two properties are load-bearing already and worth keeping: nothing here calls
 * `process.exit` — an exit code is returned up the stack so the log's tail
 * cannot be truncated — and every byte of output, commander's own help and
 * errors included, leaves through the logger and therefore through the redactor.
 */
import { CONFIG_FORMAT_VERSION } from '@deploy-pad/schemas';
import { Command, CommanderError, Option } from 'commander';
import { ExitCode } from './contracts/index.ts';
import { DEFAULT_CONFIGS_DIR, loadWorkspaceEnv } from './cross/env-file.ts';
import {
  DEFAULT_LOG_LEVEL,
  LOG_LEVELS,
  createLogger,
  processStreams,
  serializeError,
  type ConsoleStreams,
  type EmittedLevel,
  type FileSink,
  type Logger,
  type LogLevel,
} from './cross/logging/index.ts';
import { engineVersion } from './version.ts';

export interface CliIo {
  readonly streams?: ConsoleStreams | undefined;
  readonly openFile?: ((path: string) => FileSink) | undefined;
  readonly now?: (() => Date) | undefined;
  readonly color?: boolean | undefined;
  readonly cwd?: string | undefined;
  readonly loadEnvFile?: ((path: string) => void) | undefined;
}

interface GlobalOptions {
  readonly logLevel: LogLevel;
  readonly verbose: boolean | undefined;
  readonly quiet: boolean | undefined;
  readonly logFile: string | undefined;
  readonly configsDir: string;
}

/** Commander writes help and errors while parsing, before the console level is known. */
interface PendingOutput {
  readonly text: string;
  readonly level: EmittedLevel;
  readonly stream: 'out' | 'err';
}

type LevelChoice =
  | { readonly kind: 'resolved'; readonly level: LogLevel }
  | { readonly kind: 'conflict'; readonly flags: readonly string[] };

const LEVEL_FLAGS = {
  logLevel: '--log-level',
  verbose: '-v, --verbose',
  quiet: '-q, --quiet',
} as const;

export function runCli(argv: readonly string[], io: CliIo = {}): ExitCode {
  const streams = io.streams ?? processStreams();

  try {
    return dispatch(argv, { ...io, streams });
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

function dispatch(argv: readonly string[], io: CliIo & { streams: ConsoleStreams }): ExitCode {
  const pending: PendingOutput[] = [];
  const program = buildProgram(pending);

  let parseFailure: CommanderError | null = null;
  try {
    program.parse([...argv], { from: 'user' });
  } catch (cause) {
    if (!(cause instanceof CommanderError)) throw cause;
    parseFailure = cause;
  }

  const options = program.opts<GlobalOptions>();
  const choice = resolveConsoleLevel(program, options);

  const logger = createLogger(
    {
      level: choice.kind === 'resolved' ? choice.level : DEFAULT_LOG_LEVEL,
      logFile: options.logFile ?? null,
    },
    { streams: io.streams, openFile: io.openFile, now: io.now, color: io.color },
  );

  try {
    flush(logger, pending);

    // Commander uses exit code 0 for the actions that are their own output —
    // `--help`, `--version` — and 1 for every invocation it refused.
    if (parseFailure !== null) {
      return parseFailure.exitCode === 0 ? ExitCode.Success : ExitCode.Configuration;
    }

    if (choice.kind === 'conflict') {
      logger.error(`${choice.flags.join(' and ')} set the same value — pass at most one`);
      return ExitCode.Configuration;
    }

    const envFile = loadWorkspaceEnv(options.configsDir, { cwd: io.cwd, load: io.loadEnvFile });
    logger.debug(
      envFile.loaded
        ? `loaded environment from ${envFile.path}`
        : `no environment file at ${envFile.path}`,
    );

    logger.error('no command given');
    logger.print(program.helpInformation().trimEnd(), { level: 'error', stream: 'err' });
    return ExitCode.Configuration;
  } finally {
    logger.close();
  }
}

function buildProgram(pending: PendingOutput[]): Command {
  return new Command()
    .name('deploy-pad')
    .description(
      'Repeatable, auditable multi-chain smart-contract deployments from declarative config.',
    )
    .version(
      `deploy-pad ${engineVersion()} (config format ${String(CONFIG_FORMAT_VERSION)})`,
      '--version',
      'Print the engine version and the config format it speaks.',
    )
    .addOption(
      new Option('--log-level <level>', 'Console output threshold.')
        .choices([...LOG_LEVELS])
        .default(DEFAULT_LOG_LEVEL),
    )
    .option('-v, --verbose', 'Sugar for --log-level debug.')
    .option('-q, --quiet', 'Sugar for --log-level error.')
    .option(
      '-l, --log-file <path>',
      'Additionally write structured JSON logs to a file, always at full debug detail.',
    )
    .option('--configs-dir <path>', 'Root of the mounted config set.', DEFAULT_CONFIGS_DIR)
    .helpOption('-h, --help', 'Show this help.')
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => pending.push({ text, level: 'info', stream: 'out' }),
      writeErr: (text) => pending.push({ text, level: 'error', stream: 'err' }),
    });
}

/**
 * `-v`, `-q` and `--log-level` set the same value, so at most one may be given
 * (FR-CLI-004) — and the winner is collapsed here, before any artifact exists,
 * so nothing downstream ever sees three ways to say it.
 */
function resolveConsoleLevel(program: Command, options: GlobalOptions): LevelChoice {
  const explicit = (['logLevel', 'verbose', 'quiet'] as const).filter(
    (name) => program.getOptionValueSource(name) === 'cli',
  );

  if (explicit.length > 1) {
    return { kind: 'conflict', flags: explicit.map((name) => LEVEL_FLAGS[name]) };
  }
  if (options.verbose === true) return { kind: 'resolved', level: 'debug' };
  if (options.quiet === true) return { kind: 'resolved', level: 'error' };
  return { kind: 'resolved', level: options.logLevel };
}

function flush(logger: Logger, pending: readonly PendingOutput[]): void {
  for (const entry of pending) {
    logger.print(entry.text.trimEnd(), { level: entry.level, stream: entry.stream });
  }
}
