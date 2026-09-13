import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

// Needs a real Postgres: the global setup creates this copy's test database and migrates
// it. `make up` first, or the setup says so and stops.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    name: 'backend:integration',
    include: ['tests/**/*.integration.test.ts'],
    // Attack files from an adversarial pass are green while the defect is alive, so they
    // must never join a run where green means «works». They live in `.scratch`, but they
    // can only be *executed* from here — they need `@/db/schema`, the fixtures and the
    // module alias — so the copy is the workflow, not sloppiness. `npm run test:attack`
    // runs them on purpose; nothing else picks them up.
    exclude: [...configDefaults.exclude, '**/*.attack.*'],
    environment: 'node',
    globalSetup: ['./tests/setup-db.ts'],
    // One database, shared by every file: run them in turn. In parallel they delete each
    // other's rows in `beforeEach` and fail in a way that looks like a schema bug.
    fileParallelism: false,
  },
})
