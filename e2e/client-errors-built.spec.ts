import { expect, test } from '@playwright/test'
import type { Request } from '@playwright/test'

// MOL-144, the built app (`pwa` project): the page names its build by its own script, and its frames
// are paths of the site — what `make failures` reads back through the map beside the build. It comes
// in by `page.goto` on «Данные и приватность», not through `open()`, for pwa-update.spec's reason: the
// development seam is not in a build. The first visit, so no worker stands between the page and
// `page.route`.
const sentFailure = (request: Request) =>
  request.method() === 'POST' && new URL(request.url()).pathname === '/api/client-errors'

test('сбой собранного приложения: сборка — имя его файла, кадры — пути сайта', async ({ page }) => {
  await page.route('**/api/actors/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      // Only our API names its build: without it the reply is a portal's, not the phone's defect.
      headers: { 'x-molvia-version': 'e2e' },
      body: '{"unexpected":true}',
    }),
  )
  const sent = page.waitForRequest(sentFailure)
  const answered = page.waitForResponse((response) => sentFailure(response.request()))
  await page.goto('/privacy')

  const body = (await sent).postDataJSON() as {
    reports: { build: string; screen: string; frames?: string[] }[]
  }
  expect((await answered).status()).toBe(204)
  const [report] = body.reports
  expect(report?.build).toMatch(/^index-[\w-]+$/)
  expect(report?.screen).toBe('privacy')
  expect(
    report?.frames?.some((frame) => /\(\/assets\/index-[\w-]+\.js:\d+:\d+\)$/.test(frame)),
  ).toBe(true)
})
