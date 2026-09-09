/**
 * Argv into decisions — phase 1's first half.
 *
 * This module is a *parser*, deliberately. It decides which command was asked
 * for and which flags that command accepts, and hands the values to the
 * [context constructors](context.ts); it enforces no consistency rule of its own,
 * because a rule living here would not apply to a caller that never had an argv
 * ([artifacts.md §1](../../../../../docs/implementation/artifacts.md#1-runcontext)).
 *
 * **How the flag matrix becomes structural.** Commander resolves an option
 * against the command's ancestors, so a flag declared on the root works both
 * before and after the command name. That splits the
 * [matrix](../../../../../docs/specs/cli.md#flags-by-command) cleanly: the rows
 * marked for all five commands are declared once, on the root, and every other
 * row is declared on exactly the commands whose column has a mark. A flag outside
 * a command's column is then not "rejected" — it was never declared anywhere the
 * command can see, which is the same guarantee one level down from the types
 * (FR-CLI-006).
 */
import { CONFIG_FORMAT_VERSION } from '@deploy-pad/schemas';
import { Command, CommanderError, Option } from 'commander';
import {
  CHAIN_MODES,
  diagnosticError,
  type ContextResult,
  type Diagnostic,
  type InvocationErrorCode,
  type RunContext,
} from '../../contracts/index.ts';
import {
  DEFAULT_LOG_LEVEL,
  LOG_LEVELS,
  type EmittedLevel,
  type LogLevel,
} from '../../cross/logging/index.ts';
import { engineVersion } from '../../version.ts';
import {
  listContext,
  reportContext,
  runContext,
  statusContext,
  validateContext,
  type CommonInput,
} from './context.ts';
import { EXCLUDE_CHAIN_LONG_FLAG, normalizeArgv } from './normalize.ts';

/** Commander writes help and errors while parsing, before the console level is known. */
export interface PendingOutput {
  readonly text: string;
  readonly level: EmittedLevel;
  readonly stream: 'out' | 'err';
}

export type ParseOutcome =
  | { readonly kind: 'context'; readonly context: RunContext }
  | { readonly kind: 'refused'; readonly diagnostics: readonly Diagnostic[] }
  /** Commander's own output was the point of the invocation: `--help`, `--version`. */
  | { readonly kind: 'self-reported' }
  | { readonly kind: 'no-command'; readonly help: string };

export interface ParsedInvocation {
  /** Known even when the parse failed, so `--log-level silent` is honoured by a refusal too. */
  readonly level: LogLevel;
  readonly logFile: string | null;
  readonly pending: readonly PendingOutput[];
  readonly outcome: ParseOutcome;
}

interface CommonOptions {
  readonly logLevel?: string;
  readonly verbose?: boolean;
  readonly quiet?: boolean;
  readonly logFile?: string;
  readonly configsDir?: string;
  readonly ignoreVersion?: boolean;
}

type Options = Record<string, unknown>;

interface Selection {
  readonly name: string;
  readonly options: Options;
}

const LEVEL_FLAGS = {
  logLevel: '--log-level',
  verbose: '-v, --verbose',
  quiet: '-q, --quiet',
} as const;

/**
 * Commander's error codes, mapped onto the closed set of phase-1 failures
 * ([phase 1 → Failure modes](../../../../../docs/architecture/phase-1-invocation.md#failure-modes)).
 * `commander.unknownOption` is the one that needs more than a lookup — see
 * `unknownOptionCode`.
 */
const COMMANDER_CODES: Record<string, InvocationErrorCode> = {
  'commander.unknownCommand': 'invocation.unknown-command-or-flag',
  'commander.excessArguments': 'invocation.unknown-command-or-flag',
  'commander.invalidArgument': 'invocation.invalid-enum-value',
  'commander.optionMissingArgument': 'invocation.malformed-flag-argument',
  'commander.missingArgument': 'invocation.missing-required-flag',
  'commander.missingMandatoryOptionValue': 'invocation.missing-required-flag',
  'commander.conflictingOption': 'invocation.mutually-exclusive-flags',
};

const UNKNOWN_OPTION = /unknown option '(?<flag>[^']+)'/u;

function collect(value: string, previous: readonly string[]): readonly string[] {
  return [...previous, value];
}

/**
 * No commander `.default()` anywhere: a value is absent unless it was given, and
 * every default is applied once, by the context constructor. Two places holding
 * the same default is how they come to disagree.
 */
