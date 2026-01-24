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
    pool: 'vmThreads',  // Use VM-based threads for better isolation and RPC stability
    poolOptions: {
      vmThreads: {
        // Each test file runs in a separate VM context with isolated module state
        // This prevents Sequelize instance sharing while avoiding fork RPC timeouts
        minThreads: 1,
        maxThreads: 4,
      },
    },
    // Increase teardown timeout to allow workers to finish cleanup
    teardownTimeout: 15000,
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
