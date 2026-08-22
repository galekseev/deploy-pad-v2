/**
 * Generates the `dist/*.schema.json` twin of every authored schema.
 *
 * The engine reads the authored YAML directly, so nothing in the development
 * loop waits on this. The JSON exists for consumers that have no YAML parser —
 * browsers, CDNs, third-party tooling, and the modeline form that points at
 * jsDelivr (stack.md §6).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { SCHEMA_NAMES } from '../src/schema-names.ts';

const packageRoot = join(import.meta.dirname, '..');
const srcDir = join(packageRoot, 'src');
const distDir = join(packageRoot, 'dist');

mkdirSync(distDir, { recursive: true });

for (const name of SCHEMA_NAMES) {
  const source = readFileSync(join(srcDir, `${name}.schema.yaml`), 'utf8');
  const schema: unknown = parse(source);

  if (schema === null || typeof schema !== 'object') {
    throw new Error(`${name}.schema.yaml did not parse to an object`);
  }

  writeFileSync(join(distDir, `${name}.schema.json`), `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
  console.log(`generated dist/${name}.schema.json`);
}
