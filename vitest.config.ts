import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import Icons from 'unplugin-icons/vite'
import { defineConfig } from 'vitest/config'

const pwaSrc = fileURLToPath(new URL('./apps/pwa/src', import.meta.url))

// Three projects rather than one config: the domain must keep running without a DOM,
// and a component test must not be able to reach a real database by accident.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['apps/*/src/**', 'packages/*/src/**'],
      exclude: ['**/*.test.ts', '**/main.ts', '**/index.html'],
      // A threshold only where coverage means something. The domain is pure functions
      // with no excuse for an untested branch; a Vue view or a bootstrap file would just
      // be gamed into compliance.
      thresholds: {
        'packages/model/src/**': {
          statements: 90,
          branches: 85,
          functions: 90,
          lines: 90,
        },
      },
    },
    projects: [
      {
        test: { name: 'domain', include: ['packages/**/*.test.ts'], environment: 'node' },
      },
      {
        test: {
          name: 'api',
          include: ['apps/api/**/*.test.ts'],
          exclude: ['**/*.integration.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['apps/api/**/*.integration.test.ts'],
          environment: 'node',
          globalSetup: ['./apps/api/tests/setup-db.ts'],
        },
      },
      {
        plugins: [vue(), Icons({ compiler: 'vue3' })],
        resolve: { alias: { '@': pwaSrc } },
        test: { name: 'pwa', include: ['apps/pwa/**/*.test.ts'], environment: 'happy-dom' },
      },
    ],
  },
})
