/// <reference types="vitest/config" />
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
        all: true
    }
  },
})