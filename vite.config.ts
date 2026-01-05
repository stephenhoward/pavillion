import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tsconfigPaths from 'vite-tsconfig-paths';
import { fileURLToPath } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [tsconfigPaths(), vue()],
  server: {
    // Listen on all interfaces for container development
    host: '0.0.0.0',
    // Use default Vite port (5173) to match hardcoded template URLs
    port: 5173,
    // HMR configuration for containerized development
    hmr: {
      // Use environment variable or default to localhost for browser connection
      host: process.env.VITE_HMR_HOST || 'localhost',
      port: 5173,
    },
    // File watching configuration
    watch: {
      // Use polling in Docker environments where filesystem events aren't reliable
      usePolling: process.env.CHOKIDAR_USEPOLLING === 'true',
    },
  },
  build: {
    manifest: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        client: "./src/client/app.ts",
        site: "./src/site/app.ts",
        widget: "./src/widget/app.ts",
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: `modern-compiler`,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Ensure JSON imports work properly for i18next translation files
      '@/client/locale': fileURLToPath(new URL('./src/client/locale', import.meta.url)),
      '@/site/locale': fileURLToPath(new URL('./src/site/locale', import.meta.url)),
      // Fix iso-639-1-dir package exports issue
      'iso-639-1-dir': '/node_modules/iso-639-1-dir/dist/index.mjs',
    },
  },
});
