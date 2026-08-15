import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the agent-tooling suite: the CLIs in .claude/tools plus
 * any scripts a skill ships alongside its SKILL.md.
 *
 * The root vitest.config.ts only includes src/** projects, so these tests
 * are invisible to a bare `npx vitest run`. Run this suite from the repo
 * root with:
 *
 *   npx vitest run --config .claude/tools/vitest.config.ts
 */
export default defineConfig({
  test: {
    include: [
      '.claude/tools/test/**/*.test.ts',
      '.claude/skills/**/scripts/test/**/*.test.ts',
    ],
    environment: 'node',
  },
});
