/**
 * The ajv error reducer — driven through real ajv output rather than hand-written
 * `ErrorObject` literals, because the thing being tested is a reaction to what
 * ajv actually emits, and a literal would encode my belief about that rather than
 * the fact.
 *
 * The numbers in these titles are the point. `allErrors` plus a schema built from
 * `oneOf` turns one typo into eight errors, and an author handed eight errors for
 * one typo learns to stop reading them.
 */
import { describe, expect, it } from 'vitest';
import { schemaRegistry, type ConfigDocument } from '../../src/phases/phase-2/index.ts';

const registry = schemaRegistry();

function document(data: unknown): ConfigDocument {
  return { file: 'workflows.yaml', data, forbidden: [] };
}

function pointers(data: unknown): readonly string[] {
  return registry
    .validate('workflows', document(data))
    .map((diagnostic) => diagnostic.location.pointer ?? '');
}

const step = (extra: object): object => ({ action: 'aqua.v1.escrow-factory', ...extra });

describe('reducing ajv output to the mistake an author made', () => {
  it('[NFR-022] reports one bad enum once, not once per rejected branch', () => {
    const diagnostics = registry.validate(
      'workflows',
      document({ version: 2, escrow: { steps: [step({ method: 'create9' })] } }),
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.location.pointer).toBe('/escrow/steps/0/method');
    expect(diagnostics[0]?.message).toBe('must be one of create, create2, create3');
  });

  it('[NFR-022] keeps independent mistakes apart rather than collapsing to one', () => {
    expect(
      pointers({
        version: 2,
        one: { steps: [step({ method: 'nope' })] },
        two: { steps: [step({ method: 'alsonope' })] },
      }),
    ).toEqual(['/one/steps/0/method', '/two/steps/0/method']);
  });

  it('[NFR-022] passes through an error that sits under no combinator at all', () => {
    expect(pointers({ version: 'two', escrow: { steps: [step({})] } })).toEqual(['/version']);
  });

  it('[NFR-022] keeps every alternative when the choice itself is what failed', () => {
    // A step that is neither an action step nor a workflow step: both required
    // properties are missing at the same depth, and naming only one of them
    // would send the author to fix half a problem.
    const messages = registry
      .validate('workflows', document({ version: 2, escrow: { steps: [{}] } }))
      .map((diagnostic) => diagnostic.message);

    expect(messages).toEqual([
      'is missing the required property "action"',
      'is missing the required property "workflow"',
    ]);
  });

  it('[NFR-022] reports nothing at all for a document that is right', () => {
    expect(
      pointers({
        version: 2,
        escrow: { steps: [step({ method: 'create3', factory: 'createx' })] },
      }),
    ).toEqual([]);
  });

  it('[FR-CFG-012] locates every error with a JSON Pointer into the offending node', () => {
    const [diagnostic] = registry.validate(
      'workflows',
      document({ version: 2, escrow: { steps: [step({ method: 'create9' })] } }),
    );

    expect(diagnostic?.location.file).toBe('workflows.yaml');
    expect(diagnostic?.location.pointer).toBe('/escrow/steps/0/method');
    expect(diagnostic?.requirement).toBe('FR-CFG-012');
  });
});
