/**
 * Gate 1, as pure functions over already-read documents. No file is opened here,
 * which is the point: the version comparison is three cases and a flag, and
 * proving it against literals costs milliseconds.
 */
import { CONFIG_FORMAT_VERSION } from '@deploy-pad/schemas';
import { describe, expect, it } from 'vitest';
import { blocksRun } from '../../src/contracts/index.ts';
import { checkVersion, checkYamlFeatures } from '../../src/phases/phase-2/index.ts';
import type { ConfigDocument } from '../../src/phases/phase-2/index.ts';

function document(data: unknown, forbidden: ConfigDocument['forbidden'] = []): ConfigDocument {
  return { file: 'workflows.yaml', data, forbidden };
}

describe('the config format version gate', () => {
  it('[FR-CFG-013] says nothing when the file declares the version the engine speaks', () => {
    expect(checkVersion(document({ version: CONFIG_FORMAT_VERSION }), false)).toBeNull();
  });

  it('[FR-CFG-013] errors on a mismatch, naming the file and both versions', () => {
    const diagnostic = checkVersion(document({ version: 1 }), false);

    expect(diagnostic?.code).toBe('config.version-mismatch');
    expect(blocksRun(diagnostic!)).toBe(true);
    expect(diagnostic?.message).toContain('workflows.yaml');
    expect(diagnostic?.message).toContain('1');
    expect(diagnostic?.message).toContain(String(CONFIG_FORMAT_VERSION));
  });

  it('[FR-CFG-013] downgrades the mismatch to a warning under --ignore-version', () => {
    const diagnostic = checkVersion(document({ version: 1 }), true);

    expect(diagnostic?.code).toBe('config.version-mismatch');
    expect(blocksRun(diagnostic!)).toBe(false);
  });

  it('[FR-CFG-013] warns on an absent version, because it cannot conclude a mismatch', () => {
    const diagnostic = checkVersion(document({ escrow: {} }), false);

    expect(diagnostic?.code).toBe('config.version-missing');
    expect(blocksRun(diagnostic!)).toBe(false);
  });

  it('[FR-CFG-013] keeps an absent version a warning even under --ignore-version', () => {
    expect(blocksRun(checkVersion(document({ escrow: {} }), true)!)).toBe(false);
  });

  it('[FR-CFG-014] compares exactly, so a newer format is a mismatch like an older one', () => {
    const older = checkVersion(document({ version: CONFIG_FORMAT_VERSION - 1 }), false);
    const newer = checkVersion(document({ version: CONFIG_FORMAT_VERSION + 1 }), false);

    expect(older?.code).toBe('config.version-mismatch');
    expect(newer?.code).toBe('config.version-mismatch');
  });

  it('[FR-CFG-014] treats a version that is not an integer as a mismatch, not as absent', () => {
    const diagnostic = checkVersion(document({ version: '2' }), false);

    expect(diagnostic?.code).toBe('config.version-mismatch');
    // Quoted in the message, so "2" and 2 are distinguishable to a reader
    // staring at a file that looks right.
    expect(diagnostic?.message).toContain('"2"');
  });
});

describe('the YAML features v2 configs may not use', () => {
  it('[FR-CFG-011] rejects an anchor', () => {
    const [diagnostic] = checkYamlFeatures(document({}, [{ feature: 'anchor', name: 'base' }]));

    expect(diagnostic?.code).toBe('config.yaml-feature-forbidden');
    expect(diagnostic?.message).toContain('anchor');
    expect(diagnostic?.message).toContain('base');
  });

  it('[FR-CFG-011] rejects an alias', () => {
    const [diagnostic] = checkYamlFeatures(document({}, [{ feature: 'alias', name: 'base' }]));

    expect(diagnostic?.message).toContain('alias');
  });

  it('[FR-CFG-011] rejects the merge key', () => {
    const [diagnostic] = checkYamlFeatures(document({}, [{ feature: 'merge-key', name: '<<' }]));

    expect(diagnostic?.message).toContain('merge key');
  });

  it('[FR-CFG-011] points at ${...} references as the reuse mechanism that does exist', () => {
    const [diagnostic] = checkYamlFeatures(document({}, [{ feature: 'anchor', name: 'base' }]));

    expect(diagnostic?.message).toContain('${...}');
  });

  it('[FR-CFG-011] says nothing about a document that uses none of them', () => {
    expect(checkYamlFeatures(document({ version: 2 }))).toEqual([]);
  });
});
