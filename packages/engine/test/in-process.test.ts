/**
 * A command run in-process, from the invocation parameters alone.
 *
 * NFR-060's other half: every command must be invocable **without argv, without
 * terminating the process, and without writing to a real console or file system**.
 * So this file never calls `runCli`. It builds a context, builds a logger over
 * captured streams and a fake sink, supplies the config graph in memory, and reads
 * the exit code off the return value.
 *
 * What it is really proving is that the command line is a *producer* of the run
 * context rather than a prerequisite of the run
 * ([phase 1 → The programmatic boundary](../../../docs/architecture/phase-1-invocation.md#the-run-context-is-the-programmatic-boundary)).
 */
import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/commands/index.ts';
import { ExitCode, type ListContext } from '../src/contracts/index.ts';
import { createLogger } from '../src/cross/logging/index.ts';
import { listContext } from '../src/phases/phase-1/index.ts';
import type { ConfigDocument, ConfigSource, MountFile, Read } from '../src/phases/phase-2/index.ts';
import { capture, type Captured } from './support/capture.ts';

/**
 * The config source a caller with no mounted directory would supply. Its documents
 * were never files, so each reports a `null` location — which the diagnostic model
 * already tolerates.
 */
function inMemorySource(graph: Partial<Record<MountFile, unknown>> & { plans?: unknown[] }): ConfigSource {
  const document = (data: unknown): ConfigDocument => ({ file: null, data });

  return {
    origin: '(in memory)',
    read: (name: MountFile): Read<ConfigDocument> =>
      name in graph ? { kind: 'found', value: document(graph[name]) } : { kind: 'missing' },
    plans: (): Read<readonly ConfigDocument[]> =>
      graph.plans === undefined
        ? { kind: 'missing' }
        : { kind: 'found', value: graph.plans.map(document) },
  };
}

const GRAPH = {
  workflows: {
    version: 2,
    escrow: { steps: [{ action: 'aqua.v1.escrow-factory' }] },
    'escrow-plain': { variantOf: 'escrow', methods: { '*': 'create' } },
  },
  actions: {
    version: 2,
    aqua: {
      generations: {
        v1: { actions: { 'escrow-factory': { type: 'forge-contract', alias: 'aqua-escrow' } } },
      },
    },
  },
  plans: [{ version: 2, workflow: 'escrow', presets: { prod: {} } }],
};

function context(): ListContext {
  const result = listContext({});
  if (!result.ok) throw new Error('a bare list context should not be refused');
  return result.context;
}

function drive(source: ConfigSource): { readonly exit: ExitCode; readonly captured: Captured } {
  const captured = capture();
  const logger = createLogger(
    { level: 'info', logFile: 'run.json' },
    {
      streams: captured.streams,
      openFile: captured.openFile,
      now: captured.now,
      color: false,
    },
  );

  const exit = dispatch(context(), { logger, source });
  logger.close();

  return { exit, captured };
}

describe('a command driven from a hand-built run context', () => {
  it('[NFR-060] returns an exit code rather than terminating the process', () => {
    const { exit } = drive(inMemorySource(GRAPH));

    expect(exit).toBe(ExitCode.Success);
  });

  it('[NFR-060] renders to the injected streams, never to a real console', () => {
    const { captured } = drive(inMemorySource(GRAPH));

    expect(captured.out()).toContain('escrow-plain');
    expect(captured.out()).toContain('variant of escrow');
    expect(captured.err()).toBe('');
  });

  it('[NFR-060] writes its structured record to the injected sink, never to a real file', () => {
    const { captured } = drive(inMemorySource(GRAPH));

    expect(captured.logFilePath()).toBe('run.json');
    expect(captured.records()).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'render' })]),
    );
  });

  it('[NFR-060] reads the config graph the caller supplied, with no directory mounted', () => {
    const { captured } = drive(inMemorySource(GRAPH));

    // The origin the source named, rather than the context's `configsDir` default.
    expect(captured.out()).toContain('(in memory)');
    expect(captured.out()).toContain('aqua.v1.escrow-factory');
  });

  it('[NFR-060] reports a failure the same way, by exit code and nothing else', () => {
    const { exit, captured } = drive(inMemorySource({}));

    expect(exit).toBe(ExitCode.Configuration);
    expect(captured.err()).toContain('no config set to list under (in memory)');
    expect(captured.out()).toBe('');
  });
});
