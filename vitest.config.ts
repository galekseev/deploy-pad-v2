import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'test/**/*.test.ts'],
    // Every test that runs the engine asserts on captured output; a shared
    // process makes that racy for no gain at this suite size.
    pool: 'forks',
    reporters: ['default'],
  },
});
