/**
 * `list` — the discovery command (FR-CLI-032).
 *
 * It goes through the same gates as every other command now, which changed what
 * it can assume: S1 narrowed each shape by hand because no gate had run, and
 * every entry it could not understand had to be reported rather than trusted.
 * With gate 2 in front, the documents are the shapes the schemas describe, and
 * the reading below is the generated types doing the work the guards used to.
 *
 * What stays defensive is only what the schema genuinely permits: a workflow map
 * holds `Workflow | WorkflowVariant`, and telling those apart is a discriminated
 * union rather than a guess.
 */
import { basename, join } from 'node:path';
import type { ActionsConfig, Plan, WorkflowsConfig } from '@deploy-pad/schemas/types';
import { ExitCode, exitCodeFor, type ListContext, type ListFilters } from '../contracts/index.ts';
import type { Logger } from '../cross/logging/index.ts';
import { PLANS_SUBDIRECTORY } from '../phases/phase-1/plan-ref.ts';
import {
  loadConfigSet,
  schemaRegistry,
  type ConfigDocument,
  type ConfigSource,
  type LoadedConfigSet,
  type SchemaRegistry,
  type Want,
} from '../phases/phase-2/index.ts';
import { reportDiagnostics } from './diagnostics.ts';

/** The one key of a config file that is not an entry of its catalog. */
const RESERVED_KEY = 'version';

interface WorkflowEntry {
  readonly id: string;
  readonly variantOf: string | null;
}

interface ActionEntry {
  readonly id: string;
  readonly type: string;
  readonly alias: string | null;
}

interface GenerationEntry {
  readonly id: string;
  readonly actions: readonly ActionEntry[];
}

type PlanTarget =
  | { readonly kind: 'workflow'; readonly id: string }
  | { readonly kind: 'action'; readonly action: string };

interface PlanEntry {
  readonly file: string;
  readonly target: PlanTarget;
  readonly presets: readonly string[];
}

export interface ListIo {
  readonly source: ConfigSource;
  readonly schemas?: SchemaRegistry | undefined;
  readonly logger: Logger;
}

function entryKeys(mapping: object): readonly string[] {
  return Object.keys(mapping).filter((key) => key !== RESERVED_KEY);
}

function readWorkflows(document: ConfigDocument): readonly WorkflowEntry[] {
  const config = document.data as WorkflowsConfig;

  return entryKeys(config).map((id) => {
    const entry = config[id];
    return {
      id,
      // The map's value type is the union the schema declares, so the variant is
      // told apart by the field that defines one rather than by a shape guess.
      variantOf:
        typeof entry === 'object' && entry !== null && 'variantOf' in entry ? entry.variantOf : null,
    };
  });
}

function readActions(document: ConfigDocument): readonly GenerationEntry[] {
  const config = document.data as ActionsConfig;
  const generations: GenerationEntry[] = [];

  for (const repoId of entryKeys(config)) {
    const repo = config[repoId];
    if (typeof repo !== 'object' || repo === null || !('generations' in repo)) continue;

    for (const [generationId, generation] of Object.entries(repo.generations)) {
      generations.push({
        id: `${repoId}.${generationId}`,
        actions: Object.entries(generation.actions).map(([actionId, action]) => ({
          // The fully-qualified id, which is what a workflow step names.
          id: `${repoId}.${generationId}.${actionId}`,
          type: action.type,
          alias: action.alias ?? null,
        })),
      });
    }
  }

  return generations;
}

/**
 * A plan points at a workflow id, or — for a
 * [single-action plan](../../../../docs/specs/plans.md#single-action-plans) —
 * carries the step inline.
 */
function readPlans(documents: readonly ConfigDocument[]): readonly PlanEntry[] {
  return documents.map((document) => {
    const plan = document.data as Plan;

    return {
      // The heading already names the directory, so the row carries the file alone.
      file: document.file === null ? '(in memory)' : basename(document.file),
      target:
        typeof plan.workflow === 'string'
          ? { kind: 'workflow', id: plan.workflow }
          : { kind: 'action', action: plan.workflow.action },
      presets: Object.keys(plan.presets),
    };
  });
}

function columns(rows: readonly (readonly string[])[]): readonly string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }

  // The last cell of a row never needs padding, and trailing spaces would show
  // up in every output snapshot.
  return rows.map((row) =>
    row
      .map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)))
      .join('  ')
      .trimEnd(),
  );
}

function indent(lines: readonly string[], depth: number): readonly string[] {
  const prefix = '  '.repeat(depth);
  return lines.map((line) => `${prefix}${line}`);
}

