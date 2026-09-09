/**
 * `list` — the discovery command (FR-CLI-032).
 *
 * Reads the mount shallowly: what ids the config set declares, and nothing about
 * whether they are coherent. No schema gate runs here yet, so every shape is
 * narrowed defensively and an entry the reader cannot understand is listed
 * without its detail rather than dropped — for a discovery command, "this id
 * exists and I cannot read it" is more useful than silence. From S2 the gates run
 * first and the guesswork goes away.
 */
import { basename, join } from 'node:path';
import { ExitCode, type ListContext, type ListFilters } from '../contracts/index.ts';
import type { Logger } from '../cross/logging/index.ts';
import { PLANS_SUBDIRECTORY } from '../phases/phase-1/plan-ref.ts';
import type { ConfigDocument, ConfigSource, Read } from '../phases/phase-2/index.ts';

/** The one key of a config file that is not an entry of its catalog. */
const RESERVED_KEY = 'version';

interface WorkflowEntry {
  readonly id: string;
  readonly variantOf: string | null;
}

interface ActionEntry {
  readonly id: string;
  readonly type: string | null;
  readonly alias: string | null;
}

interface GenerationEntry {
  readonly id: string;
  readonly actions: readonly ActionEntry[];
}

type PlanTarget =
  | { readonly kind: 'workflow'; readonly id: string }
  | { readonly kind: 'action'; readonly action: string }
  | { readonly kind: 'unreadable' };

interface PlanEntry {
  readonly file: string;
  readonly target: PlanTarget;
  readonly presets: readonly string[];
}

function record(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Every key of a catalog file but the reserved one, in declaration order. */
function entryKeys(data: unknown): readonly string[] {
  const mapping = record(data);
  if (mapping === null) return [];
  return Object.keys(mapping).filter((key) => key !== RESERVED_KEY);
}

function readWorkflows(document: ConfigDocument): readonly WorkflowEntry[] {
  const mapping = record(document.data) ?? {};

  return entryKeys(document.data).map((id) => ({
    id,
    variantOf: text(record(mapping[id])?.['variantOf']),
  }));
}

function readActions(document: ConfigDocument): readonly GenerationEntry[] {
  const repos = record(document.data) ?? {};
  const generations: GenerationEntry[] = [];

  for (const repoId of entryKeys(document.data)) {
    const declared = record(record(repos[repoId])?.['generations']) ?? {};

    for (const [generationId, generation] of Object.entries(declared)) {
      const actions = record(record(generation)?.['actions']) ?? {};

      generations.push({
        id: `${repoId}.${generationId}`,
        actions: Object.entries(actions).map(([actionId, action]) => ({
          // The fully-qualified id, which is what a workflow step names.
          id: `${repoId}.${generationId}.${actionId}`,
          type: text(record(action)?.['type']),
          alias: text(record(action)?.['alias']),
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
function planTarget(data: unknown): PlanTarget {
  const workflow = record(data)?.['workflow'];

  const id = text(workflow);
  if (id !== null) return { kind: 'workflow', id };

  const action = text(record(workflow)?.['action']);
  if (action !== null) return { kind: 'action', action };

  return { kind: 'unreadable' };
}

function readPlans(documents: readonly ConfigDocument[]): readonly PlanEntry[] {
  return documents.map((document) => ({
    // The heading already names the directory, so the row carries the file alone.
    file: document.file === null ? '(in memory)' : basename(document.file),
    target: planTarget(document.data),
    presets: Object.keys(record(record(document.data)?.['presets']) ?? {}),
  }));
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
              action.type ?? '(no type)',
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
        describeTarget(entry.target),
        entry.presets.length === 0 ? '(no presets)' : `presets ${entry.presets.join(', ')}`,
      ]),
    ),
    1,
  );
}

function describeTarget(target: PlanTarget): string {
  switch (target.kind) {
    case 'workflow':
      return `workflow ${target.id}`;
    case 'action':
      return `action ${target.action}`;
    case 'unreadable':
      return '(no workflow declared)';
  }
}

interface Section {
  readonly heading: string;
  readonly lines: readonly string[];
}

type SectionOutcome =
  | { readonly kind: 'section'; readonly section: Section }
  | { readonly kind: 'absent'; readonly section: Section }
  | { readonly kind: 'failed'; readonly file: string; readonly reason: string };

/**
 * @param where The exact path read, so the heading answers "which file is this?"
 *              — the question a discovery command run against an unfamiliar mount
 *              is really asking.
 */
function section<T>(
  label: string,
  where: string,
  read: Read<T>,
  render: (value: T) => readonly string[],
): SectionOutcome {
  switch (read.kind) {
    case 'failed':
      return { kind: 'failed', file: read.file, reason: read.reason };
    case 'missing':
      return { kind: 'absent', section: { heading: `${label} — nothing at ${where}`, lines: [] } };
    case 'found':
      return { kind: 'section', section: { heading: `${label} — ${where}`, lines: render(read.value) } };
  }
}

function requested(filters: ListFilters, source: ConfigSource): readonly SectionOutcome[] {
  const under = (name: string): string => join(source.origin, name);
  const outcomes: SectionOutcome[] = [];

  if (filters.workflows) {
    outcomes.push(
      section('workflows', under('workflows.yaml'), source.read('workflows'), (document) =>
        workflowLines(readWorkflows(document)),
      ),
    );
  }

  if (filters.actions) {
    outcomes.push(
      section('actions', under('actions.yaml'), source.read('actions'), (document) =>
        actionLines(readActions(document)),
      ),
    );
  }

  if (filters.plans) {
    outcomes.push(
      section('plans', `${under(PLANS_SUBDIRECTORY)}/`, source.plans(), (documents) =>
        planLines(readPlans(documents)),
      ),
    );
  }

  return outcomes;
}

export function list(context: ListContext, source: ConfigSource, logger: Logger): ExitCode {
  const outcomes = requested(context.filters, source);

  const failed = outcomes.find((outcome) => outcome.kind === 'failed');
  if (failed?.kind === 'failed') {
    logger.error(`cannot read ${failed.file}: ${failed.reason}`);
    return ExitCode.Configuration;
  }

  // Nothing to enumerate at all: an unmounted or empty directory, which for a
  // discovery command is a failed invocation rather than an empty answer.
  if (outcomes.every((outcome) => outcome.kind === 'absent')) {
    logger.error(`no config set to list under ${source.origin}`);
    return ExitCode.Configuration;
  }

  const rendered = outcomes.flatMap((outcome) =>
    outcome.kind === 'failed' ? [] : [[outcome.section.heading, ...outcome.section.lines].join('\n')],
  );

  logger.print(rendered.join('\n\n'));
  return ExitCode.Success;
}
