import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
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
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/tests/e2e/**',
      '**/*.e2e.test.ts',
    ],
    coverage: {
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
