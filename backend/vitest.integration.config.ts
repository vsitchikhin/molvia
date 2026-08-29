import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Needs a real Postgres: the global setup creates this copy's test database and migrates
// it. `make up` first, or the setup says so and stops.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    name: 'backend:integration',
    include: ['tests/**/*.integration.test.ts'],
    environment: 'node',
    globalSetup: ['./tests/setup-db.ts'],
  },
})
