/**
 * Turning ajv's error array into the errors an author actually made.
 *
 * With `allErrors` on, a schema built from `oneOf` reports every branch it tried.
 * One typo — `method: create9` on a workflow step — produces eight errors: the
 * enum failure that is the real mistake, then "must have required property
 * workflow", "must NOT have additional properties action", the same for `method`,
 * the `oneOf` itself, and three more from the outer `oneOf` that chooses between
 * a workflow and a variant. Handing that to an author is worse than handing them
 * nothing, because six of the eight describe a document they were not writing.
 *
 * The rule that recovers the signal: a failing `oneOf` or `anyOf` marks a point
 * where ajv **guessed**, so its whole subtree is speculative.
 *
 *   1. Errors with no failing combinator above them are real. They pass through.
 *   2. Every other error is attributed to the **outermost** combinator enclosing
 *      it — the whole guessed-at subtree is one story, and nesting a group
 *      inside a group would let the outer one's rejected branches survive as if
 *      they were separate mistakes.
 *   3. Inside a group, the deepest errors are the specific ones and the
 *      shallower ones are the branches ajv discarded on the way down. Keep the
 *      deepest.
 *
 * Independent mistakes sit under different combinators, so each is reported —
 * which is what keeps this compatible with reporting every error (NFR-022)
 * rather than a cheap "show the first one" in disguise.
 *
 * Pure, and the reason it is its own module: it is the piece of gate 2 most
 * worth testing directly.
 */
import type { ErrorObject } from 'ajv';

/** Combinators whose failure means ajv tried several shapes and none fit. */
const GUESS_KEYWORDS = new Set(['oneOf', 'anyOf']);

function depth(instancePath: string): number {
  return instancePath === '' ? 0 : instancePath.split('/').length - 1;
}

/** True when `ancestor` is the same node as `path` or encloses it. */
function encloses(ancestor: string, path: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

export function reduceSchemaErrors(errors: readonly ErrorObject[]): readonly ErrorObject[] {
  const guessPaths = errors
    .filter((error) => GUESS_KEYWORDS.has(error.keyword))
    .map((error) => error.instancePath);

  const groups = new Map<string, ErrorObject[]>();
  const free: ErrorObject[] = [];

  for (const error of errors) {
    // The combinator error itself says only "none of these fit", which the
    // errors it groups already say with specifics.
    if (GUESS_KEYWORDS.has(error.keyword)) continue;

    const owner = guessPaths
      .filter((path) => encloses(path, error.instancePath))
      .sort((left, right) => depth(left) - depth(right))[0];

    if (owner === undefined) {
      free.push(error);
      continue;
    }

    const members = groups.get(owner) ?? [];
    members.push(error);
    groups.set(owner, members);
  }

  const fromGroups = [...groups.values()].flatMap((members) => {
    const deepest = Math.max(...members.map((error) => depth(error.instancePath)));
    return members.filter((error) => depth(error.instancePath) === deepest);
  });

  // Back into ajv's original order, so the report follows the document rather
  // than the order the grouping happened to produce.
  return [...free, ...fromGroups].sort((left, right) => errors.indexOf(left) - errors.indexOf(right));
}
