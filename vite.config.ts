import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tsconfigPaths from 'vite-tsconfig-paths';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [tsconfigPaths(), vue()],
  build: {
    manifest: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        client: "./src/client/app.ts",
        site: "./src/site/app.ts",
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
      // Ensure JSON imports work properly for i18next translation files
      '@/client/locale': '/src/client/locale',
      '@/site/locale': '/src/site/locale',
      // Fix iso-639-1-dir package exports issue
      'iso-639-1-dir': '/node_modules/iso-639-1-dir/dist/index.mjs',
    },
  },
});