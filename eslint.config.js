import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * The console/stdout ban is the enforcement half of the redaction guarantee
 * (NFR-003): every line the engine emits leaves through the one function that
 * consults the secret registry, so a call site cannot opt out by reaching for
 * `console.log`. The `process.exit` ban is the enforcement half of "flush
 * before exit" — the CLI returns an ExitCode up the stack and lets the process
 * drain instead of truncating the tail of a log.
 *
 * Both land in the first slice rather than after the first violation, because a
 * guarantee that is only intended decays the moment someone is in a hurry.
 * See implementation/stack.md §7.
 */
const forbiddenProcessWrites = [
  {
    object: 'process',
    property: 'stdout',
    message: 'Write through the logger (src/cross/logging) — see stack.md §7.',
  },
  {
    object: 'process',
    property: 'stderr',
    message: 'Write through the logger (src/cross/logging) — see stack.md §7.',
  },
  {
    object: 'process',
    property: 'exit',
    message: 'Return an ExitCode and let the process drain — see stack.md §7.',
  },
];

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**', '.tmp/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': 'error',
      'no-restricted-properties': ['error', ...forbiddenProcessWrites],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    // The only module allowed to touch the process streams.
    files: ['packages/engine/src/cross/logging/**/*.ts'],
    rules: {
      'no-console': 'off',
      'no-restricted-properties': 'off',
    },
  },
  {
    // Repository tooling, not engine modules: these are meant to print.
    files: ['scripts/**/*.ts', 'packages/*/scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
      'no-restricted-properties': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/test/support/**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  {
    // Plain JavaScript by necessity: the published bin shim, because node cannot
    // strip types from a file inside node_modules (stack.md §1), and this file,
    // which eslint loads itself.
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
);
