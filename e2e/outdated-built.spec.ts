import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page, Request } from '@playwright/test'

// MOL-231, the built app (`pwa` project): the line a browser below the floor sees is put in by the
// build, and only a build registers a worker — so a browser that stayed silent is proved here, where
// it could have spoken. It comes in by `page.goto` on «Данные и приватность», not through `open()`,
// for pwa-update.spec's reason: the development seam is not in a build. A browser below the floor is
// this one with a marker taken away before any script of the page runs.
const en = JSON.parse(
  readFileSync(new URL('../frontend/src/i18n/en.json', import.meta.url), 'utf8'),
) as { outdated: { line: string }; privacy: { title: string } }

/** Every request of the page to the API, from before it is opened. */
function apiCalls(page: Page): Request[] {
  const calls: Request[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) calls.push(request)
  })
  return calls
}

test('браузер ниже пола: одна строка вместо приложения, ни запроса к API, ни воркера', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(String.prototype, 'isWellFormed')
  })
  const calls = apiCalls(page)
  await page.goto('/privacy')
  await page.waitForLoadState('networkidle')

  await expect(page.locator('#app')).toHaveText(en.outdated.line)
  await expect(page.locator('html')).toHaveAttribute('data-outdated', '')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { name: en.privacy.title })).toHaveCount(0)
  expect(calls.map((request) => request.url())).toEqual([])
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistration())).toBeUndefined()
})

test('браузер не ниже пола проверки не замечает: приложение, без отметки и строки', async ({
  page,
}) => {
  await page.goto('/privacy')

  await expect(page.getByRole('heading', { name: en.privacy.title })).toBeVisible()
  await expect(page.locator('html')).not.toHaveAttribute('data-outdated')
  await expect(page.locator('#app')).not.toContainText(en.outdated.line)
})
