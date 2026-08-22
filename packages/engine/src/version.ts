import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let cached: string | null = null;

/**
 * The engine's own version, read from the manifest at runtime.
 *
 * A `package.json` import would be neater but sits above `rootDir`, so `tsc`
 * refuses to emit it. The path holds either way: `src/` in development, `dist/`
 * once published, both one level below the package root.
 */
export function engineVersion(): string {
  if (cached !== null) return cached;

  const manifest: unknown = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
  );

  if (manifest === null || typeof manifest !== 'object' || !('version' in manifest)) {
    throw new Error('engine package.json carries no version');
  }

  cached = String(manifest.version);
  return cached;
}
