import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit and use-case tests: no database, no setup. Integration lives in its own config
// (vitest.integration.config.ts) so a run without Docker still executes this half, and so
// a use-case test cannot reach a database by accident.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    name: 'backend',
    include: ['src/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts'],
    environment: 'node',
  },
})
