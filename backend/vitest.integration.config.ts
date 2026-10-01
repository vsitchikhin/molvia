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
    // A database per worker, copied from the migrated one (MOL-164), so the files run in
    // parallel: in one shared database they deleted each other's rows in `beforeEach` and failed
    // in a way that looks like a schema bug, which is why they once ran in turn — 85 s of CI.
    setupFiles: ['./tests/setup-worker.ts'],
  },
})
