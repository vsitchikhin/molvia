import { defineConfig } from 'vitest/config'

// The repository-wide run. Each module owns its own vitest.config.ts — this only gathers
// them, so `npm test` at the root and `npm test` inside a module cannot disagree.
export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'backend/vitest.config.ts',
      'backend/vitest.integration.config.ts',
      'bot',
      'deploy/watch',
      'frontend',
      // The repository's own tools (MOL-266): the time reporter below and the check of the clocks.
      { test: { name: 'bin', include: ['bin/*.test.ts'], environment: 'node' } },
    ],
    // The rule of MOL-243 on every run of the whole suite: CI's and `make check`'s, never a module's own.
    // Red only on CI: here the machine is shared by every copy, and a run there is the one that counts.
    reporters: ['default', ['./bin/test-time-reporter.ts', { fail: Boolean(process.env.CI) }]],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['frontend/src/**', 'backend/src/**', 'bot/src/**', 'packages/*/src/**'],
      exclude: ['**/*.test.ts', '**/main.ts'],
      // A threshold only where coverage means something. The domain is pure functions
      // with no excuse for an untested branch; a view or a bootstrap file would be gamed
      // into compliance instead of tested.
      thresholds: {
        'packages/model/src/**': { statements: 90, branches: 85, functions: 90, lines: 90 },
      },
    },
  },
})
