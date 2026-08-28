import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

// Ports come from the working copy's .env, so two copies never fight over one port.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '')

  return {
    plugins: [
      vue(),
      tailwindcss(),
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
    server: {
      port: Number(env.PWA_PORT ?? 5300),
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${env.API_PORT ?? 3300}`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