function workflowLines(entries: readonly WorkflowEntry[]): readonly string[] {
  if (entries.length === 0) return indent(['(none declared)'], 1);

  return indent(
    columns(
      entries.map((entry) => [
        entry.id,
        entry.variantOf === null ? '' : `variant of ${entry.variantOf}`,
      ]),
    ),
    1,
  );
}

function actionLines(generations: readonly GenerationEntry[]): readonly string[] {
  if (generations.length === 0) return indent(['(none declared)'], 1);

  return generations.flatMap((generation) => [
    ...indent([generation.id], 1),
    ...indent(
      generation.actions.length === 0
        ? ['(no actions declared)']
        : columns(
            generation.actions.map((action) => [
              action.id,
              action.type,
              action.alias === null ? '' : `alias ${action.alias}`,
            ]),
          ),
      2,
    ),
  ]);
}

function planLines(entries: readonly PlanEntry[]): readonly string[] {
  if (entries.length === 0) return indent(['(none declared)'], 1);

  return indent(
    columns(
      entries.map((entry) => [
        entry.file,
        entry.target.kind === 'workflow'
          ? `workflow ${entry.target.id}`
          : `action ${entry.target.action}`,
        entry.presets.length === 0 ? '(no presets)' : `presets ${entry.presets.join(', ')}`,
      ]),
    ),
    1,
  );
}

/**
 * Only what the filters will actually show. Two consequences, both deliberate: an
 * absent catalog is an empty section rather than a failure, because `list`
 * reports what the mount declares rather than demanding a complete one; and
 * `list --plans` is not failed by a broken `workflows.yaml` it was never going to
 * render. An absent *mount* is still a failure, which falls out of every
 * requested section being absent at once.
 */
function wants(filters: ListFilters): readonly Want[] {
  return [
    ...(filters.actions ? [{ kind: 'file', name: 'actions', required: false } satisfies Want] : []),
    ...(filters.workflows
      ? [{ kind: 'file', name: 'workflows', required: false } satisfies Want]
      : []),
    ...(filters.plans ? [{ kind: 'plans' } satisfies Want] : []),
  ];
}

function section(
  label: string,
  where: string,
  document: ConfigDocument | undefined,
  render: (document: ConfigDocument) => readonly string[],
): string {
  return document === undefined
    ? `${label} — nothing at ${where}`
    : [`${label} — ${where}`, ...render(document)].join('\n');
}

function render(context: ListContext, loaded: LoadedConfigSet, origin: string): string {
  const under = (name: string): string => join(origin, name);
  const filters: ListFilters = context.filters;
  const sections: string[] = [];

  const planDocuments = [...loaded.documents.entries()]
    .filter(([file]) => file.startsWith(`${PLANS_SUBDIRECTORY}/`))
    .map(([, document]) => document);

  if (filters.workflows) {
    sections.push(
      section('workflows', under('workflows.yaml'), loaded.documents.get('workflows.yaml'), (d) =>
        workflowLines(readWorkflows(d)),
      ),
    );
  }

  if (filters.actions) {
    sections.push(
      section('actions', under('actions.yaml'), loaded.documents.get('actions.yaml'), (d) =>
        actionLines(readActions(d)),
      ),
    );
  }

  if (filters.plans) {
    const where = `${under(PLANS_SUBDIRECTORY)}/`;
    sections.push(
      planDocuments.length === 0
        ? `plans — nothing at ${where}`
        : [`plans — ${where}`, ...planLines(readPlans(planDocuments))].join('\n'),
    );
  }

  return sections.join('\n\n');
}

export function list(context: ListContext, io: ListIo): ExitCode {
  const loaded = loadConfigSet({
    source: io.source,
    schemas: io.schemas ?? schemaRegistry(),
    want: wants(context.filters),
    ignoreVersion: context.ignoreVersion,
    // A discovery command has no reason to stop at the first bad file: an author
    // pointing `list` at an unfamiliar mount wants the whole picture.
    mode: 'collect',
  });

  reportDiagnostics(io.logger, loaded.diagnostics);

  const exit = exitCodeFor(loaded.diagnostics);
  if (exit !== ExitCode.Success) return exit;

  // Nothing to enumerate at all: an unmounted or empty directory, which for a
  // discovery command is a failed invocation rather than an empty answer.
  if (loaded.documents.size === 0) {
    io.logger.error(`no config set to list under ${io.source.origin}`);
    return ExitCode.Configuration;
  }

  io.logger.print(render(context, loaded, io.source.origin));
  return ExitCode.Success;
}
