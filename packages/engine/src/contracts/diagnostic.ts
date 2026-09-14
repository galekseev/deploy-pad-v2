/**
 * Diagnostics, per [artifacts.md §8](../../../../docs/implementation/artifacts.md#8-cross-cutting-types).
 *
 * Diagnostics travel with the artifact their phase produced rather than through
 * a side channel, because warnings never stop a run (FR-RUN-009) and `validate`
 * renders the whole accumulated set rather than stopping at the first (NFR-022).
 */

import { ExitCode } from './exit-code.ts';

/** The eight run phases; a diagnostic names the one that produced it. */
export type RunPhase = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type DiagnosticSeverity = 'error' | 'warning';

/**
 * The known warnings are a finite list, and enumerating them is what makes
 * "warnings never block" testable per code rather than in the aggregate.
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

/**
 * The errors of the command line itself, one per row of the failure-mode table
 * in [phase 1](../../../../docs/architecture/phase-1-invocation.md#failure-modes).
 * The table is closed — these are the *only* errors phase 1 can raise, because
 * everything config-dependent is deliberately left to the phase that loads it —
 * so a contract test pins the two against each other.
 *
 * The error codes of the later phases arrive with the gates that raise them,
 * from S2 onward.
 */
export const INVOCATION_ERROR_CODES = [
  /** `deploy-pad deploy`, `--pln`. */
  'invocation.unknown-command-or-flag',
  /** `status --multisig ops-main`, `report --restart`. */
  'invocation.flag-not-for-command',
  /** `--chain-mode fastest`. */
  'invocation.invalid-enum-value',
  /** `--set OWNER` (no `=`), `--set 1bad-key=x` (key fails the identifier rule), `--chain ""`. */
  'invocation.malformed-flag-argument',
  /** `--chain` with `--exclude-chain`, `--skip-verify` with `--verify-only`, `-v` with `--log-level`. */
  'invocation.mutually-exclusive-flags',
  /** `run` without `-e, --plan`. */
  'invocation.missing-required-flag',
] as const;

export type InvocationErrorCode = (typeof INVOCATION_ERROR_CODES)[number];

/**
 * The errors of the config set itself — gates 1 and 2 of
 * [phase 2](../../../../docs/architecture/phase-2-load-validation.md).
 *
 * Unlike phase 1's table these are not a closed set: gates 3 and 4 add their own
 * in S3, as each gate that raises one lands. What is fixed is which exit code a
 * code carries, and that split is the failure model's rather than a judgement
 * made per call site — a file the engine could not read or understand is a
 * configuration error (`1`), a file it read and found wrong is a validation
 * error (`2`).
 */
export const CONFIG_ERROR_CODES = [
  /** A file the run needs is not in the mount. Exit 1. */
  'config.file-missing',
  /** A file exists and is not YAML the parser can read. Exit 1. */
  'config.unparseable',
  /** A file declares a format version this engine does not speak. Exit 1. */
  'config.version-mismatch',
  /** A file uses a YAML feature v2 configs may not use: anchors, aliases, merge keys. Exit 2. */
  'config.yaml-feature-forbidden',
  /** A file is the wrong shape for its schema. Exit 2. */
  'config.schema-violation',
] as const;

export type ConfigErrorCode = (typeof CONFIG_ERROR_CODES)[number];

export type ErrorCode = InvocationErrorCode | ConfigErrorCode;

export type DiagnosticCode = WarningCode | ErrorCode;

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

/**
 * Which failure class each error belongs to, from
 * [the failure model](../../../../docs/architecture/run-lifecycle.md#failure-model).
 *
 * A table rather than a decision at each call site, and `satisfies` rather than a
 * plain annotation: a new error code will not compile until someone has said
 * which class it is. That is the whole point — the exit codes are a contract with
 * CI (FR-CLI-005), and the way that contract rots is one call site picking a
 * number because it was nearby.
 *
 * The phase-2 split is the one worth reading twice: a file the engine could not
 * read or whose format it does not speak is a **configuration** error, because
 * nothing was validated; a file it read and found wrong is a **validation**
 * error.
 */
export const ERROR_EXIT_CODES = {
  'invocation.unknown-command-or-flag': ExitCode.Configuration,
  'invocation.flag-not-for-command': ExitCode.Configuration,
  'invocation.invalid-enum-value': ExitCode.Configuration,
  'invocation.malformed-flag-argument': ExitCode.Configuration,
  'invocation.mutually-exclusive-flags': ExitCode.Configuration,
  'invocation.missing-required-flag': ExitCode.Configuration,
  'config.file-missing': ExitCode.Configuration,
  'config.unparseable': ExitCode.Configuration,
  'config.version-mismatch': ExitCode.Configuration,
  'config.yaml-feature-forbidden': ExitCode.Validation,
  'config.schema-violation': ExitCode.Validation,
} as const satisfies Record<ErrorCode, ExitCode>;

function isErrorCode(code: DiagnosticCode): code is ErrorCode {
  return code in ERROR_EXIT_CODES;
}

/**
 * The code an invocation ends with, given everything it collected. Warnings never
 * contribute (FR-RUN-009), and where several classes are present the **earliest
 * phase** wins — a file that would not load says more about what to fix than the
 * shape errors that followed it.
 */
export function exitCodeFor(diagnostics: readonly Diagnostic[]): ExitCode {
  const codes = diagnostics
    .filter(blocksRun)
    .map((diagnostic) => diagnostic.code)
    .filter(isErrorCode)
    .map((code) => ERROR_EXIT_CODES[code]);

  return codes.length === 0 ? ExitCode.Success : (Math.min(...codes) as ExitCode);
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
