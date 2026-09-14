/**
 * Every worked example validates against its schema.
 *
 * The specs point authors at `docs/specs/examples/` and the schemas are what the
 * engine enforces, so the two disagreeing is the failure nobody notices: the
 * example keeps demonstrating a shape the engine rejects, and the author who
 * copied it is the one who finds out. This is the first test in the repository
 * that would catch it ([test-strategy.md → Contract](../../docs/implementation/test-strategy.md)).
 *
 * It runs through the engine's own registry rather than a test-local ajv, so an
 * example passes here exactly when it would pass a real `validate`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { isSchemaName, type SchemaName } from '@deploy-pad/schemas';
import { schemaRegistry } from '../../packages/engine/src/phases/phase-2/index.ts';
import { repoPath } from '../support/paths.ts';

const EXAMPLE_DIR = repoPath('docs/specs/examples');

/**
 * The file name is the schema name, except where one schema has several worked
 * examples — a plan and a single-action plan are both `plans`.
 */
function schemaFor(file: string): SchemaName {
  const stem = basename(file, '.yml');
  if (isSchemaName(stem)) return stem;
  if (stem.startsWith('plan')) return 'plans';

  throw new Error(`${file} maps to no schema — name it after one, or teach this test the mapping`);
}

const registry = schemaRegistry();
const examples = readdirSync(EXAMPLE_DIR).filter((name) => name.endsWith('.yml'));

describe('every worked example', () => {
  it('finds examples to check', () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  for (const name of examples) {
    it(`[FR-CFG-012] ${name} validates against its schema`, () => {
      const data: unknown = parse(readFileSync(resolve(EXAMPLE_DIR, name), 'utf8'));
      const diagnostics = registry.validate(schemaFor(name), { file: name, data, forbidden: [] });

      expect(
        diagnostics.map((diagnostic) => `${diagnostic.location.pointer ?? ''} ${diagnostic.message}`),
      ).toEqual([]);
    });
  }
});
