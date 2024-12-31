/// <reference types="vitest/config" />
import { configDefaults, defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    coverage: {
        all: true
    }
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  }
});
