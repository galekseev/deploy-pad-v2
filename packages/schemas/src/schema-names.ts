/**
 * The config files the contract covers, one authored `<name>.schema.yaml` each.
 *
 * Ordered as the doc set lists them, and exhaustive: the generator, the editor
 * settings and the modeline contract test all read this list, so a new config
 * file is added here once.
 */
export const SCHEMA_NAMES = [
  'actions',
  'workflows',
  'plans',
  'known-chains',
  'global-params',
  'multisig',
  'engine',
] as const;

export type SchemaName = (typeof SCHEMA_NAMES)[number];

export function isSchemaName(value: string): value is SchemaName {
  return (SCHEMA_NAMES as readonly string[]).includes(value);
}
