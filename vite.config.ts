import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tsconfigPaths from 'vite-tsconfig-paths'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [tsconfigPaths(), vue()],
  build: {
    manifest: true,
    sourcemap: true,
    rollupOptions: {
      input: "./src/client/app.ts",
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
      '@/client/locale': '/src/client/locale'
    }
  }
});