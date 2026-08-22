import type { ConsoleStreams, FileSink, OutputStream } from '../../src/cross/logging/index.ts';

export interface Captured {
  readonly streams: ConsoleStreams;
  readonly openFile: (path: string) => FileSink;
  readonly now: () => Date;
  out(): string;
  err(): string;
  /** The structured sink's lines, parsed. */
  records(): unknown[];
  logFilePath(): string | null;
}

/**
 * Everything a test needs to watch both sinks: captured streams, a fake file
 * sink, and a frozen clock so a record is comparable line for line.
 */
export function capture(): Captured {
  const chunks = { out: [] as string[], err: [] as string[] };
  const lines: string[] = [];
  let path: string | null = null;

  const stream = (into: string[]): OutputStream => ({
    isTty: false,
    write: (text: string): void => {
      into.push(text);
    },
  });

  return {
    streams: { out: stream(chunks.out), err: stream(chunks.err) },
    openFile: (target: string): FileSink => {
      path = target;
      return {
        write: (line: string): void => {
          lines.push(line);
        },
        close: (): void => {},
      };
    },
    now: (): Date => new Date('2026-01-01T00:00:00.000Z'),
    out: (): string => chunks.out.join(''),
    err: (): string => chunks.err.join(''),
    records: (): unknown[] => lines.map((line): unknown => JSON.parse(line)),
    logFilePath: (): string | null => path,
  };
}
