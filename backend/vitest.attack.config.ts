import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Adversarial passes only, and never part of `make check`: in these files **green means the
 * defect is alive**. They are copied in from `.scratch/tasks/selftests/` for a run and are
 * git-ignored, because the repository holds what ships, not what proves it is broken.
 */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    name: 'backend:attack',
    include: ['tests/**/*.attack.integration.test.ts'],
    environment: 'node',
    globalSetup: ['./tests/setup-db.ts'],
    fileParallelism: false,
  },
})
