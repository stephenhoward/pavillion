import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueI18n from '@intlify/unplugin-vue-i18n/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(),vueI18n({
    runtimeOnly: false
  })],
  build: {
    manifest: true,
    rollupOptions: {
      input: "./src/client/app.ts",
    },
  },
});