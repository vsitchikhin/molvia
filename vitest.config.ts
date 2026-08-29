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
      'frontend',
    ],
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
