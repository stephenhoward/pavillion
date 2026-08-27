import { defineConfig, coverageConfigDefaults } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    globals: true,
    // Integration tests use forks pool because:
    // 1. They have fewer files, so RPC timeout issues don't occur
    // 2. The sqlite3 native module crashes with vmThreads during cleanup
    fileParallelism: true,
    pool: 'forks',
    poolOptions: {
      forks: {
        isolate: true,
        minForks: 1,
        maxForks: 4,
      },
    },
    teardownTimeout: 15000,
    include: ['**/integration/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.claude/worktrees/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/tests/e2e/**',
      '**/*.e2e.test.ts',
      // Exclude rate limiting tests - run separately with test:ratelimiting
      '**/test/integration/rate_limiting.test.ts',
      // Exclude widget tests - they need DOM and run with unit tests
      '**/widget/test/integration/**',
    ],
    coverage: {
      // Coverage is measured for the weekly report (.github/workflows/
      // coverage.weekly.yaml), which is a gap list: a file no test ever imports
      // must show as 0%, not vanish. V8's default is to report only files the
      // run actually loaded, so `include` below is what makes an untested file
      // visible at all. Expect a much lower headline number than an
      // imported-files-only report would show — that is the measurement
      // working, not a regression.
      provider: 'v8',
      include: ['src/**/*.{ts,vue}'],
      exclude: [
        ...coverageConfigDefaults.exclude,
        '**/test/**',
        '**/test-utils/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/locales/**',
        'src/**/assets/**',
      ],
      reporter: ['text-summary', 'json-summary'],
      // Each tier writes its own report; scripts/coverage-summary.ts reads both
      // and keeps the columns separate, because unit and integration coverage
      // answer different questions about a file.
      reportsDirectory: './coverage/integration',
      reportOnFailure: true,
    },
    env: {
      NODE_ENV: 'test',
    },
  },
  resolve: {
    alias: {
      '@': '/src',
      'iso-639-1-dir': '/node_modules/iso-639-1-dir/dist/index.mjs',
    },
  },
});
