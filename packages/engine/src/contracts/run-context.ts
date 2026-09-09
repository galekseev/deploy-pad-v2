/**
 * The run context, per [artifacts.md §1](../../../../docs/implementation/artifacts.md#1-runcontext).
 *
 * The output of [phase 1](../../../../docs/architecture/phase-1-invocation.md):
 * the fixed set of parameters that deliberately live outside every config file
 * (FR-RUN-002). Frozen, and never rewritten by a later phase — when phase 4
 * resolves the concrete deployment id, that is a product of *its* phase.
 *
 * The shape mirrors [the flag matrix](../../../../docs/specs/cli.md#flags-by-command)
 * exactly: a field exists on a command's payload if and only if that command's
 * column has a mark. `status` has no `--multisig` field to hold a value in,
 * which makes FR-CLI-006 a property of the type rather than a runtime check
 * someone could forget.
 *
 * This module holds only the types. The rules that decide whether a given set of
 * parameters *is* a run context belong to the constructors in
 * [phases/phase-1/context.ts](../phases/phase-1/context.ts) — phase 1 owns them,
 * and putting them there rather than in the flag parser is what stops a
 * hand-built context from bypassing them (NFR-060).
 */
import type { Diagnostic } from './diagnostic.ts';
import type { LogLevel } from '../cross/logging/levels.ts';

/** The five commands of FR-CLI-001. */
export const COMMANDS = ['run', 'validate', 'status', 'report', 'list'] as const;

export type Command = (typeof COMMANDS)[number];

/** FR-RUN-010. A fact: complete at parse time, never re-validated. */
export const CHAIN_MODES = ['sequential', 'continue', 'parallel'] as const;

export type ChainMode = (typeof CHAIN_MODES)[number];

export const DEFAULT_CHAIN_MODE: ChainMode = 'sequential';

/**
 * `--skip-verify` and `--verify-only` are mutually exclusive, so the stance is
 * one value rather than two booleans that could disagree (FR-CLI-013).
 */
export const VERIFICATION_STANCES = ['default', 'skip', 'only'] as const;

export type VerificationStance = (typeof VERIFICATION_STANCES)[number];

/**
 * The directory roots. Facts at parse time — recorded, not touched: a missing
 * directory is a phase-2 load error, never a phase-1 one.
 */
export const DEFAULT_CONFIGS_DIR = 'workspace/configs';
export const DEFAULT_RESULTS_DIR = 'workspace/results';
export const DEFAULT_REPOS_DIR = 'workspace/repos';

/**
 * A request: which file the later load will open. `input` as typed, `path` after
 * the name-or-path rule (FR-CLI-002). The file is not opened here — a
 * nonexistent plan surfaces in phase 2.
 */
export interface PlanRef {
  readonly input: string;
  readonly path: string;
}

/**
 * A request. The union is how `--chain` / `--exclude-chain` exclusivity is
 * enforced structurally; whether each name is in the *resolved* set is a phase-2
 * check (FR-CLI-011).
 */
export type ChainScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'include'; readonly chains: readonly string[] }
  | { readonly kind: 'exclude'; readonly chains: readonly string[] };

export interface ConsoleSettings {
  readonly level: LogLevel;
}

/** One `--set KEY=VALUE`. The key's shape is checked in phase 1; the value at the phase-2 merge. */
export interface ConstantOverride {
  readonly key: string;
  readonly value: string;
}

export interface Overrides {
  readonly sets: readonly ConstantOverride[];
  readonly file: string | null;
}

/** A request. The concrete id, and whether it resumes, are phase-4 products (FR-PLN-030/031). */
export interface DeploymentIdentity {
  readonly deploymentIdRequest: string | null;
  readonly restart: boolean;
  readonly refreeze: boolean;
}

/**
 * Omitted `--multisig` means eoa mode, so the modes are variants rather than a
 * nullable name plus a flag. The entry name is a request — validated in phase 2,
 * re-checked against the deployment record in phase 4 (FR-MSG-042).
 */
export type Sender =
  | { readonly mode: 'eoa' }
  | { readonly mode: 'multisig'; readonly entry: string; readonly cancel: boolean };

/**
 * Where `report` writes (FR-CLI-031). `default` is its own variant because the
 * default path is *inside the deployment's results directory* — which needs the
 * resolved deployment id, a phase-4 product. Phase 1 cannot name that path, and
 * modelling the absence explicitly is what keeps it from being guessed here.
 */
export type ReportOutput =
  | { readonly kind: 'default' }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'stdout' };

/** All three true when no filter is given (FR-CLI-032). */
export interface ListFilters {
  readonly workflows: boolean;
  readonly actions: boolean;
  readonly plans: boolean;
}

/** Accepted by every command: logging, the mount, and the version escape hatch. */
export interface CommonContext {
  readonly console: ConsoleSettings;
  readonly logFile: string | null;
  readonly configsDir: string;
  readonly ignoreVersion: boolean;
}

export interface RunCommandContext extends CommonContext {
  readonly command: 'run';
  readonly plan: PlanRef;
  readonly presetRequest: string | null;
  readonly overrides: Overrides;
  readonly identity: DeploymentIdentity;
  readonly chainScope: ChainScope;
  readonly chainMode: ChainMode;
  readonly sender: Sender;
  readonly verification: VerificationStance;
  readonly dryRun: boolean;
  readonly skipPreflight: boolean;
  readonly cleanup: boolean;
  readonly reposDir: string;
  readonly resultsDir: string;
}

/** No deployment identity, no results directory: validation never reaches phase 4. */
export interface ValidateContext extends CommonContext {
  readonly command: 'validate';
  readonly plan: PlanRef;
  readonly presetRequest: string | null;
  readonly chainScope: ChainScope;
  readonly multisigEntry: string | null;
}

export interface StatusContext extends CommonContext {
  readonly command: 'status';
  /** Optional here alone: `status` with no plan reports everything under the results tree. */
  readonly plan: PlanRef | null;
  readonly deploymentIdRequest: string | null;
  readonly chainScope: ChainScope;
  readonly resultsDir: string;
}

export interface ReportContext extends CommonContext {
  readonly command: 'report';
  readonly plan: PlanRef;
  readonly deploymentIdRequest: string | null;
  readonly chainScope: ChainScope;
  readonly resultsDir: string;
  readonly output: ReportOutput;
}

export interface ListContext extends CommonContext {
  readonly command: 'list';
  readonly filters: ListFilters;
}

export type RunContext =
  | RunCommandContext
  | ValidateContext
  | StatusContext
  | ReportContext
  | ListContext;

/**
 * What a constructor returns. Refusal carries diagnostics rather than throwing,
 * because a programmatic producer must get the same errors a command line does
 * (NFR-060) — and because a constructor reports every rule the parameters broke,
 * not just the first.
 */
export type ContextResult<T extends RunContext> =
  | { readonly ok: true; readonly context: T }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };
