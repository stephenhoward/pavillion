import { defineConfig } from "vite";
import { fileURLToPath } from 'node:url';

/**
 * Vite configuration for building the standalone widget SDK
 *
 * This creates a self-contained IIFE bundle that can be embedded
 * on third-party websites with no external dependencies.
 */
export default defineConfig({
  build: {
    outDir: 'dist/widget',
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL('./src/widget-sdk/pavillion-widget.ts', import.meta.url)),
      name: 'PavillionWidget',
      fileName: 'pavillion-widget',
      formats: ['iife'],
    },
    minify: 'terser',
    sourcemap: true,
    target: 'es2015',
    rollupOptions: {
      output: {
        // No code splitting - single file bundle
        inlineDynamicImports: true,
        // Ensure predictable filename
        entryFileNames: 'pavillion-widget.js',
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
