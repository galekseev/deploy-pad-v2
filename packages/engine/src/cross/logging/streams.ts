/**
 * The only module in the engine that touches a process stream or a file
 * descriptor. Everything else goes through the logger, which is what makes the
 * redaction guarantee a property of the sink rather than a habit at the call
 * site (NFR-003, enforced by the eslint rule in `eslint.config.js`).
 */
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

export interface OutputStream {
  write(text: string): void;
  readonly isTty: boolean;
}

export interface ConsoleStreams {
  readonly out: OutputStream;
  readonly err: OutputStream;
}

export interface FileSink {
  write(line: string): void;
  close(): void;
}

/**
 * A console piped into something that closes early (`| head`) raises `EPIPE`.
 * There is nowhere left to report it, so it ends the output rather than the run.
 */
function isBrokenPipe(cause: unknown): boolean {
  return cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === 'EPIPE';
}

function wrapProcessStream(stream: NodeJS.WriteStream): OutputStream {
  let broken = false;

  // Without a listener Node turns the stream's EPIPE into an unhandled error
  // event, which would take the process down with the wrong exit code.
  stream.on('error', (cause: unknown) => {
    if (isBrokenPipe(cause)) broken = true;
  });

  return {
    isTty: stream.isTTY === true,
    write(text: string): void {
      if (broken) return;
      try {
        stream.write(text);
      } catch (cause) {
        if (!isBrokenPipe(cause)) throw cause;
        broken = true;
      }
    },
  };
}

export function processStreams(): ConsoleStreams {
  return {
    out: wrapProcessStream(process.stdout),
    err: wrapProcessStream(process.stderr),
  };
}

/**
 * The structured sink. Writes go straight to a file descriptor, synchronously:
 * an asynchronous write stream loses the tail of the log when the process ends,
 * and at this volume a synchronous write is simpler than any flush protocol.
 *
 * Truncating rather than appending, matching `summary.json` — each invocation's
 * log describes that invocation ([results.md](../../../../../docs/specs/results.md#summaryjson--the-machine-readable-summary)).
 */
export function openFileSink(path: string): FileSink {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, 'w');
  let open = true;

  return {
    write(line: string): void {
      if (!open) return;
      writeSync(fd, `${line}\n`);
    },
    close(): void {
      if (!open) return;
      open = false;
      closeSync(fd);
    },
  };
}