function buildProgram(
  pending: PendingOutput[],
  errors: string[],
  select: (selection: Selection) => void,
): Command {
  const program = new Command()
    .name('deploy-pad')
    .description(
      'Repeatable, auditable multi-chain smart-contract deployments from declarative config.',
    )
    .version(
      `deploy-pad ${engineVersion()} (config format ${String(CONFIG_FORMAT_VERSION)})`,
      '--version',
      'Print the engine version and the config format it speaks.',
    )
    .addOption(
      new Option('--log-level <level>', 'Console output threshold. Default: info.').choices([
        ...LOG_LEVELS,
      ]),
    )
    .option('-v, --verbose', 'Sugar for --log-level debug.')
    .option('-q, --quiet', 'Sugar for --log-level error.')
    .option(
      '-l, --log-file <path>',
      'Additionally write structured JSON logs to a file, always at full debug detail.',
    )
    .option('--configs-dir <path>', 'Root of the mounted config set. Default: workspace/configs.')
    .option('--ignore-version', 'Downgrade a config format version mismatch to a warning.')
    .helpOption('-h, --help', 'Show this help.')
    // FR-CLI-001 names five commands; commander would add a sixth, `help
    // [command]`, which `-h` on each command already covers.
    .helpCommand(false)
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => pending.push({ text, level: 'info', stream: 'out' }),
      // Held rather than queued: commander's error text becomes a diagnostic's
      // message, and its "no command" help is replaced by ours. Queuing both
      // would print each of them twice.
      writeErr: (text) => errors.push(text),
    });

  const sub = (name: string, description: string): Command => {
    const command = program.command(name).description(description);
    command.action((options: Options) => {
      select({ name, options });
    });
    return command;
  };

  const plan = (command: Command, description: string): Command =>
    command.option('-e, --plan <nameOrPath>', description);

  const chainScope = (command: Command): Command =>
    command
      .option('-c, --chain <names>', 'Restrict to these chains (comma-separated).')
      .option(
        `${EXCLUDE_CHAIN_LONG_FLAG} <names>`,
        'The complement: every resolved chain but these (comma-separated). Also spelled -xc.',
      );

  const results = (command: Command): Command =>
    command.option(
      '--results-dir <path>',
      'Where records are read and written. Default: workspace/results.',
    );

  const run = sub('run', 'Execute a deployment — the only command that changes on-chain state.');
  plan(run, 'The plan to run. Required.');
  chainScope(run);
  results(run);
  run
    .option('--preset <name>', 'Select the active preset.')
    .option('--set <KEY=VALUE>', 'One-off constant override, repeatable.', collect, [])
    .option('--overrides <path>', 'A YAML file of Preset-shaped overrides.')
    .option('--deployment-id <id>', 'Explicit deployment id.')
    .option('--restart', 'Start a fresh deployment instead of resuming an unfinished one.')
    .option('--refreeze', 'On a resume, re-resolve and re-freeze the parameter set.')
    .addOption(
      new Option(
        '--chain-mode <mode>',
        'How the per-chain loop runs. Default: sequential.',
      ).choices([...CHAIN_MODES]),
    )
    .option('--multisig <name>', 'Deploy through the named Safe from multisig.yaml.')
    .option('--multisig-cancel', "Cancel the deployment's pending proposals.")
    .option('--skip-verify', 'Deploy without verifying.')
    .option('--verify-only', 'Verify a prior deployment without deploying.')
    .option('--dry-run', 'Print what would execute and exit without touching any chain.')
    .option('--skip-preflight', 'Skip the preflight checks for this invocation.')
    .option('--repos-dir <path>', 'Where repositories are cloned. Default: workspace/repos.')
    .option('--cleanup', 'Delete the per-chain run directories after a successful completion.');

  const validate = sub('validate', 'Load and validate everything for a plan without executing.');
  plan(validate, 'The plan to validate against. Required.');
  chainScope(validate);
  validate
    .option('--preset <name>', 'Validate with this preset active.')
    .option('--multisig <name>', 'Additionally run the multisig-mode checks for this entry.');

  const status = sub('status', 'Inspect existing deployments and their per-chain step statuses.');
  plan(status, 'Filter to the workflow this plan points at.');
  chainScope(status);
  results(status);
  status.option('--deployment-id <id>', 'Show one deployment in detail.');

  const report = sub('report', 'Generate a Markdown deployment report.');
  plan(report, "The plan whose workflow's deployment is reported. Required.");
  chainScope(report);
  results(report);
  report
    .option('--deployment-id <id>', 'Which deployment to report.')
    .option('-o, --output <path>', "Output file. Default: report.md in the deployment's directory.")
    .option('--stdout', 'Print to stdout instead of writing a file.');

  const list = sub('list', 'List the workflows, actions, and plans the mounted configs declare.');
  list
    .option('--workflows', 'Show only workflow ids.')
    .option('--actions', 'Show only actions.')
    .option('--plans', 'Show only plan files.');

  return program;
}

