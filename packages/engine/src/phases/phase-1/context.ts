/**
 * The run-context constructors — phase 1's second half.
 *
 * The phase has two halves and only the first is about the command line: parsing
 * argv into decisions, then **assembling the run context** from them
 * ([phase 1 → The programmatic boundary](../../../../../docs/architecture/phase-1-invocation.md#the-run-context-is-the-programmatic-boundary)).
 * The consistency rules live here rather than in the flag parser, so that
 * building a context by hand cannot bypass them (NFR-060, [artifacts.md §1](../../../../../docs/implementation/artifacts.md#1-runcontext)).
 *
 * The inputs below are flag-shaped on purpose — a comma-separated chain list, two
 * booleans for the verification stance, a name plus a cancel flag for the sender.
 * That is what leaves the constructor something to enforce: it is the step that
 * turns `--chain` and `--exclude-chain` into one `ChainScope`, so their
 * exclusivity is checked on the way in rather than trusted on the way out.
 *
 * Every rule broken is reported, not just the first. A programmatic producer gets
 * the same diagnostics a command line does.
 */
import {
  CHAIN_MODES,
  COMMANDS,
  DEFAULT_CHAIN_MODE,
  DEFAULT_CONFIGS_DIR,
  DEFAULT_REPOS_DIR,
  DEFAULT_RESULTS_DIR,
  deepFreeze,
  diagnosticError,
  type ChainMode,
  type ChainScope,
  type Command,
  type CommonContext,
  type ConstantOverride,
  type ContextResult,
  type Diagnostic,
  type InvocationErrorCode,
  type ListContext,
  type ListFilters,
  type PlanRef,
  type ReportContext,
  type ReportOutput,
  type RunCommandContext,
  type RunContext,
  type StatusContext,
  type ValidateContext,
} from '../../contracts/index.ts';
import { DEFAULT_LOG_LEVEL, LOG_LEVELS, type LogLevel } from '../../cross/logging/index.ts';
import { resolvePlanPath } from './plan-ref.ts';
import { parseSetArg } from './set-arg.ts';

/** A chain list as the flag takes it, or already split by a programmatic caller. */
export type ChainList = readonly string[] | string;

export interface CommonInput {
  readonly consoleLevel?: string | undefined;
  readonly logFile?: string | null | undefined;
  readonly configsDir?: string | undefined;
  readonly ignoreVersion?: boolean | undefined;
}

/**
 * `plan` is declared optional even where the flag is required, so that
 * requiredness is stated exactly once — as a runtime check, which is the form
 * NFR-060 obliges ("the checks that apply to a parsed command line shall apply
 * identically to programmatically supplied parameters"). A second, compile-time
 * statement of it would be a second thing to keep in agreement.
 */
export interface RunInput extends CommonInput {
  readonly plan?: string | null | undefined;
  readonly preset?: string | null | undefined;
  /** Raw `KEY=VALUE` arguments; the shape is checked here, the values in phase 2. */
  readonly sets?: readonly string[] | undefined;
  readonly overridesFile?: string | null | undefined;
  readonly deploymentId?: string | null | undefined;
  readonly restart?: boolean | undefined;
  readonly refreeze?: boolean | undefined;
  readonly chains?: ChainList | null | undefined;
  readonly excludeChains?: ChainList | null | undefined;
  readonly chainMode?: string | undefined;
  readonly multisig?: string | null | undefined;
  readonly multisigCancel?: boolean | undefined;
  readonly skipVerify?: boolean | undefined;
  readonly verifyOnly?: boolean | undefined;
  readonly dryRun?: boolean | undefined;
  readonly skipPreflight?: boolean | undefined;
  readonly cleanup?: boolean | undefined;
  readonly reposDir?: string | undefined;
  readonly resultsDir?: string | undefined;
}

export interface ValidateInput extends CommonInput {
  readonly plan?: string | null | undefined;
  readonly preset?: string | null | undefined;
  readonly chains?: ChainList | null | undefined;
  readonly excludeChains?: ChainList | null | undefined;
  readonly multisig?: string | null | undefined;
}

export interface StatusInput extends CommonInput {
  readonly plan?: string | null | undefined;
  readonly deploymentId?: string | null | undefined;
  readonly chains?: ChainList | null | undefined;
  readonly excludeChains?: ChainList | null | undefined;
  readonly resultsDir?: string | undefined;
}

export interface ReportInput extends CommonInput {
  readonly plan?: string | null | undefined;
  readonly deploymentId?: string | null | undefined;
  readonly chains?: ChainList | null | undefined;
  readonly excludeChains?: ChainList | null | undefined;
  readonly resultsDir?: string | undefined;
  readonly output?: string | null | undefined;
  readonly stdout?: boolean | undefined;
}

