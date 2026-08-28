import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import Icons from 'unplugin-icons/vite'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const src = fileURLToPath(new URL('./src', import.meta.url))

// Ports come from the working copy's .env, so two copies never fight over one port.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '')

  return {
    plugins: [
      vue(),
      // MDI through Iconify: icons are inlined as components at build time, so only the
      // ones actually used ship, no icon font is downloaded, and colour comes from
      // currentColor — which means they obey the tokens like any other element.
      Icons({ compiler: 'vue3' }),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: 'Molvia',
          short_name: 'Molvia',
          start_url: '/',
          display: 'standalone',
          theme_color: '#1b1b1f',
          background_color: '#ffffff',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
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
