import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import Icons from 'unplugin-icons/vite'
import { defineConfig } from 'vitest/config'

// Standalone rather than derived from vite.config.ts: a test run needs the plugins but
// none of the dev server, the PWA manifest or the proxy.
export default defineConfig({
  plugins: [vue(), Icons({ compiler: 'vue3' })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { name: 'frontend', include: ['src/**/*.test.ts'], environment: 'happy-dom' },
})
