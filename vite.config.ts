import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueI18n from '@intlify/unplugin-vue-i18n/vite'
import tsconfigPaths from 'vite-tsconfig-paths'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [tsconfigPaths(), vue(), vueI18n({
    runtimeOnly: false
  })],
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
});