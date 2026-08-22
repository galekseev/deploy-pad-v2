/**
 * The versioning invariants of the release, checked rather than remembered.
 *
 *   1. The schemas package's major equals the config format version, which is
 *      what makes TC-4 — one supported format at a time — a packaging property
 *      (stack.md §6).
 *   2. Both packages share that major and are released together (stack.md §8).
 *
 * Cheap enough to run in the static CI job, and it fails at the moment a
 * version is bumped in one place only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { styleText } from 'node:util';
import { CONFIG_FORMAT_VERSION } from '@deploy-pad/schemas';

const REPO_ROOT = join(import.meta.dirname, '..');
const PACKAGES = ['schemas', 'engine'] as const;

function version(packageDir: string): string {
  const manifest: unknown = JSON.parse(
    readFileSync(join(REPO_ROOT, 'packages', packageDir, 'package.json'), 'utf8'),
  );
  if (manifest === null || typeof manifest !== 'object' || !('version' in manifest)) {
    throw new Error(`packages/${packageDir}/package.json carries no version`);
  }
  return String(manifest.version);
}

function major(semver: string): number {
  return Number(semver.split('.')[0]);
}

const failures: string[] = [];
const versions = new Map(PACKAGES.map((name) => [name, version(name)]));

for (const [name, declared] of versions) {
  console.log(`@deploy-pad/${name}  ${declared}`);
}
console.log(`config format         ${String(CONFIG_FORMAT_VERSION)}`);

const schemasVersion = versions.get('schemas') as string;
if (major(schemasVersion) !== CONFIG_FORMAT_VERSION) {
  failures.push(
    `@deploy-pad/schemas is ${schemasVersion}, so its major is ${String(major(schemasVersion))}, but the config format version is ${String(CONFIG_FORMAT_VERSION)}. The two are the same number by design.`,
  );
}

for (const [name, declared] of versions) {
  if (major(declared) !== major(schemasVersion)) {
    failures.push(
      `@deploy-pad/${name} is ${declared} but @deploy-pad/schemas is ${schemasVersion}; the packages share a major and are released together.`,
    );
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.log(styleText('red', `\n${failure}`));
  process.exitCode = 1;
} else {
  console.log(styleText('green', '\nVersion check passed.'));
}
