import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The domain is pure functions: no DOM, no database, nothing to set up.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { name: 'model', include: ['src/**/*.test.ts'], environment: 'node' },
})
