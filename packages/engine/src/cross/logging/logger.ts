/**
 * The logger: a levelled console and an optional structured file, both fed by
 * one path through the redactor (FR-CLI-004, NFR-003).
 *
 * Written rather than adopted, because the two hard parts are ours either way —
 * the redactor no library implements, and a console that is a CLI *renderer*
 * rather than a log stream (stack.md §7).
 */
import { styleText } from 'node:util';
import { levelPasses, type EmittedLevel, type LogLevel } from './levels.ts';
import { secretRegistry, type SecretRegistry } from './redaction.ts';
import { stringifyPlain, toPlain } from './serialize.ts';
import {
  openFileSink,
  processStreams,
  type ConsoleStreams,
  type FileSink,
  type OutputStream,
} from './streams.ts';

/** The record shape of the structured sink. Evolves additively, like every other machine artifact. */
export const LOG_RECORD_SCHEMA_VERSION = 1;

export interface LogRecord {
  readonly schemaVersion: number;
  readonly timestamp: string;
  readonly level: EmittedLevel;
  /** `render` marks formatted human output — the run header, the summary, a report. */
  readonly kind: 'log' | 'render';
  readonly chain: string | null;
  readonly message: string;
  readonly data: unknown;
}

export interface PrintOptions {
  readonly level?: EmittedLevel;
  readonly stream?: 'out' | 'err';
}

export interface Logger {
  error(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
  /**
   * Formatted human output written verbatim — the run header, the dry-run plan,
   * the preflight report, the end-of-run summary, a command's own help. Level
   * gated like everything else, so `--log-level silent` suppresses it too.
   */
  print(text: string, options?: PrintOptions): void;
  /** A logger that tags its records with a chain, and by default prefixes its console lines. */
  forChain(chain: string, options?: { readonly consolePrefix?: boolean }): Logger;
  /** Closes the structured sink. Safe to call more than once. */
  close(): void;
}

export interface LoggerConfig {
  readonly level: LogLevel;
  /** Always written at full `debug` detail, whatever the console level is. */
  readonly logFile: string | null;
}

/**
 * Seams the tests replace: streams to capture, a clock to freeze, a sink to
 * fake. Each accepts an explicit `undefined` so a caller can forward an option
 * it may not have without branching on it.
 */
export interface LoggerIo {
  readonly streams?: ConsoleStreams | undefined;
  readonly openFile?: ((path: string) => FileSink) | undefined;
  readonly now?: (() => Date) | undefined;
  readonly registry?: SecretRegistry | undefined;
  readonly color?: boolean | undefined;
}

interface Shared {
  readonly config: LoggerConfig;
  readonly streams: ConsoleStreams;
  readonly file: FileSink | null;
  readonly now: () => Date;
  readonly registry: SecretRegistry;
  readonly color: boolean;
}

interface Emission {
  readonly level: EmittedLevel;
  readonly kind: LogRecord['kind'];
  readonly chain: string | null;
  readonly message: string;
  readonly data: unknown;
  readonly target: 'out' | 'err';
}

const LEVEL_TAGS: Record<EmittedLevel, string> = {
  error: 'error: ',
  warn: 'warning: ',
  info: '',
  debug: 'debug: ',
};

/** Only the levels worth colouring; `info` is the CLI's ordinary voice. */
const LEVEL_STYLES: Partial<Record<EmittedLevel, 'red' | 'yellow' | 'dim'>> = {
  error: 'red',
  warn: 'yellow',
  debug: 'dim',
};

export function createLogger(config: LoggerConfig, io: LoggerIo = {}): Logger {
  const streams = io.streams ?? processStreams();
  const shared: Shared = {
    config,
    streams,
    file: config.logFile === null ? null : (io.openFile ?? openFileSink)(config.logFile),
    now: io.now ?? ((): Date => new Date()),
    registry: io.registry ?? secretRegistry,
    color: io.color ?? (streams.out.isTty && process.env['NO_COLOR'] === undefined),
  };

  return makeLogger(shared, null, false);
}

export function nullStream(): OutputStream {
  return { isTty: false, write: (): void => {} };
}

function makeLogger(shared: Shared, chain: string | null, prefixConsole: boolean): Logger {
  function emit(emission: Emission): void {
    writeRecord(shared, emission);
    if (!levelPasses(shared.config.level, emission.level)) return;
    writeConsole(shared, emission, prefixConsole ? chain : null);
  }

  function log(level: EmittedLevel, message: string, data: unknown): void {
    emit({
      level,
      kind: 'log',
      chain,
      message,
      data,
      target: level === 'error' || level === 'warn' ? 'err' : 'out',
    });
  }

  return {
    error: (message, data): void => log('error', message, data),
    warn: (message, data): void => log('warn', message, data),
    info: (message, data): void => log('info', message, data),
    debug: (message, data): void => log('debug', message, data),
    print: (text, options): void =>
      emit({
        level: options?.level ?? 'info',
        kind: 'render',
        chain,
        message: text,
        data: undefined,
        target: options?.stream ?? 'out',
      }),
    forChain: (nextChain, options): Logger =>
      makeLogger(shared, nextChain, options?.consolePrefix ?? true),
    close: (): void => shared.file?.close(),
  };
}

/**
 * The structured sink records everything at full `debug` detail regardless of
 * the console level: the console level filters what a human watches, the file is
 * the complete record.
 */
function writeRecord(shared: Shared, emission: Emission): void {
  if (shared.file === null) return;

  const record: LogRecord = {
    schemaVersion: LOG_RECORD_SCHEMA_VERSION,
    timestamp: shared.now().toISOString(),
    level: emission.level,
    kind: emission.kind,
    chain: emission.chain,
    message: emission.message,
    data: emission.data === undefined ? null : emission.data,
  };

  shared.file.write(stringifyPlain(shared.registry.redactPlain(toPlain(record))));
}

function writeConsole(shared: Shared, emission: Emission, chainPrefix: string | null): void {
  const { level, kind, message, data } = emission;
  const tail = kind === 'log' && level === 'debug' && data !== undefined ? ` ${render(data)}` : '';
  const body = kind === 'render' ? message : `${LEVEL_TAGS[level]}${message}${tail}`;
  const stream = emission.target === 'err' ? shared.streams.err : shared.streams.out;

  stream.write(`${decorate(shared, level, kind, body, chainPrefix)}\n`);
}

function render(data: unknown): string {
  return stringifyPlain(toPlain(data));
}

/**
 * Redaction happens here, on the fully formed line, for the same reason it
 * happens on the fully formed record: one function, both sinks, no call site
 * able to opt out.
 */
function decorate(
  shared: Shared,
  level: EmittedLevel,
  kind: LogRecord['kind'],
  body: string,
  chain: string | null,
): string {
  const format = kind === 'render' || !shared.color ? undefined : LEVEL_STYLES[level];
  const styled = format === undefined ? body : styleText(format, body, { validateStream: false });
  const prefix = chain === null ? '' : `[${chain}] `;

  return shared.registry
    .redactText(`${prefix}${styled}`)
    .split('\n')
    .join(`\n${prefix}`);
}