export interface ListInput extends CommonInput {
  readonly workflows?: boolean | undefined;
  readonly actions?: boolean | undefined;
  readonly plans?: boolean | undefined;
}

/**
 * Collects refusals so that one call reports every rule the parameters broke.
 * Nothing short-circuits: a field that failed its check falls back to a harmless
 * value and the result is discarded, which keeps the constructors linear.
 */
interface Refusals {
  readonly diagnostics: Diagnostic[];
  add(code: InvocationErrorCode, message: string, requirement: string): void;
}

function refusals(): Refusals {
  const diagnostics: Diagnostic[] = [];

  return {
    diagnostics,
    add: (code, message, requirement): void => {
      diagnostics.push(diagnosticError({ code, phase: 1, message, requirement }));
    },
  };
}

function isMember<T extends string>(allowed: readonly T[], value: string): value is T {
  return (allowed as readonly string[]).includes(value);
}

export function isCommand(value: string): value is Command {
  return isMember(COMMANDS, value);
}

function enumMember<T extends string>(
  allowed: readonly T[],
  value: string,
  fallback: T,
  flag: string,
  requirement: string,
  refused: Refusals,
): T {
  if (isMember(allowed, value)) return value;

  refused.add(
    'invocation.invalid-enum-value',
    `${flag} must be one of ${allowed.join(', ')} — got ${JSON.stringify(value)}`,
    requirement,
  );
  return fallback;
}

function given<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function chainNames(value: ChainList, flag: string, refused: Refusals): readonly string[] {
  const parts = typeof value === 'string' ? value.split(',') : value;
  const names = parts.map((name) => name.trim()).filter((name) => name !== '');

  if (names.length === 0) {
    refused.add(
      'invocation.malformed-flag-argument',
      `${flag} names no chain`,
      'FR-CLI-011',
    );
  }

  return names;
}

/**
 * The union is the enforcement: there is nowhere to record both a set of chains
 * to include and a set to exclude, so the exclusivity is checked on the way in
 * (FR-CLI-011).
 */
function chainScope(
  include: ChainList | null | undefined,
  exclude: ChainList | null | undefined,
  refused: Refusals,
): ChainScope {
  if (given(include) && given(exclude)) {
    refused.add(
      'invocation.mutually-exclusive-flags',
      '--chain and --exclude-chain are mutually exclusive — pass one',
      'FR-CLI-011',
    );
    return { kind: 'all' };
  }

  if (given(include)) return { kind: 'include', chains: chainNames(include, '--chain', refused) };
  if (given(exclude)) {
    return { kind: 'exclude', chains: chainNames(exclude, '--exclude-chain', refused) };
  }

  return { kind: 'all' };
}

function commonContext(input: CommonInput, refused: Refusals): CommonContext {
  return {
    console: {
      level: enumMember<LogLevel>(
        LOG_LEVELS,
        input.consoleLevel ?? DEFAULT_LOG_LEVEL,
        DEFAULT_LOG_LEVEL,
        '--log-level',
        'FR-CLI-004',
        refused,
      ),
    },
    logFile: input.logFile ?? null,
    configsDir: input.configsDir ?? DEFAULT_CONFIGS_DIR,
    ignoreVersion: input.ignoreVersion ?? false,
  };
}

function planReference(
  input: string | null | undefined,
  configsDir: string,
  requirement: string,
  refused: Refusals,
): PlanRef {
  if (!given(input)) {
    refused.add('invocation.missing-required-flag', '-e, --plan is required', requirement);
    return { input: '', path: '' };
  }

  if (input.trim() === '') {
    refused.add('invocation.malformed-flag-argument', '-e, --plan names no plan', 'FR-CLI-002');
    return { input, path: '' };
  }

  return { input, path: resolvePlanPath(input, configsDir) };
}

function overrideSets(sets: readonly string[], refused: Refusals): readonly ConstantOverride[] {
  const parsed: ConstantOverride[] = [];

  for (const argument of sets) {
    const outcome = parseSetArg(argument);
    if (outcome.ok) parsed.push(outcome.override);
    else {
      refused.add('invocation.malformed-flag-argument', `--set ${outcome.reason}`, 'FR-CLI-010');
    }
  }

  return parsed;
}

function verificationStance(
  skip: boolean,
  only: boolean,
  refused: Refusals,
): 'default' | 'skip' | 'only' {
  if (skip && only) {
    refused.add(
      'invocation.mutually-exclusive-flags',
      '--skip-verify and --verify-only are mutually exclusive',
      'FR-CLI-013',
    );
    return 'default';
  }

  if (skip) return 'skip';
  if (only) return 'only';
  return 'default';
}

