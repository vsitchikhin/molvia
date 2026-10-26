// MOL-269, adversarial round 2 — end-to-end. A green test means the defect is alive. Put in e2e/ of the
// branch MOL-269-mutations over the PR's head, run by CI on a draft PR; never merged.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { signedIn } from './session'

test.use({ locale: 'ru-RU' })

/**
 * «Деньги» whose month fails: the first read at once, every later one held until `release`, then
 * refused too (`refuse`) or let through.
 */
async function failedMonth(page: Page, then: 'refuse' | 'answer'): Promise<() => void> {
  let reads = 0
  let release: () => void = () => undefined
  const released = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/api/money/months/**', async (route) => {
    reads += 1
    if (reads > 1) await released
    if (reads > 1 && then === 'answer') await route.continue()
    else await route.fulfill({ status: 500, body: '{}' })
  })
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
  await expect(page.getByRole('heading', { name: 'Не удалось загрузить траты' })).toBeVisible()
  return release
}

// Б1e. The app comes back into view (`visibilitychange`, as on every return to it) under a month that
// failed; the server is still down, the read is refused, the error card stays as it was — nothing would
// have moved. But `reading` takes the six rows away for the read: a press on «Обмен денег» made as the
// app came back is released on a row that is gone and back, and goes nowhere. On 10ef684b and on
// master the row stood and the press led to the exchange.
test('Б1e: under a failed month the app comes back into view — a press on «Обмен денег» is lost to a refused read', async ({
  page,
}) => {
  const release = await failedMonth(page, 'refuse')
  const exchange = page.getByRole('link', { name: /^Обмен денег/ })
  await expect(exchange).toBeVisible()
  await exchange.scrollIntoViewIfNeeded()
  const before = await exchange.boundingBox()
  if (!before) throw new Error('no «Обмен денег»')
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()

  const asked = page.waitForRequest('**/api/money/months/**')
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await asked
  const whileReading = await exchange.count()
  const refused = page.waitForResponse('**/api/money/months/**')
  release()
  await refused
  await expect(exchange).toBeVisible()
  const after = await exchange.boundingBox()
  await page.mouse.up()
  console.log('Б1e', JSON.stringify({ before: before.y, after: after?.y ?? null, whileReading }))

  // The same card, the same place: only the read took the row away.
  expect(after?.y).toBe(before.y)
  expect(whileReading).toBe(0)
  await page.waitForTimeout(1_000)
  await expect(page).toHaveURL(/\/money$/)
})

// Б2e. On a small phone the page under a failed month is taller than the window, and the rows are its
// bottom. Scrolled down to them, «Повторить» takes them away: the page is shorter, the browser clamps
// the scroll, and the error card with «Повторить» itself drops under the finger — the second tap on it
// lands elsewhere.
test.describe('a small phone', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('Б2e: scrolled to the ways out, «Повторить» takes them away and the page drops under the finger', async ({
    page,
  }) => {
    const release = await failedMonth(page, 'answer')
    const retry = page.getByRole('button', { name: 'Повторить' })
    await expect(page.getByRole('link', { name: /^Обмен денег/ })).toBeVisible()
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight)
    })
    const scrolled = await page.evaluate(() => window.scrollY)
    const before = await retry.boundingBox()
    if (!before) throw new Error('no «Повторить» in sight')
    await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2)
    await expect(page.getByRole('navigation', { name: 'Разделы «Денег»' })).toHaveCount(0)
    const after = await retry.boundingBox()
    const now = await page.evaluate(() => window.scrollY)
    console.log('Б2e', JSON.stringify({ scrolled, now, before: before.y, after: after?.y ?? null }))
    release()

    expect(scrolled).toBeGreaterThan(0)
    expect(now).toBeLessThan(scrolled)
    expect(after?.y).toBeGreaterThan(before.y)
  })
})