function flagsOf(command: Command): readonly string[] {
  return command.options.flatMap((option) =>
    [option.short, option.long].filter((flag): flag is string => flag !== undefined),
  );
}

/** Every flag any command declares — what tells "not for this command" from "not a flag at all". */
function declaredFlags(program: Command): ReadonlySet<string> {
  return new Set([program, ...program.commands].flatMap(flagsOf));
}

/**
 * Which flags each command accepts, with the program itself as the answer. The
 * root's flags are folded into every command, because commander resolves an
 * option through its ancestors and that is what makes them common.
 *
 * Exported so that [the flag matrix](../../../../../docs/specs/cli.md#flags-by-command)
 * can be checked against the code in *both* directions: a flag the spec marks
 * that no command declares, and a flag a command declares that the spec never
 * mentions. Only the second direction needs this — the first is visible from
 * behaviour — and without it a flag added here and nowhere else would pass
 * unnoticed (FR-CLI-006).
 */
export function declaredFlagsByCommand(): ReadonlyMap<string, ReadonlySet<string>> {
  const program = buildProgram([], [], () => {});
  const common = flagsOf(program);

  return new Map(
    program.commands.map((command) => [
      command.name(),
      new Set([...common, ...flagsOf(command)]),
    ]),
  );
}

function unknownOptionCode(message: string, flags: ReadonlySet<string>): InvocationErrorCode {
  const flag = UNKNOWN_OPTION.exec(message)?.groups?.['flag'];

  // Declared somewhere, just not here: the operator who typed
  // `status --multisig ops-main` believed the flag did something.
  return flag !== undefined && flags.has(flag)
    ? 'invocation.flag-not-for-command'
    : 'invocation.unknown-command-or-flag';
}

type LevelChoice =
  | { readonly kind: 'resolved'; readonly level: LogLevel }
  | { readonly kind: 'conflict'; readonly flags: readonly string[] };

/**
 * `-v`, `-q` and `--log-level` set the same value, so at most one may be given
 * (FR-CLI-004) — and the winner is collapsed here, before any artifact exists, so
 * nothing downstream ever sees three ways to say it.
 */
