import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    globals: true,
    // File-level parallelism is enabled using vitest's process isolation.
    // Each worker process gets its own module cache, creating a separate
    // Sequelize instance with its own SQLite :memory: database.
    // This provides true test isolation without modifying production code.
    fileParallelism: true,
    pool: 'forks',  // Use child_process.fork() for process-level isolation
    poolOptions: {
      forks: {
        // Each test file runs in isolation with fresh module state
        isolate: true,
      },
    },
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/tests/e2e/**',
      '**/*.e2e.test.ts',
      '**/entrypoint.test.ts', // Docker/container tests - run separately with federation tests
      '**/docker-build.test.ts', // Docker build tests - require Docker environment
      '**/docker-compose.test.ts', // Docker compose tests - require Docker environment
    ],
    coverage: {
      reportOnFailure: true,
    },
    // Ensure NODE_ENV is set to 'test' for all tests
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