function reportOutput(
  path: string | null | undefined,
  stdout: boolean,
  refused: Refusals,
): ReportOutput {
  if (given(path) && stdout) {
    refused.add(
      'invocation.mutually-exclusive-flags',
      '-o, --output writes a file and --stdout does not — pass one',
      'FR-CLI-031',
    );
    return { kind: 'default' };
  }

  if (stdout) return { kind: 'stdout' };
  if (given(path)) return { kind: 'file', path };
  return { kind: 'default' };
}

/** Every filter true when none is given (FR-CLI-032). */
function listFilters(input: ListInput): ListFilters {
  const selected = {
    workflows: input.workflows ?? false,
    actions: input.actions ?? false,
    plans: input.plans ?? false,
  };

  if (selected.workflows || selected.actions || selected.plans) return selected;
  return { workflows: true, actions: true, plans: true };
}

function settle<T extends RunContext>(context: T, refused: Refusals): ContextResult<T> {
  if (refused.diagnostics.length > 0) {
    return { ok: false, diagnostics: deepFreeze([...refused.diagnostics]) };
  }
  return { ok: true, context: deepFreeze(context) };
}

export function runContext(input: RunInput): ContextResult<RunCommandContext> {
  const refused = refusals();
  const common = commonContext(input, refused);
  const multisig = input.multisig ?? null;
  const cancel = input.multisigCancel ?? false;

  if (multisig === null && cancel) {
    refused.add(
      'invocation.missing-required-flag',
      '--multisig-cancel cancels the proposals of a multisig deployment, so it requires --multisig <name>',
      'FR-MSG-042',
    );
  }

  return settle(
    {
      ...common,
      command: 'run',
      plan: planReference(input.plan, common.configsDir, 'FR-CLI-010', refused),
      presetRequest: input.preset ?? null,
      overrides: {
        sets: overrideSets(input.sets ?? [], refused),
        file: input.overridesFile ?? null,
      },
      identity: {
        deploymentIdRequest: input.deploymentId ?? null,
        restart: input.restart ?? false,
        refreeze: input.refreeze ?? false,
      },
      chainScope: chainScope(input.chains, input.excludeChains, refused),
      chainMode: enumMember<ChainMode>(
        CHAIN_MODES,
        input.chainMode ?? DEFAULT_CHAIN_MODE,
        DEFAULT_CHAIN_MODE,
        '--chain-mode',
        'FR-RUN-010',
        refused,
      ),
      sender: multisig === null ? { mode: 'eoa' } : { mode: 'multisig', entry: multisig, cancel },
      verification: verificationStance(
        input.skipVerify ?? false,
        input.verifyOnly ?? false,
        refused,
      ),
      dryRun: input.dryRun ?? false,
      skipPreflight: input.skipPreflight ?? false,
      cleanup: input.cleanup ?? false,
      reposDir: input.reposDir ?? DEFAULT_REPOS_DIR,
      resultsDir: input.resultsDir ?? DEFAULT_RESULTS_DIR,
    },
    refused,
  );
}

export function validateContext(input: ValidateInput): ContextResult<ValidateContext> {
  const refused = refusals();
  const common = commonContext(input, refused);

  return settle(
    {
      ...common,
      command: 'validate',
      plan: planReference(input.plan, common.configsDir, 'FR-CLI-020', refused),
      presetRequest: input.preset ?? null,
      chainScope: chainScope(input.chains, input.excludeChains, refused),
      multisigEntry: input.multisig ?? null,
    },
    refused,
  );
}

export function statusContext(input: StatusInput): ContextResult<StatusContext> {
  const refused = refusals();
  const common = commonContext(input, refused);

  return settle(
    {
      ...common,
      command: 'status',
      // The only command whose plan is optional: with none, it reports
      // everything under the results tree (FR-CLI-030).
      plan: given(input.plan)
        ? planReference(input.plan, common.configsDir, 'FR-CLI-030', refused)
        : null,
      deploymentIdRequest: input.deploymentId ?? null,
      chainScope: chainScope(input.chains, input.excludeChains, refused),
      resultsDir: input.resultsDir ?? DEFAULT_RESULTS_DIR,
    },
    refused,
  );
}

export function reportContext(input: ReportInput): ContextResult<ReportContext> {
  const refused = refusals();
  const common = commonContext(input, refused);

  return settle(
    {
      ...common,
      command: 'report',
      plan: planReference(input.plan, common.configsDir, 'FR-CLI-031', refused),
      deploymentIdRequest: input.deploymentId ?? null,
      chainScope: chainScope(input.chains, input.excludeChains, refused),
      resultsDir: input.resultsDir ?? DEFAULT_RESULTS_DIR,
      output: reportOutput(input.output, input.stdout ?? false, refused),
    },
    refused,
  );
}

export function listContext(input: ListInput): ContextResult<ListContext> {
  const refused = refusals();

  return settle(
    { ...commonContext(input, refused), command: 'list', filters: listFilters(input) },
    refused,
  );
}
