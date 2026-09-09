/**
 * Phase 1 — invocation and run context.
 *
 * Two halves, and only the first is about the command line: `parseInvocation`
 * turns argv into decisions, and the context constructors assemble the artifact
 * from them. A caller that already knows what it wants to run uses the
 * constructors alone and enters the pipeline at phase 2 (NFR-060).
 */
export {
  isCommand,
  listContext,
  reportContext,
  runContext,
  statusContext,
  validateContext,
  type ChainList,
  type CommonInput,
  type ListInput,
  type ReportInput,
  type RunInput,
  type StatusInput,
  type ValidateInput,
} from './context.ts';

export { EXCLUDE_CHAIN_LONG_FLAG, EXCLUDE_CHAIN_SHORT_FLAG, normalizeArgv } from './normalize.ts';

export {
  declaredFlagsByCommand,
  parseInvocation,
  type ParsedInvocation,
  type ParseOutcome,
  type PendingOutput,
} from './parse.ts';

export { PLANS_SUBDIRECTORY, isShortName, resolvePlanPath } from './plan-ref.ts';

export { IDENTIFIER, parseSetArg, type SetArgResult } from './set-arg.ts';
