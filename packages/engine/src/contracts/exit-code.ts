/**
 * The closed set of exit codes, from [cli.md → Exit codes](../../../../docs/specs/cli.md#exit-codes).
 *
 * The contract with CI is that these never shift (FR-CLI-005), which is why
 * call sites name a member instead of writing a number, and why a contract test
 * asserts this table against the one in the spec.
 *
 * A `const` object rather than a TypeScript `enum`: `erasableSyntaxOnly` keeps
 * the engine inside the same syntax budget operator check scripts must live in
 * (stack.md §1), and an enum is not erasable.
 */
export const ExitCode = {
  Success: 0,
  Configuration: 1,
  Validation: 2,
  Repository: 3,
  StepExecution: 4,
  Verification: 5,
  Preflight: 6,
  MultisigWaiting: 10,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * The label each code carries in the spec's table — the text before the em dash.
 * Kept here so a rendered outcome and the documentation cannot drift apart, and
 * so the contract test has something exact to compare.
 */
export const EXIT_CODE_LABELS = {
  0: 'Success',
  1: 'Configuration error',
  2: 'Validation error',
  3: 'Repository error',
  4: 'Step execution error',
  5: 'Verification error',
  6: 'Preflight error',
  10: 'Waiting',
} as const satisfies Record<ExitCode, string>;

export const EXIT_CODES: readonly ExitCode[] = Object.freeze(Object.values(ExitCode));

export function exitCodeLabel(code: ExitCode): string {
  return EXIT_CODE_LABELS[code];
}
