/**
 * Gate 2 — shape, required fields and enum values, per file, against the file's
 * own `.schema.yaml`.
 *
 * The gate exists so that every later gate can assume well-formed structure and
 * spend its errors on *semantic* problems. `allErrors` is on because an author
 * fixing one shape error at a time is an author running `validate` six times
 * (NFR-022) — and [reduce-errors.ts](reduce-errors.ts) is what keeps "all errors"
 * from meaning "all of ajv's guesses".
 *
 * The engine reads the **authored YAML**, not the generated JSON twin: editing a
 * schema is then immediately visible to the engine and its tests, with no build
 * in between ([stack.md §6](../../../../../docs/implementation/stack.md#6-the-schemas-package)).
 */
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import type { ErrorObject, ValidateFunction } from 'ajv';
import type { SchemaName } from '@deploy-pad/schemas';
import { diagnosticError, type Diagnostic } from '../../contracts/index.ts';
import { reduceSchemaErrors } from './reduce-errors.ts';
import type { ConfigDocument } from './source.ts';

export type { SchemaName };

/**
 * Three of ajv's strict-mode rules are switched off, and only those three. They
 * are ajv's own house style rather than Draft 2020-12 requirements, and each
 * rejects something the schemas do deliberately: `strictRequired` a `required`
 * inside a `not`/`then` branch, `allowMatchingProperties` a named slot
 * (`privateKey`) that also matches the generic slot pattern, `strictTypes` a
 * subschema that constrains properties without restating `type: object`.
 *
 * The rest of strict mode stays on, because it is what catches a misspelled
 * keyword in our own schemas — a `properites:` that would otherwise validate
 * nothing and be noticed by no one.
 */
function createValidator(): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTypes: false,
    allowMatchingProperties: true,
  });

  // `ajv-formats` is CommonJS, so under `verbatimModuleSyntax` the callable is
  // the interop default rather than the namespace the import binds.
  addFormats.default(ajv);
  return ajv;
}

export interface SchemaRegistry {
  validate(name: SchemaName, document: ConfigDocument): readonly Diagnostic[];
}

/**
 * Compilation is the expensive part and the schemas never change within a run,
 * so each is compiled once, on first use. A `validate` over a mount touches five
 * of the seven; compiling all of them eagerly would be work for the two it does
 * not.
 */
export function schemaRegistry(io: { readonly read?: (name: SchemaName) => string } = {}): SchemaRegistry {
  const ajv = createValidator();
  const compiled = new Map<SchemaName, ValidateFunction>();
  const read = io.read ?? readAuthoredSchema;

  function validator(name: SchemaName): ValidateFunction {
    const existing = compiled.get(name);
    if (existing !== undefined) return existing;

    const built = ajv.compile(parse(read(name)) as object);
    compiled.set(name, built);
    return built;
  }

  return {
    validate: (name, document): readonly Diagnostic[] => {
      const validate = validator(name);
      if (validate(document.data)) return [];

      return reduceSchemaErrors(validate.errors ?? []).map((error) =>
        toDiagnostic(error, document),
      );
    },
  };
}

function readAuthoredSchema(name: SchemaName): string {
  // Through the package's own `exports` map, which resolves `.yaml` subpaths to
  // the authored files in both the local and the published form — so this is the
  // same read from a workspace symlink and from an installed tarball.
  const specifier = `@deploy-pad/schemas/${name}.schema.yaml`;
  return readFileSync(new URL(import.meta.resolve(specifier)), 'utf8');
}

/**
 * ajv's `instancePath` is already an RFC 6901 JSON Pointer, which is exactly what
 * a diagnostic's location wants: the offending node named rather than a line
 * guessed.
 */
function toDiagnostic(error: ErrorObject, document: ConfigDocument): Diagnostic {
  return diagnosticError({
    code: 'config.schema-violation',
    phase: 2,
    location: { file: document.file, pointer: error.instancePath === '' ? '/' : error.instancePath },
    requirement: 'FR-CFG-012',
    message: describe(error),
  });
}

function describe(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;

  switch (error.keyword) {
    case 'enum': {
      const allowed = params['allowedValues'];
      return Array.isArray(allowed)
        ? `must be one of ${allowed.map((value) => String(value)).join(', ')}`
        : (error.message ?? 'is not an allowed value');
    }
    case 'required':
      return `is missing the required property ${JSON.stringify(String(params['missingProperty']))}`;
    case 'additionalProperties':
      return `has an unknown property ${JSON.stringify(String(params['additionalProperty']))}`;
    case 'pattern':
      return `must match ${String(params['pattern'])}`;
    default:
      return error.message ?? `failed the ${error.keyword} rule`;
  }
}
