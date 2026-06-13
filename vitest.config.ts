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
    //  - dompurify-isolated: forks pool + node environment for any test
    //    that transitively imports `isomorphic-dompurify`. The vmThreads
    //    pool cannot evaluate `@exodus/bytes` (an ESM-in-CJS package
    //    pulled in by isomorphic-dompurify's transitive deps); the forks
    //    pool handles it natively. Add a test file here when its module
    //    graph reaches `renderPolicyMarkdown` or any other consumer of
    //    isomorphic-dompurify.
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
            // Rate-limit coverage guard: transitively imports the full domain
            // graph (reaching isomorphic-dompurify) AND only detects limiters
            // when config rateLimit.enabled is true. It must run EXCLUSIVELY via
            // vitest.ratelimiting.config.ts (NODE_CONFIG rateLimit.enabled=true,
            // forks pool), exactly like the domain rate_limiting.test.ts files.
            'src/server/common/test/rate-limit-coverage.test.ts',
            'src/common/test/utils/render-markdown.test.ts',
            'src/server/configuration/test/service_settings.test.ts',
            // Imports the full @/server/server entry module, whose graph reaches
            // renderPolicyMarkdown → isomorphic-dompurify.
            'src/server/test/configure-proxy.test.ts',
            // Tests that transitively import ServiceSettings (which depends on renderPolicyMarkdown)
            'src/server/accounts/test/account_service.test.ts',
            'src/server/accounts/test/admin_pagination.test.ts',
            'src/server/accounts/test/api.test.ts',
            'src/server/authentication/test/api.test.ts',
            'src/server/authentication/test/auth_service.test.ts',
            'src/server/configuration/test/api.test.ts',
            'src/server/activitypub/test/api/calendar-actor.test.ts',
            'src/server/moderation/test/api/admin-instance.test.ts',
            'src/server/moderation/test/api/admin-report-forward.test.ts',
            'src/server/moderation/test/api/admin-settings.test.ts',
            'src/server/moderation/test/api/analytics.test.ts',
            'src/server/moderation/test/api/blocked-reporters.test.ts',
            'src/server/moderation/test/api/owner-report-forward.test.ts',
            'src/server/moderation/test/service/auto-escalation.test.ts',
            'src/server/moderation/test/service/moderation.test.ts',
            // Frontend tests that transitively import renderPolicyMarkdown
            'src/client/test/components/logged_out/instance-policy.test.ts',
          ],
          env: { NODE_ENV: 'test' },
        },
      },
      {
        plugins: [vue()],
        resolve: { alias: sharedAliases },
        test: {
          name: 'dompurify-isolated',
          environment: 'node',
          globals: true,
          pool: 'forks',
          include: [
            'src/common/test/utils/render-markdown.test.ts',
            'src/server/configuration/test/service_settings.test.ts',
            // Imports the full @/server/server entry module, whose graph reaches
            // renderPolicyMarkdown → isomorphic-dompurify.
            'src/server/test/configure-proxy.test.ts',
            // Tests that transitively import ServiceSettings (which depends on renderPolicyMarkdown)
            'src/server/accounts/test/account_service.test.ts',
            'src/server/accounts/test/admin_pagination.test.ts',
            'src/server/accounts/test/api.test.ts',
            'src/server/authentication/test/api.test.ts',
            'src/server/authentication/test/auth_service.test.ts',
            'src/server/configuration/test/api.test.ts',
            'src/server/activitypub/test/api/calendar-actor.test.ts',
            'src/server/moderation/test/api/admin-instance.test.ts',
            'src/server/moderation/test/api/admin-report-forward.test.ts',
            'src/server/moderation/test/api/admin-settings.test.ts',
            'src/server/moderation/test/api/analytics.test.ts',
            'src/server/moderation/test/api/blocked-reporters.test.ts',
            'src/server/moderation/test/api/owner-report-forward.test.ts',
            'src/server/moderation/test/service/auto-escalation.test.ts',
            'src/server/moderation/test/service/moderation.test.ts',
          ],
          env: { NODE_ENV: 'test' },
        },
      },
      {
        plugins: [vue()],
        resolve: { alias: sharedAliases },
        test: {
          name: 'dompurify-isolated-frontend',
          environment: 'happy-dom',
          globals: true,
          pool: 'forks',
          include: [
            // Frontend component tests that transitively import renderPolicyMarkdown
            'src/client/test/components/logged_out/instance-policy.test.ts',
          ],
          setupFiles: ['./src/client/test/lib/local-storage-stub.ts'],
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
