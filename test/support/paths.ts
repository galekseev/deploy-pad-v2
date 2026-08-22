import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..', '..');

export function repoPath(...segments: readonly string[]): string {
  return join(REPO_ROOT, ...segments);
}

export { REPO_ROOT };
