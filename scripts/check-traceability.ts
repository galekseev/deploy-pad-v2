/**
 * Ties the test suite back to the requirement catalog.
 *
 * The project did not have to invent a definition of "correct" — there are ~250
 * numbered requirements already. So coverage is measured against the
 * specification rather than against lines of code, and a requirement no test
 * names is either not yet delivered or a gap. This script makes the difference
 * visible instead of leaving it to memory (test-strategy.md → Traceability).
 *
 * Fails on:
 *   - a slice claiming a requirement no test names, and
 *   - an id in a test title or a claim that is in no catalog — a typo.
 *
 * Reports, without failing: what is delivered, what no slice has claimed yet
 * (expected to be large for a long time), and any id a test names that no slice
 * claims.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { styleText } from 'node:util';
import { parse } from 'yaml';

const REPO_ROOT = join(import.meta.dirname, '..');

const CATALOG = join(REPO_ROOT, 'docs/requirements.md');
const SLICES = join(REPO_ROOT, 'test/traceability/slices.yaml');
const TEST_ROOTS = [join(REPO_ROOT, 'test'), join(REPO_ROOT, 'packages')];

/** How a requirement is declared in the catalog: `- **FR-CLI-003.** …`. */
const DECLARATION = /\*\*(?<id>FR-[A-Z]{3}-\d{3}[a-z]?|NFR-\d{3})\.\*\*/gu;
/** How a test names one: `it('[FR-CLI-003] sources the .env', …)`. */
const CITATION = /\[(?<id>FR-[A-Z]{3}-\d{3}[a-z]?|NFR-\d{3})\]/gu;

interface Slice {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly requirements: readonly string[];
}

function catalogIds(): Set<string> {
  const source = readFileSync(CATALOG, 'utf8');
  return new Set([...source.matchAll(DECLARATION)].map((match) => match.groups?.['id'] as string));
}

function testFiles(): string[] {
  return TEST_ROOTS.flatMap((root) =>
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.test.ts'))
      .map((entry) => resolve(entry.parentPath, entry.name)),
  );
}

/** Every id named in a test title, and where. */
function citations(): Map<string, string[]> {
  const found = new Map<string, string[]>();

  for (const file of testFiles()) {
    for (const match of readFileSync(file, 'utf8').matchAll(CITATION)) {
      const id = match.groups?.['id'] as string;
      const where = found.get(id) ?? [];
      where.push(relative(REPO_ROOT, file));
      found.set(id, where);
    }
  }

  return found;
}

function slices(): readonly Slice[] {
  const document: unknown = parse(readFileSync(SLICES, 'utf8'));
  if (document === null || typeof document !== 'object' || !('slices' in document)) {
    throw new Error(`${relative(REPO_ROOT, SLICES)} has no top-level "slices" key`);
  }
  return document.slices as readonly Slice[];
}

function sorted(ids: Iterable<string>): string[] {
  return [...ids].sort((left, right) => left.localeCompare(right));
}

const catalog = catalogIds();
const covered = citations();
const claimed = new Map<string, string>();

for (const slice of slices()) {
  for (const id of slice.requirements) claimed.set(id, slice.id);
}

const claimedUncovered = sorted([...claimed.keys()].filter((id) => !covered.has(id)));
const coveredUnclaimed = sorted([...covered.keys()].filter((id) => !claimed.has(id)));
const notYetClaimed = sorted([...catalog].filter((id) => !claimed.has(id)));
const unknown = sorted(
  [...new Set([...covered.keys(), ...claimed.keys()])].filter((id) => !catalog.has(id)),
);

console.log(`Requirement catalog:  ${String(catalog.size)} ids`);
for (const slice of slices()) {
  console.log(
    `  ${slice.id} ${slice.title} (${slice.status}): ${String(slice.requirements.length)} claimed`,
  );
}
console.log(
  `Claimed: ${String(claimed.size)}   named by a test: ${String(covered.size)}   not yet claimed: ${String(notYetClaimed.length)}`,
);

if (coveredUnclaimed.length > 0) {
  console.log(`\nNamed by a test but claimed by no slice (${String(coveredUnclaimed.length)}):`);
  for (const id of coveredUnclaimed) {
    console.log(`  ${id} — ${[...new Set(covered.get(id))].join(', ')}`);
  }
}

console.log(`\nNot yet claimed by any slice (${String(notYetClaimed.length)}):`);
console.log(`  ${notYetClaimed.join(' ')}`);

let failed = false;

if (claimedUncovered.length > 0) {
  failed = true;
  console.log(styleText('red', `\nClaimed but no test names it (${String(claimedUncovered.length)}):`));
  for (const id of claimedUncovered) {
    console.log(`  ${id} — claimed by ${claimed.get(id) ?? '?'}`);
  }
}

if (unknown.length > 0) {
  failed = true;
  console.log(styleText('red', `\nUnknown ids — in no catalog, so probably a typo (${String(unknown.length)}):`));
  for (const id of unknown) {
    console.log(`  ${id}`);
  }
}

if (failed) {
  console.log(styleText('red', '\nTraceability check failed.'));
  process.exitCode = 1;
} else {
  console.log(styleText('green', '\nTraceability check passed.'));
}
