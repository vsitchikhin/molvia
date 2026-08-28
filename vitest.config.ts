import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const pwaSrc = fileURLToPath(new URL('./apps/pwa/src', import.meta.url))

// Three projects rather than one config: the domain must keep running without a DOM,
// and a component test must not be able to reach a real database by accident.
export default defineConfig({
  test: {
    projects: [
      {
        test: { name: 'domain', include: ['packages/**/*.test.ts'], environment: 'node' },
      },
      {
        test: { name: 'api', include: ['apps/api/**/*.test.ts'], environment: 'node' },
      },
      {
        plugins: [vue()],
        resolve: { alias: { '@': pwaSrc } },
        test: { name: 'pwa', include: ['apps/pwa/**/*.test.ts'], environment: 'happy-dom' },
      },
    ],
  },
})
