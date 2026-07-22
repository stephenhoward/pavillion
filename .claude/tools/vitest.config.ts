import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the .claude/tools suite.
 *
 * The root vitest.config.ts only includes src/** projects, so these tests
 * are invisible to a bare `npx vitest run`. Run this suite from the repo
 * root with:
 *
 *   npx vitest run --config .claude/tools/vitest.config.ts
 */
export default defineConfig({
  test: {
    include: ['.claude/tools/test/**/*.test.ts'],
    environment: 'node',
  },
});
