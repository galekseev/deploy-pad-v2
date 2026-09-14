/**
 * Phase 2 — config load and validation.
 *
 * Two of the four gates exist: the format version (gate 1) and the schema
 * (gate 2), plus the YAML-feature rule that only the parser can see. Referential
 * validation and the ten-step value resolution arrive with S3, behind the same
 * `loadConfigSet` call.
 */
export {
  configSetFor,
  hasErrors,
  loadConfigSet,
  type LoadedConfigSet,
  type LoadRequest,
  type ReportingMode,
  type Want,
} from './load.ts';

export { reduceSchemaErrors } from './reduce-errors.ts';

export {
  schemaRegistry,
  type SchemaName,
  type SchemaRegistry,
} from './schema.ts';

export {
  MOUNT_FILES,
  directoryConfigSource,
  type ConfigDocument,
  type ConfigSource,
  type ForbiddenYamlFeature,
  type MountFile,
  type Read,
} from './source.ts';

export { VERSION_KEY, checkVersion, checkYamlFeatures } from './version.ts';
