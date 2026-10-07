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
// up — and `make e2e` runs exactly then — so no DATABASE_URL of ours would ever reach a
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

// Open Food Facts is a fake of its own (MOL-162), on the next port of the API's band: a run asks the
// real base nothing, and the hint is on — a contact set — only here and in production.
const offPort = String(Number(apiPort) + 1)

// The receipt reader is a fake too (MOL-127, Р-7), two ports further: the next one is the copy's own
// Tesseract (`make reader`). It answers every photo with the bench's reading of am-05, so a receipt
// taken in the browser is read, reviewed and recorded with no Tesseract on the machine.
const readerPort = String(Number(apiPort) + 3)

// The Serbian tax office's check of a receipt is a fake too (MOL-232), on the port after the reader's:
// it answers a receipt's link with a journal under a head that names nobody.
const pursPort = String(Number(apiPort) + 4)

// The scanner's camera is a file (MOL-98): Chromium films the barcode `globalSetup` draws, and a
// spec that wants the camera grants it — without the grant Chromium refuses, which is the case of
// «no permission». The full Chromium, not the headless shell every other spec runs in: the shell
// answers any `getUserMedia` with `NotSupportedError`, fake camera or not (measured 29.09.2026).
// `playwright install chromium` brings both, here and in CI.
// In this copy's own cache, not a shared temporary folder: two copies running e2e at once must not
// rewrite each other's. Handed to `globalSetup` through the environment, which it shares with this.
const barcodeVideo = fileURLToPath(
  new URL('./node_modules/.cache/molvia-e2e/barcode.y4m', import.meta.url),
)
process.env.MOLVIA_BARCODE_VIDEO = barcodeVideo
const FAKE_CAMERA = [
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-video-capture=${barcodeVideo}`,
]

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/barcode-video.ts',
  fullyParallel: true,
  forbidOnly: ci,
  // A test green only on a retry fails the run (MOL-164): a pull request merges only on a green CI,
  // and a flake passed quietly there is a flake nobody meets until it is red for good. The retries
  // stay, so the report says «flaky» rather than only «failed».
  retries: ci ? 2 : 0,
  failOnFlakyTests: ci,
  reporter: ci ? 'github' : 'list',
  // A trace of every failure outside CI (MOL-67): there are no retries here, so `on-first-retry`
  // never wrote one, and a flake met in a local run left nothing behind but its message. The price:
  // it is recorded for every test and dropped when it passes — measured at 12–22 % of a full run
  // (four pairs, 26.09.2026, ~66 s against ~59 s). And an overload that times a test out can
  // still lose it: it is saved while the context is torn down, which shares the test's timeout.
  //
  // The phone is in Armenia (MOL-121): the app dates by the phone's calendar and the specs by
  // Yerevan's, and in CI's UTC the two part from 20:00 to midnight. The component tests run in UTC
  // and hold the phone's day where it is not Yerevan's.
  use: {
    baseURL,
    trace: ci ? 'on-first-retry' : 'retain-on-failure',
    locale: 'en-US',
    timezoneId: 'Asia/Yerevan',
  },

  // A phone: that is the device the product is designed for, so a desktop-only pass would prove
  // nothing about the screen that matters. The other projects are the same phone: with a camera,
  // for the scanner (MOL-98), and against the built app, for what needs a worker. The sheet runs on
  // an iPhone's engine as well (MOL-80): Safari does not focus a tapped button, and only WebKit
  // shows what the sheet gives focus back to — and «not now» of the kit (MOL-174), held by what the
  // engine sends for an arrow, Space and a tap; and the error's buttons moved into the strip and back
  // with the focus on them (MOL-180). The rest of the suite stays on one engine — a second
  // run of everything would double the wait at every push for differences no other screen has.
  projects: [
    {
      name: 'phone',
      use: { ...devices['Pixel 7'] },
      testIgnore: /(pwa-update|client-errors-built|outdated-built|scanner)\.spec\.ts$/,
    },
    {
      name: 'camera',
      use: { ...devices['Pixel 7'], channel: 'chromium', launchOptions: { args: FAKE_CAMERA } },
      testMatch: /scanner\.spec\.ts$/,
    },
    {
      name: 'pwa',
      use: { ...devices['Pixel 7'], baseURL: `http://127.0.0.1:${previewPort}` },
      testMatch: /(pwa-update|client-errors-built|outdated-built)\.spec\.ts$/,
    },
    {
      name: 'iphone',
      use: { ...devices['iPhone 14'] },
      testMatch: /(sheet|kit-inactive|kit-rows|state-strip)\.spec\.ts$/,
    },
  ],

  webServer: [
    {
      command: 'node bin/fake-open-food-facts.mjs',
      url: `http://127.0.0.1:${offPort}/health`,
      env: { OFF_PORT: offPort },
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: 'node bin/fake-purs.mjs',
      url: `http://127.0.0.1:${pursPort}/health`,
      env: { PURS_PORT: pursPort },
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: 'node bin/fake-receipt-reader.mjs',
      url: `http://127.0.0.1:${readerPort}/health`,
      env: { READER_PORT: readerPort },
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      // The database is recreated first, in the command of the server that needs it rather
      // than in an npm script: `npx playwright test` is what gets typed while debugging a
      // spec, and it would walk past a preparation step of its own.
      command: 'node bin/e2e-database.mjs && npm run start -w @molvia/backend',
      url: `http://127.0.0.1:${apiPort}/health`,
      // No central bank in a test run: its answer would decide the outcome (MOL-39).
      env: {
        RATES_REFRESH: 'off',
        // Without the model of the search by meaning (MOL-105): the search answers by the letters,
        // and this run is the proof that it holds without it.
        EMBEDDINGS: 'off',
        API_PORT: apiPort,
        DATABASE_URL: databaseUrl,
        TELEGRAM_BOT_USERNAME: 'molvia_test_bot',
        BOT_API_SECRET: 'e'.repeat(43),
        OPEN_FOOD_FACTS_URL: `http://127.0.0.1:${offPort}`,
        OPEN_FOOD_FACTS_CONTACT: 'e2e@molvia.test',
        // The fake has no limit, and every spec of a missed code asks it once (adversarial Е).
        OPEN_FOOD_FACTS_PER_MINUTE: '600',
        // The fake reader (MOL-127), never the copy's own Tesseract (MOL-125, review А14): a run must
        // not read with whatever the copy happens to run, and its answer must be the same every time.
        RECEIPT_READER_URL: `http://127.0.0.1:${readerPort}`,
        // The fake tax office (MOL-232), never the real one; with no limit, as Open Food Facts' fake.
        PURS_URL: `http://127.0.0.1:${pursPort}`,
        PURS_CONTACT: 'e2e@molvia.test',
        PURS_PER_MINUTE: '600',
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
