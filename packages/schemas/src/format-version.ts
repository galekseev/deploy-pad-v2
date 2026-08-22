/**
 * The config format version the schemas in this package describe — the value a
 * config file's `version:` key must carry.
 *
 * This package's **major version equals this number**, which is what turns
 * TC-4 ("exactly one supported format version at a time") into a packaging
 * property rather than a convention someone has to remember: an engine that
 * depends on `@deploy-pad/schemas@^2` cannot be handed format 3 schemas.
 * `scripts/check-versions.ts` fails the build if the two ever disagree.
 *
 * @see implementation/stack.md §6 — The schemas package
 */
export const CONFIG_FORMAT_VERSION = 2;