function resolveConsoleLevel(program: Command, options: CommonOptions): LevelChoice {
  const explicit = (['logLevel', 'verbose', 'quiet'] as const).filter(
    (name) => program.getOptionValueSource(name) === 'cli',
  );

  if (explicit.length > 1) {
    return { kind: 'conflict', flags: explicit.map((name) => LEVEL_FLAGS[name]) };
  }
  if (options.verbose === true) return { kind: 'resolved', level: 'debug' };
  if (options.quiet === true) return { kind: 'resolved', level: 'error' };

  return { kind: 'resolved', level: (options.logLevel as LogLevel | undefined) ?? DEFAULT_LOG_LEVEL };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function flag(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function strings(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) ? (value as readonly string[]) : undefined;
}

function commonInput(options: CommonOptions, level: LogLevel): CommonInput {
  return {
    consoleLevel: level,
    logFile: options.logFile,
    configsDir: options.configsDir,
    ignoreVersion: options.ignoreVersion,
  };
}

function contextFor(selection: Selection, common: CommonInput): ContextResult<RunContext> {
  const options = selection.options;
  const scope = { chains: text(options['chain']), excludeChains: text(options['excludeChain']) };

  switch (selection.name) {
    case 'run':
      return runContext({
        ...common,
        ...scope,
        plan: text(options['plan']),
        preset: text(options['preset']),
        sets: strings(options['set']),
        overridesFile: text(options['overrides']),
        deploymentId: text(options['deploymentId']),
        restart: flag(options['restart']),
        refreeze: flag(options['refreeze']),
        chainMode: text(options['chainMode']),
        multisig: text(options['multisig']),
        multisigCancel: flag(options['multisigCancel']),
        skipVerify: flag(options['skipVerify']),
        verifyOnly: flag(options['verifyOnly']),
        dryRun: flag(options['dryRun']),
        skipPreflight: flag(options['skipPreflight']),
        cleanup: flag(options['cleanup']),
        reposDir: text(options['reposDir']),
        resultsDir: text(options['resultsDir']),
      });
    case 'validate':
      return validateContext({
        ...common,
        ...scope,
        plan: text(options['plan']),
        preset: text(options['preset']),
        multisig: text(options['multisig']),
      });
    case 'status':
      return statusContext({
        ...common,
        ...scope,
        plan: text(options['plan']),
        deploymentId: text(options['deploymentId']),
        resultsDir: text(options['resultsDir']),
      });
    case 'report':
      return reportContext({
        ...common,
        ...scope,
        plan: text(options['plan']),
        deploymentId: text(options['deploymentId']),
        resultsDir: text(options['resultsDir']),
        output: text(options['output']),
        stdout: flag(options['stdout']),
      });
    case 'list':
      return listContext({
        ...common,
        workflows: flag(options['workflows']),
        actions: flag(options['actions']),
        plans: flag(options['plans']),
      });
    default:
      // A programming error, not an invocation one: commander refuses any command
      // it was not given, so a name reaching here is one this switch forgot.
      throw new Error(`no context constructor for command ${JSON.stringify(selection.name)}`);
  }
}

export function parseInvocation(argv: readonly string[]): ParsedInvocation {
  const pending: PendingOutput[] = [];
  const errors: string[] = [];
  const chosen: { current: Selection | null } = { current: null };

  const program = buildProgram(pending, errors, (selection) => {
    chosen.current = selection;
  });

  let failure: CommanderError | null = null;
  try {
    program.parse([...normalizeArgv(argv)], { from: 'user' });
  } catch (cause) {
    if (!(cause instanceof CommanderError)) throw cause;
    failure = cause;
  }

  const options = program.opts<CommonOptions>();
  const choice = resolveConsoleLevel(program, options);
  const level = choice.kind === 'resolved' ? choice.level : DEFAULT_LOG_LEVEL;
  const logFile = options.logFile ?? null;
  const settle = (outcome: ParseOutcome): ParsedInvocation => ({
    level,
    logFile,
    pending,
    outcome,
  });

  const refuse = (
    code: InvocationErrorCode,
    message: string,
    requirement: string,
  ): ParsedInvocation =>
    settle({
      kind: 'refused',
      diagnostics: [diagnosticError({ code, phase: 1, message, requirement })],
    });

  // `--help` and `--version` are their own output; commander uses exit 0 for them
  // and 1 for every invocation it refused.
  if (failure !== null && failure.exitCode === 0) return settle({ kind: 'self-reported' });

  // With subcommands declared, commander answers an empty argv by printing help
  // under the `commander.help` code. That is not a refusal of anything the
  // operator wrote, so it falls through to the checks below and, failing those,
  // to the no-command outcome — which carries our own wording.
  if (failure !== null && failure.code !== 'commander.help') {
    const code =
      failure.code === 'commander.unknownOption'
        ? unknownOptionCode(failure.message, declaredFlags(program))
        : (COMMANDER_CODES[failure.code] ?? 'invocation.unknown-command-or-flag');

    const reported = errors.join('').trimEnd();
    return refuse(code, strip(reported === '' ? failure.message : reported), 'FR-CLI-006');
  }

  if (choice.kind === 'conflict') {
    return refuse(
      'invocation.mutually-exclusive-flags',
      `${choice.flags.join(' and ')} set the same value — pass at most one`,
      'FR-CLI-004',
    );
  }

  const selection = chosen.current;
  if (selection === null) {
    return settle({ kind: 'no-command', help: program.helpInformation().trimEnd() });
  }

  const result = contextFor(selection, commonInput(options, level));

  return settle(
    result.ok
      ? { kind: 'context', context: result.context }
      : { kind: 'refused', diagnostics: result.diagnostics },
  );
}

/** The logger tags a line with its level, so commander's own prefix would double it. */
function strip(message: string): string {
  return message.startsWith('error: ') ? message.slice('error: '.length) : message;
}
