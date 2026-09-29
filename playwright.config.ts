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

// A service worker exists only in a build, so one spec runs against the built app (MOL-132): on
// the next port of the copy's band — ten wide, the run takes +1 and +2 — derived rather than a
// variable of its own, so no copy's .env has to be made again for it. Its own folder, so a build
// the spec rewrites is never the one `make prod-build` or a deploy reads.
const previewPort = String(Number(pwaPort) + 1)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  reporter: ci ? 'github' : 'list',
  // A trace of every failure outside CI (MOL-67): there are no retries here, so `on-first-retry`
  // never wrote one, and a flake met on pre-push left nothing behind but its message. The price:
  // it is recorded for every test and dropped when it passes — measured at 12–22 % of a full run
  // (four pairs, 26.09.2026, ~66 s against ~59 s). And an overload that times a test out can
  // still lose it: it is saved while the context is torn down, which shares the test's timeout.
  use: { baseURL, trace: ci ? 'on-first-retry' : 'retain-on-failure', locale: 'en-US' },

  // A phone: that is the device the product is designed for, so a desktop-only pass would prove
  // nothing about the screen that matters. The second project is the same phone against the built
  // app, and holds only what needs a worker. The sheet runs on an iPhone's engine as well (MOL-80):
  // Safari does not focus a tapped button, and only WebKit shows what the sheet gives focus back
  // to. The rest of the suite stays on one engine — a second run of everything would double the
  // wait at every push for differences no other screen has.
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] }, testIgnore: /pwa-update\.spec\.ts$/ },
    {
      name: 'pwa',
      use: { ...devices['Pixel 7'], baseURL: `http://127.0.0.1:${previewPort}` },
      testMatch: /pwa-update\.spec\.ts$/,
    },
    { name: 'iphone', use: { ...devices['iPhone 14'] }, testMatch: 'sheet.spec.ts' },
  ],

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
    {
      // `preview` proxies `/api` as the dev server does, to the run's API.
      command:
        `npm run build -w @molvia/frontend -- --outDir dist-e2e --emptyOutDir && ` +
        `npm run preview -w @molvia/frontend -- --outDir dist-e2e --host 127.0.0.1 ` +
        `--port ${previewPort} --strictPort`,
      url: `http://127.0.0.1:${previewPort}`,
      // Plain http, certificates or not: the loopback is a secure context for a worker anyway.
      env: { API_PORT: apiPort, PWA_PLAIN_HTTP: '1' },
      reuseExistingServer: false,
      stdout: 'pipe',
      // A build first: a minute is not unusual on a busy machine.
      timeout: 180_000,
    },
  ],
})
