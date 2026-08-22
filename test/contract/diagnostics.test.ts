/**
 * Enumerating the known warnings is what makes "warnings never block" testable
 * per code rather than in the aggregate (artifacts.md §8).
 *
 * The requirements behind it — FR-RUN-009 for warnings never stopping a run,
 * NFR-022 for `validate` reporting every collected error — are claimed by the
 * slices that deliver a run and a validation gate. What is tested here is the
 * mechanism those slices will use.
 */
import { describe, expect, it } from 'vitest';
import {
  NO_LOCATION,
  WARNING_CODES,
  blocksRun,
  diagnosticError,
  diagnosticWarning,
} from '../../packages/engine/src/contracts/index.ts';

describe('diagnostics', () => {
  it('never block the run, for every enumerated warning code', () => {
    for (const code of WARNING_CODES) {
      const warning = diagnosticWarning({ code, phase: 2, message: `${code} happened` });

      expect(warning.severity, code).toBe('warning');
      expect(blocksRun(warning), code).toBe(false);
    }
  });

  it('separate errors, which stop the run, from warnings, which do not', () => {
    const error = diagnosticError({
      code: 'config.version-missing',
      phase: 2,
      message: 'a file declares no version',
    });

    expect(blocksRun(error)).toBe(true);
  });

  it('models an absent location explicitly rather than leaving it undefined', () => {
    const warning = diagnosticWarning({
      code: 'preflight.skipped',
      phase: 5,
      message: 'preflight skipped',
    });

    expect(warning.location).toEqual(NO_LOCATION);
    expect(warning.requirement).toBeNull();
  });

  it('carries a JSON Pointer into the offending node, and the rule it enforces', () => {
    const warning = diagnosticWarning({
      code: 'release.ref-unpinned',
      phase: 2,
      message: 'release names no ref',
      location: { file: 'actions.yaml', pointer: '/repositories/aqua/generations/v1' },
      requirement: 'FR-ACT-004',
    });

    expect(warning.location).toEqual({
      file: 'actions.yaml',
      pointer: '/repositories/aqua/generations/v1',
      chain: null,
      stepId: null,
    });
    expect(warning.requirement).toBe('FR-ACT-004');
  });

  it('is frozen, like every artifact it travels with', () => {
    const warning = diagnosticWarning({
      code: 'preflight.skipped',
      phase: 5,
      message: 'preflight skipped',
    });

    expect(Object.isFrozen(warning)).toBe(true);
    expect(Object.isFrozen(warning.location)).toBe(true);
  });

  it('has no duplicate codes', () => {
    expect(new Set(WARNING_CODES).size).toBe(WARNING_CODES.length);
  });
});
