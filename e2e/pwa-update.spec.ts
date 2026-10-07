import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

// MOL-132. The one spec with a real worker: it runs in the `pwa` project, against the built app
// (`frontend/dist-e2e`), since the dev server builds none. It comes in by `page.goto` on
// «Данные и приватность», not through `open()`: the development seam is not in a build, and the
// page is the one a person reaches without a session (MOL-58).
const WORKER = fileURLToPath(new URL('../frontend/dist-e2e/sw.js', import.meta.url))
let built = ''

test.beforeAll(() => {
  built = readFileSync(WORKER, 'utf8')
})

test.afterEach(() => {
  writeFileSync(WORKER, built)
})

// Both specs rewrite the one built worker.
test.describe.configure({ mode: 'serial' })

test('a version that comes out while the app is on the screen is taken by «Update»', async ({
  page,
}) => {
  await page.goto('/privacy')
  // The first visit installs the worker; the page it came from runs what it fetched.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)
  await page.evaluate(() => Object.assign(window, { stayed: true }))

  // A new build: other bytes, so a new worker — it installs and waits.
  writeFileSync(WORKER, `${built}\n// ${String(Date.now())}\n`)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))

  const update = page.getByRole('button', { name: 'Update', exact: true })
  await expect(update).toBeVisible()
  // Offered, not taken: a page that is looked at is never reloaded without the person (MOL-46, Г).
  // Time for a takeover to have come, and the worker still waiting — not let in behind the strip
  // (review С-10): checked at once, a reload that was on its way would pass unseen.
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.waitForTimeout(1_500)
  expect(await page.evaluate(() => 'stayed' in window)).toBe(true)
  expect(
    await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistration())?.waiting !== null,
    ),
  ).toBe(true)

  await Promise.all([page.waitForEvent('load'), update.click()])

  expect(await page.evaluate(() => 'stayed' in window)).toBe(false)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Data and privacy')
  await expect(update).toHaveCount(0)
  const waiting = await page.evaluate(
    async () => (await navigator.serviceWorker.getRegistration())?.waiting !== null,
  )
  expect(waiting).toBe(false)
})

// A first visit is controlled by nothing to its end, and a version come out meanwhile does not wait
// but becomes the active worker at once — the page was left on the old code with nothing offered
// (adversarial Д2).
test('a first visit learns of a version too, and «Update» brings it up on it', async ({ page }) => {
  await page.goto('/privacy')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull()

  writeFileSync(WORKER, `${built}\n// ${String(Date.now())}\n`)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))

  const update = page.getByRole('button', { name: 'Update', exact: true })
  await expect(update).toBeVisible()
  await Promise.all([page.waitForEvent('load'), update.click()])

  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)
  await expect(update).toHaveCount(0)
})

// With another window of the app open, the registration has a client, and a version waits rather
// than becoming active at once: the first visit showed nothing (adversarial Е1).
test('a first visit beside another window of the app is offered the waiting version too', async ({
  page,
  context,
}) => {
  await page.goto('/privacy')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull()

  const other = await context.newPage()
  await other.goto('/privacy')
  await expect
    .poll(() => other.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)

  writeFileSync(WORKER, `${built}\n// ${String(Date.now())}\n`)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))

  const update = page.getByRole('button', { name: 'Update', exact: true })
  await expect(update).toBeVisible()
  await Promise.all([page.waitForEvent('load'), update.click()])

  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)
  await expect(update).toHaveCount(0)
})

// An error while a version waits offers «Update» itself, first, and the row of the version steps
// aside: one «Update» on the screen (MOL-180, 41 v2 8c). At the door, the one screen a build shows
// without a session; the strip of a screen holds the same rule in `AppScreen.test`.
test('an error at the door while a version waits offers «Update» once, first', async ({ page }) => {
  await page.goto('/privacy')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.goto('/')
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)
  await page.route('**/api/auth/login*', (route) => route.fulfill({ status: 500, body: '{}' }))

  writeFileSync(WORKER, `${built}\n// ${String(Date.now())}\n`)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  const update = page.getByRole('button', { name: 'Update', exact: true })
  await expect(update).toBeVisible()
  // The row by its class: its words are in the live region too (`e2e.md`).
  const row = page.locator('.band')
  await expect(row).toBeVisible()

  await page.getByRole('button', { name: 'Sign in with Telegram' }).click()
  const retry = page.getByRole('button', { name: 'Try again' })
  await expect(retry).toBeVisible()
  await expect(update).toHaveCount(1)
  await expect(row).toHaveCount(0)
  const [above, below] = await Promise.all([update.boundingBox(), retry.boundingBox()])
  expect(above && below && above.y < below.y).toBe(true)
})
