import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    globals: true,
    // Rate limiting tests use forks pool
    fileParallelism: true,
    pool: 'forks',
    poolOptions: {
      forks: {
        isolate: true,
        minForks: 1,
        maxForks: 1, // Run serially to avoid rate limit conflicts between tests
      },
    },
    teardownTimeout: 15000,
    // Only include the rate limiting integration test file
    include: ['**/authentication/test/integration/rate_limiting.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
    ],
    env: {
      NODE_ENV: 'test',
      // Enable rate limiting via NODE_CONFIG
      NODE_CONFIG: JSON.stringify({
        rateLimit: {
          enabled: true,
        },
      }),
    },
  },
  resolve: {
    alias: {
      '@': '/src',
      'iso-639-1-dir': '/node_modules/iso-639-1-dir/dist/index.mjs',
    },
  },
});
