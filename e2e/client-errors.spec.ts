import { expect, test } from '@playwright/test'
import type { Request } from '@playwright/test'
import { signedIn } from './session'

// MOL-144: a failure on the phone reaches the API's table — its kind, frames, screen and build, and
// nothing of what the screen held. The answer the old code «cannot read» is the API's own route
// answering 200 with a body off the contract: the phone's defect, not the API's or the weather's.
const sentFailure = (request: Request) =>
  request.method() === 'POST' && new URL(request.url()).pathname === '/api/client-errors'

test('ошибка экрана доходит до API без ответа API и без сообщения', async ({ page }) => {
  await signedIn(page, '/settings')
  await page.route('**/api/advice', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      // Only our API names its build: without it the reply is a portal's, not the phone's defect.
      headers: { 'x-molvia-version': 'e2e' },
      body: JSON.stringify({ secret: 'Сыр «Ширакаци», 5000 драм' }),
    }),
  )
  const sent = page.waitForRequest(sentFailure)
  const answered = page.waitForResponse((response) => sentFailure(response.request()))
  await page.goto('/')
  // With receipts the error of «Что брать» is a section's quiet card, polite rather than an alert
  // (MOL-180): the screen's failure is reported all the same.
  await expect(page.locator('.state.bad')).toBeVisible()

  const body = (await sent).postDataJSON() as { reports: Record<string, unknown>[] }
  expect((await answered).status()).toBe(204)
  expect(body.reports).toContainEqual(
    expect.objectContaining({
      errorName: 'ApiError',
      catcher: 'screen',
      screen: 'advice',
      build: 'dev',
    }),
  )
  const text = JSON.stringify(body)
  expect(text).not.toMatch(/Ширакаци|5000|secret|response_invalid|127\.0\.0\.1|localhost/)
})
