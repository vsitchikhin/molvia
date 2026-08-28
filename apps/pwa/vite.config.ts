import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const src = fileURLToPath(new URL('./src', import.meta.url))

// Ports come from the working copy's .env, so two copies never fight over one port.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '')

  return {
    plugins: [
      vue(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: 'Molvia',
          short_name: 'Molvia',
          start_url: '/',
          display: 'standalone',
          theme_color: '#1b1b1f',
          background_color: '#ffffff',
        },
      }),
    ],
    resolve: { alias: { '@': src } },
    css: {
      preprocessorOptions: {
        // Mixins reach every component without an import line in each one.
        scss: { additionalData: '@use "@/styles/mixins" as *;\n' },
      },
    },
    server: {
      // Bound to 127.0.0.1, not to `localhost`, which may resolve to ::1 only — the API
      // and the e2e config both address this copy by its IPv4 loopback.
      host: '127.0.0.1',
      port: Number(env.PWA_PORT ?? 5300),
      // Without this Vite silently moves to the next free port when one is taken, and a
      // second working copy would quietly stop matching its own .env.
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${String(env.API_PORT ?? 3300)}`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
