import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

const sharedExclude = [
  '**/node_modules/**',
  '**/dist/**',
  '**/cypress/**',
  '**/.{idea,git,cache,output,temp}/**',
  '**/tests/e2e/**',
  '**/*.e2e.test.ts',
  '**/entrypoint.test.ts', // Docker/container tests - run separately with federation tests
  '**/docker-build.test.ts', // Docker build tests - require Docker environment
  '**/docker-compose.test.ts', // Docker compose tests - require Docker environment
  // Exclude server integration tests - run separately with test:integration
  '**/server/**/test/integration/**',
  // Exclude git worktrees used by subagents — stale tests from old worktrees
  // should never be collected in the main project's test run.
  '**/.claude/worktrees/**',
];

const sharedAliases = {
  '@': '/src',
  'iso-639-1-dir': '/node_modules/iso-639-1-dir/dist/index.mjs',
};

export default defineConfig({
  plugins: [vue()],
  test: {
    // Two-project layout:
    //  - default: vmThreads pool for the bulk of unit tests (Sequelize
    //    isolation, low RPC overhead).
    //  - render-markdown: forks pool for any test that imports
    //    `isomorphic-dompurify`, which transitively loads `@exodus/bytes`
    //    (an ESM-in-CJS package). The vmThreads pool cannot evaluate that
    //    without a Vite SSR transform; the forks pool handles it natively.
    projects: [
      {
        plugins: [vue()],
        resolve: { alias: sharedAliases },
        test: {
          name: 'default',
          environment: 'happy-dom',
          globals: true,
          fileParallelism: true,
          pool: 'vmThreads',
          poolOptions: {
            vmThreads: {
              minThreads: 1,
              maxThreads: 4,
            },
          },
          teardownTimeout: 15000,
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          exclude: [
            ...sharedExclude,
            'src/common/test/utils/render-markdown.test.ts',
          ],
          env: { NODE_ENV: 'test' },
        },
      },
      {
        plugins: [vue()],
        resolve: { alias: sharedAliases },
        test: {
          name: 'render-markdown',
          environment: 'node',
          globals: true,
          pool: 'forks',
          include: ['src/common/test/utils/render-markdown.test.ts'],
          env: { NODE_ENV: 'test' },
        },
      },
    ],
    coverage: {
      reportOnFailure: true,
    },
  },
  resolve: {
    alias: sharedAliases,
  },
});
