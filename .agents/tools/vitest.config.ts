import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the agent-tooling suite: the CLIs in .agents/tools plus
 * any scripts a skill ships alongside its SKILL.md.
 *
 * The root vitest.config.ts only includes src/** projects, so these tests
 * are invisible to a bare `npx vitest run`. Run this suite from the repo
 * root with:
 *
 *   npx vitest run --config .agents/tools/vitest.config.ts
 */
export default defineConfig({
  test: {
    include: [
      '.agents/tools/test/**/*.test.ts',
      '.agents/skills/**/scripts/test/**/*.test.ts',
    ],
    environment: 'node',
  },
});
