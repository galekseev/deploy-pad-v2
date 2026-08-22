import { describe, expect, it } from 'vitest';
import {
  LOG_RECORD_SCHEMA_VERSION,
  SecretRegistry,
  createLogger,
  type LogLevel,
} from '../../src/cross/logging/index.ts';
import { capture } from '../support/capture.ts';

function loggerAt(level: LogLevel, logFile: string | null = null) {
  const captured = capture();
  const logger = createLogger(
    { level, logFile },
    { streams: captured.streams, openFile: captured.openFile, now: captured.now, color: false },
  );
  return { captured, logger };
}

describe('the levelled console', () => {
  it('[FR-CLI-004] prints nothing at all at silent', () => {
    const { captured, logger } = loggerAt('silent');

    logger.error('an error');
    logger.warn('a warning');
    logger.info('an info line');
    logger.debug('a debug line');
    logger.print('the end-of-run summary');

    expect(captured.out()).toBe('');
    expect(captured.err()).toBe('');
  });

  it('[FR-CLI-004] prints errors only at error', () => {
    const { captured, logger } = loggerAt('error');

    logger.error('an error');
    logger.warn('a warning');
    logger.info('an info line');

    expect(captured.err()).toBe('error: an error\n');
    expect(captured.out()).toBe('');
  });

  it('[FR-CLI-004] adds warnings at warn', () => {
    const { captured, logger } = loggerAt('warn');

    logger.warn('a warning');
    logger.info('an info line');

    expect(captured.err()).toBe('warning: a warning\n');
    expect(captured.out()).toBe('');
  });

  it('[FR-CLI-004] adds ordinary output at info, still holding debug back', () => {
    const { captured, logger } = loggerAt('info');

    logger.info('an info line');
    logger.debug('a debug line');

    expect(captured.out()).toBe('an info line\n');
  });

  it('[FR-CLI-004] adds per-phase detail and resolved values at debug', () => {
    const { captured, logger } = loggerAt('debug');

    logger.debug('resolved a value', { chain: 'mainnet' });

    expect(captured.out()).toBe('debug: resolved a value {"chain":"mainnet"}\n');
  });

  it('sends errors and warnings to stderr, ordinary output to stdout', () => {
    const { captured, logger } = loggerAt('debug');

    logger.error('e');
    logger.warn('w');
    logger.info('i');
    logger.debug('d');

    expect(captured.err()).toBe('error: e\nwarning: w\n');
    expect(captured.out()).toBe('i\ndebug: d\n');
  });

  it('[FR-CLI-004] suppresses rendered output too, since silent prints nothing at all', () => {
    const rendered = loggerAt('info');
    rendered.logger.print('Run header\n  chains: mainnet, base');
    expect(rendered.captured.out()).toBe('Run header\n  chains: mainnet, base\n');

    const silent = loggerAt('silent');
    silent.logger.print('Run header');
    expect(silent.captured.out()).toBe('');
  });

  // FR-RUN-014 turns these on in parallel chain mode, and is claimed by the
  // slice that delivers the mode. What is tested here is the mechanism.
  it('prefixes every console line of a chain-scoped logger', () => {
    const { captured, logger } = loggerAt('info');

    logger.forChain('mainnet').info('deploying\nstep 1 of 2');

    expect(captured.out()).toBe('[mainnet] deploying\n[mainnet] step 1 of 2\n');
  });

  it('can tag records with a chain without prefixing the console', () => {
    const { captured, logger } = loggerAt('info', 'run.json');

    logger.forChain('base', { consolePrefix: false }).info('deploying');

    expect(captured.out()).toBe('deploying\n');
    expect(captured.records()).toEqual([
      expect.objectContaining({ chain: 'base', message: 'deploying' }),
    ]);
  });
});

describe('the structured sink', () => {
  it('[FR-CLI-004] records at full debug detail regardless of the console level', () => {
    const { captured, logger } = loggerAt('silent', 'run.json');

    logger.info('an info line');
    logger.debug('a debug line', { resolved: 42 });

    expect(captured.out()).toBe('');
    expect(captured.records()).toEqual([
      {
        schemaVersion: LOG_RECORD_SCHEMA_VERSION,
        timestamp: '2026-01-01T00:00:00.000Z',
        level: 'info',
        kind: 'log',
        chain: null,
        message: 'an info line',
        data: null,
      },
      {
        schemaVersion: LOG_RECORD_SCHEMA_VERSION,
        timestamp: '2026-01-01T00:00:00.000Z',
        level: 'debug',
        kind: 'log',
        chain: null,
        message: 'a debug line',
        data: { resolved: 42 },
      },
    ]);
  });

  it('marks formatted human output so a reader can tell it from a log line', () => {
    const { captured, logger } = loggerAt('info', 'run.json');

    logger.print('Summary');

    expect(captured.records()).toEqual([expect.objectContaining({ kind: 'render' })]);
  });

  it('writes a record JSON.stringify would otherwise throw on', () => {
    const { captured, logger } = loggerAt('info', 'run.json');
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    expect(() => {
      logger.info('a provider', circular);
    }).not.toThrow();
    expect(captured.records()).toEqual([
      expect.objectContaining({ data: { self: '[circular]' } }),
    ]);
  });

  it('opens no file when none was asked for', () => {
    const { captured, logger } = loggerAt('debug');

    logger.info('an info line');

    expect(captured.logFilePath()).toBeNull();
  });
});

describe('redaction as a property of the sink', () => {
  it('[NFR-003] redacts a registered value on both sinks, at every level', () => {
    for (const level of ['error', 'warn', 'info', 'debug'] as const) {
      const captured = capture();
      const registry = new SecretRegistry();
      registry.register('canary-secret', '[vault.canary]');

      const logger = createLogger(
        { level, logFile: 'run.json' },
        {
          streams: captured.streams,
          openFile: captured.openFile,
          now: captured.now,
          registry,
          color: false,
        },
      );

      logger[level]('using canary-secret to sign', { url: 'https://host/canary-secret' });
      logger.print('summary: canary-secret', { level });

      const everything = `${captured.out()}${captured.err()}${JSON.stringify(captured.records())}`;
      expect(everything, `at --log-level ${level}`).not.toContain('canary-secret');
      expect(everything).toContain('[vault.canary]');
    }
  });

  it('[NFR-003] redacts a value the call site never mentioned, because the sink does it', () => {
    const captured = capture();
    const registry = new SecretRegistry();
    const logger = createLogger(
      { level: 'info', logFile: null },
      { streams: captured.streams, openFile: captured.openFile, registry, color: false },
    );

    // Registration happens after the logger exists — the load layer resolves a
    // secret mid-run, and every later line has to honour it.
    registry.register('late-secret', '[vault.late]');
    logger.info('rpc url https://host/late-secret');

    expect(captured.out()).toBe('rpc url https://host/[vault.late]\n');
  });
});
