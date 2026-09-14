import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Three guarantees, enforced rather than intended, because one that is only
 * intended decays the moment someone is in a hurry.
 *
 * The console/stdout ban is the enforcement half of redaction (NFR-003): every
 * line the engine emits leaves through the one function that consults the secret
 * registry, so a call site cannot opt out by reaching for `console.log`. The
 * `process.exit` ban is the enforcement half of "flush before exit" — the CLI
 * returns an ExitCode up the stack and lets the process drain instead of
 * truncating the tail of a log. Both landed with the scaffold (stack.md §7).
 *
 * The `process.env` ban is the enforcement half of the purity invariant
 * (stack.md §4): the resolution rules take the environment as an argument rather
 * than reaching for it, so they stay runnable outside node — which is what a
 * browser-side consumer of the same rules needs, and what keeps a test from
 * mutating a global to set one variable. It lands before the code it constrains,
 * while there is nothing to fix.
 */
const forbiddenProcessAccess = [
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
  {
    object: 'process',
    property: 'env',
    message:
      'Take the environment as an argument; only the CLI reads it — see stack.md §4.',
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
      'no-restricted-properties': ['error', ...forbiddenProcessAccess],
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
    // The one engine module allowed to read the environment. It already owns the
    // mount's `.env`, so it is where the map the resolvers are handed comes from
    // (stack.md §4). Narrowed rather than switched off: this file still may not
    // exit the process or write to a stream.
    files: ['packages/engine/src/cross/env-file.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...forbiddenProcessAccess.filter((entry) => entry.property !== 'env'),
      ],
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
