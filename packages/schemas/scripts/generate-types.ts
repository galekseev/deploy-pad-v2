/**
 * Generates the raw config types from the authored schemas, into the tracked
 * `types/` directory ([stack.md §6.1](../../../docs/implementation/stack.md#61-where-the-generated-types-live)).
 *
 * Unlike the JSON twin, these are **committed**: a fresh clone must type-check
 * without running a generator, and CI's no-diff check is what catches a schema
 * and its types drifting apart. A stale type cannot change a validation verdict
 * — ajv reads the schema, not the type — so the failure mode is a loud diff
 * rather than a wrong result.
 *
 * One module per schema rather than one combined barrel, because two names are
 * declared in two files each (`ChainConfig` in plans and known-chains,
 * `EncodingTransform` in actions and workflows) and flattening them would make
 * one silently win. The barrel re-exports only the seven root types, whose names
 * come from each schema's own `title` and are unique.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from 'json-schema-to-typescript';
import { parse } from 'yaml';
import { SCHEMA_NAMES, type SchemaName } from '../src/schema-names.ts';

const packageRoot = join(import.meta.dirname, '..');
const srcDir = join(packageRoot, 'src');
const typesDir = join(packageRoot, 'types');

const BANNER = `/**
 * Generated from the authored schema — do not edit.
 *
 * Run \`pnpm --filter @deploy-pad/schemas run build\` to regenerate; CI fails on a
 * diff, which is how a schema and its types are kept from drifting apart.
 */`;

function rootTypeName(schema: Record<string, unknown>, name: SchemaName): string {
  const title = schema['title'];
  if (typeof title !== 'string' || title === '') {
    throw new Error(`${name}.schema.yaml declares no title, so its root type has no name`);
  }
  return title;
}

function readSchema(name: SchemaName): Record<string, unknown> {
  const parsed: unknown = parse(readFileSync(join(srcDir, `${name}.schema.yaml`), 'utf8'));

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name}.schema.yaml did not parse to an object`);
  }
  return parsed as Record<string, unknown>;
}

// Removed wholesale rather than overwritten: a schema deleted from the list
// would otherwise leave its types behind, tracked and wrong.
rmSync(typesDir, { recursive: true, force: true });
mkdirSync(typesDir, { recursive: true });

const roots: { readonly name: SchemaName; readonly type: string }[] = [];

for (const name of SCHEMA_NAMES) {
  const schema = readSchema(name);
  const type = rootTypeName(schema, name);

  const declarations = await compile(schema, type, {
    bannerComment: BANNER,
    // The engine validates with ajv; these types describe a document that has
    // already passed that gate, so an unchecked index signature would only
    // invite reading fields the schema never promised.
    additionalProperties: false,
    enableConstEnums: false,
  });

  writeFileSync(join(typesDir, `${name}.d.ts`), declarations, 'utf8');
  roots.push({ name, type });
  console.log(`generated types/${name}.d.ts (${type})`);
}

const barrel = [
  BANNER,
  '',
  ...roots.map(({ name, type }) => `export type { ${type} } from './${name}.js';`),
  '',
].join('\n');

writeFileSync(join(typesDir, 'index.d.ts'), barrel, 'utf8');
console.log(`generated types/index.d.ts (${roots.length} root types)`);
