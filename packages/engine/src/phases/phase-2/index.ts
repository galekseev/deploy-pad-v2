/**
 * Phase 2 — config load and validation.
 *
 * Only the reading half exists so far: the config source that produces the parsed
 * object graph. The four gates — version, schema, referential, value resolution —
 * arrive with S2 and sit in front of the same interface.
 */
export {
  MOUNT_FILES,
  directoryConfigSource,
  type ConfigDocument,
  type ConfigSource,
  type MountFile,
  type Read,
} from './source.ts';
