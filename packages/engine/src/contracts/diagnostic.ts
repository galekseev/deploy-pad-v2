/**
 * Diagnostics, per [artifacts.md §8](../../../../docs/implementation/artifacts.md#8-cross-cutting-types).
 *
 * Diagnostics travel with the artifact their phase produced rather than through
 * a side channel, because warnings never stop a run (FR-RUN-009) and `validate`
 * renders the whole accumulated set rather than stopping at the first (NFR-022).
 */

/** The eight run phases; a diagnostic names the one that produced it. */
export type RunPhase = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type DiagnosticSeverity = 'error' | 'warning';

/**
 * The known warnings are a finite list, and enumerating them is what makes
 * "warnings never block" testable per code rather than in the aggregate.
 *
 * Error codes are not enumerated yet: each arrives with the phase gate that
 * raises it, from S2 onward.
 */
export const WARNING_CODES = [
  /** A step's salt was derived from the plan's `saltBase` rather than given explicitly. */
  'salt.derived-from-salt-base',
  /** A step's salt was derived from a randomly generated base — reproducible only via the frozen set. */
  'salt.derived-from-random-base',
  /** A config file carries no `version` key, so the format gate could not check it. */
  'config.version-missing',
  /** A release pin names no ref, so the checkout tracks the remote default branch. */
  'release.ref-unpinned',
  /** A step declares `verify: true` on a chain with no selected verification profile. */
  'verification.disabled-with-verifying-step',
  /** A resumed deployment's plan values differ from the frozen set; the frozen values win. */
  'resume.parameter-drift',
  /** A chain joined the plan's chain set after the deployment launched, so the resume skips it. */
  'chains.added-to-set-after-launch',
  /** Preflight was skipped for this invocation with `--skip-preflight`. */
  'preflight.skipped',
] as const;

export type WarningCode = (typeof WARNING_CODES)[number];

export type DiagnosticCode = WarningCode;

/**
 * Where the diagnostic points. `pointer` is a JSON Pointer (RFC 6901) into the
 * parsed document, so an error names the offending node rather than guessing a
 * line.
 *
 * Every field is present and explicitly `null` when it does not apply — the
 * "absence is modelled, not implied" convention every artifact follows.
 */
export interface DiagnosticLocation {
  readonly file: string | null;
  readonly pointer: string | null;
  readonly chain: string | null;
  readonly stepId: string | null;
}

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly phase: RunPhase;
  readonly location: DiagnosticLocation;
  readonly message: string;
  /** The FR id this diagnostic enforces, where one applies. */
  readonly requirement: string | null;
}

export const NO_LOCATION: DiagnosticLocation = Object.freeze({
  file: null,
  pointer: null,
  chain: null,
  stepId: null,
});

export interface DiagnosticInput {
  readonly code: DiagnosticCode;
  readonly phase: RunPhase;
  readonly message: string;
  readonly location?: Partial<DiagnosticLocation>;
  readonly requirement?: string;
}

function build(severity: DiagnosticSeverity, input: DiagnosticInput): Diagnostic {
  return Object.freeze({
    code: input.code,
    severity,
    phase: input.phase,
    location: Object.freeze({ ...NO_LOCATION, ...input.location }),
    message: input.message,
    requirement: input.requirement ?? null,
  });
}

export function diagnosticError(input: DiagnosticInput): Diagnostic {
  return build('error', input);
}

export function diagnosticWarning(input: DiagnosticInput): Diagnostic {
  return build('warning', input);
}

/**
 * The single home of FR-RUN-009: a warning is recorded and the run carries on;
 * only an error stops it.
 */
export function blocksRun(diagnostic: Diagnostic): boolean {
  return diagnostic.severity === 'error';
}
