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

test.afterAll(() => {
  writeFileSync(WORKER, built)
})

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
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  expect(await page.evaluate(() => 'stayed' in window)).toBe(true)

  await Promise.all([page.waitForEvent('load'), update.click()])

  expect(await page.evaluate(() => 'stayed' in window)).toBe(false)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Data and privacy')
  await expect(update).toHaveCount(0)
  const waiting = await page.evaluate(
    async () => (await navigator.serviceWorker.getRegistration())?.waiting !== null,
  )
  expect(waiting).toBe(false)
})
