import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

// Ports come from this working copy's .env, so e2e in one copy never drives another's stack.
try {
  process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url)))
} catch {
  // no .env in this environment — fall through to process.env
}

const apiPort = process.env.API_PORT ?? '3300'
const pwaPort = process.env.PWA_PORT ?? '5300'
const baseURL = `http://127.0.0.1:${pwaPort}`
const ci = Boolean(process.env.CI)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  reporter: ci ? 'github' : 'list',
  use: { baseURL, trace: 'on-first-retry', locale: 'en-US' },

  // One project, and it is a phone: that is the device the product is designed for,
  // so a desktop-only pass would prove nothing about the screen that matters.
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],

  webServer: [
    {
      command: 'npm run start -w @molvia/api',
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: !ci,
      stdout: 'pipe',
    },
    {
      command: 'npm run dev -w @molvia/pwa',
      url: baseURL,
      reuseExistingServer: !ci,
      stdout: 'pipe',
    },
  ],
})
