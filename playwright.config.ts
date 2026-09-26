import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

// Ports come from this working copy's .env, so e2e in one copy never drives another's stack.
try {
  process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url)))
} catch {
  // no .env in this environment — fall through to process.env
}

// The run has its own ports and its own database (MOL-60). Its own ports because
// `reuseExistingServer` would otherwise hand the suite the dev API whenever `make dev` is
// up — and pre-push runs e2e exactly then — so no DATABASE_URL of ours would ever reach a
// process. Its own database because a run used to leave a catalogue item and a purchase in
// the one a person types into by hand, and the suite degraded from that.
// All three are required, and none has a default: a default here is the ports of copy 0,
// so a copy whose .env lost only the ports would quietly move into another copy's band and
// fight it for 3301 — harder to diagnose than not starting at all.
const apiPort = process.env.E2E_API_PORT
const pwaPort = process.env.E2E_PWA_PORT
const databaseUrl = process.env.E2E_DATABASE_URL
if (!apiPort || !pwaPort || !databaseUrl) {
  const missing = Object.entries({
    E2E_API_PORT: apiPort,
    E2E_PWA_PORT: pwaPort,
    E2E_DATABASE_URL: databaseUrl,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name)
  // Each name carries its own verb rather than sharing one: this text is grepped for a
  // single variable at least as often as it is read whole.
  throw new Error(
    `${missing.map((name) => `${name} is not set`).join(', ')}. A copy whose .env predates ` +
      'MOL-60 needs them once: bin/init-env.sh <index> --force',
  )
}

const baseURL = `http://127.0.0.1:${pwaPort}`
const ci = Boolean(process.env.CI)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  reporter: ci ? 'github' : 'list',
  // A trace of every failure outside CI (MOL-67): there are no retries here, so `on-first-retry`
  // never wrote one, and a flake met on pre-push left nothing behind but its message.
  use: { baseURL, trace: ci ? 'on-first-retry' : 'retain-on-failure', locale: 'en-US' },

  // One project, and it is a phone: that is the device the product is designed for,
  // so a desktop-only pass would prove nothing about the screen that matters.
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],

  webServer: [
    {
      // The database is recreated first, in the command of the server that needs it rather
      // than in an npm script: `npx playwright test` is what gets typed while debugging a
      // spec, and it would walk past a preparation step of its own.
      command: 'node bin/e2e-database.mjs && npm run start -w @molvia/backend',
      url: `http://127.0.0.1:${apiPort}/health`,
      // No central bank in a test run: its answer would decide the outcome (MOL-39).
      env: {
        RATES_REFRESH: 'off',
        API_PORT: apiPort,
        DATABASE_URL: databaseUrl,
        TELEGRAM_BOT_USERNAME: 'molvia_test_bot',
        BOT_API_SECRET: 'e'.repeat(43),
      },
      // Never reuse: on these ports there is nothing of ours to reuse, and a server left by
      // a crashed run must fail loudly instead of quietly answering with old code.
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: 'npm run dev -w @molvia/frontend',
      url: baseURL,
      // Vite reads both from loadEnv(mode, root, ''), where process.env wins over .env: the
      // port it binds and the API its proxy points at.
      env: { PWA_PORT: pwaPort, API_PORT: apiPort },
      reuseExistingServer: false,
      stdout: 'pipe',
    },
  ],
})
