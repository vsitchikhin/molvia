import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { standAt, topOf } from './scroll'
import { asBrowser, signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

/**
 * «Графики» end to end (MOL-74): the months the server counts side by side, reached from «Деньги»
 * by the ring of «Куда ушли» (MOL-156), a bar chosen by a tap, the period in the address
 * without an entry in the history, and the last answer kept for a shelf with no connection.
 */

function yerevanDay(days = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yerevan' }).format(
    new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  )
}

/** The middle of last month in Yerevan: a day any month has. */
function lastMonthDay(): string {
  const day = new Date(`${yerevanDay().slice(0, 7)}-15T12:00:00Z`)
  day.setUTCMonth(day.getUTCMonth() - 1)
  return day.toISOString().slice(0, 10)
}

async function seed(page: Page): Promise<void> {
  await signedIn(page)
  const headers = await asBrowser(page)
  const { categories } = (await (
    await page.request.get('/api/spending-categories', { headers })
  ).json()) as { categories: { id: string; preset: string | null }[] }
  const cafe = categories.find((category) => category.preset === 'cafe')?.id
  const rent = categories.find((category) => category.preset === 'rent')?.id
  const spend = async (amount: string, spentOn: string, categoryId: string | undefined) => {
    const response = await page.request.post('/api/spendings', {
      headers,
      data: { id: randomUUID(), spentOn, amount: { amount, currency: 'AMD' }, categoryId },
    })
    expect(response.status(), await response.text()).toBe(201)
  }
  await spend('40000', lastMonthDay(), cafe)
  await spend('180000', lastMonthDay(), rent)
  await spend('30000', yerevanDay(), cafe)
}

test('the ring of «Куда ушли» opens the charts, a bar is chosen by a tap, «назад» is «Деньги»', async ({
  page,
}) => {
  await seed(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  // The ring names this month's one category, and the card is one link (MOL-156).
  const ring = page.getByRole('link', {
    name: /^Куда ушли: Кафе и рестораны 100\s%\. Открыть графики$/,
  })
  await expect(ring.locator('.ring path')).toHaveCount(1)
  await ring.click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Графики')
  // Opened from the ring, the charts show the largest category of the period (Р-8 of MOL-74).
  await expect(
    page.getByRole('combobox', { name: 'Категория' }).locator('option:checked'),
  ).toHaveText('Аренда жилья')

  // The running month is read first; a tap on the bar before it reads that one.
  const spent = page.locator('fieldset.chart').first()
  await expect(spent).toContainText(/30\s000\s֏/)
  const bars = spent.locator('label.bar')
  const count = await bars.count()
  expect(count).toBe(6)
  await bars.nth(count - 2).click()
  await expect(spent).toContainText(/220\s000\s֏/)

  await page.getByRole('button', { name: 'Назад Деньги' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
})

test('the period moves by replace: «назад» from twelve months is «Деньги», not six', async ({
  page,
}) => {
  await seed(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: /Открыть графики/ }).click()
  await expect(page.locator('fieldset.chart').first().locator('label.bar')).toHaveCount(6)

  await page.getByText('12 месяцев', { exact: true }).click()
  await expect(page).toHaveURL(/period=12/)
  await expect(page.locator('fieldset.chart').first().locator('label.bar')).toHaveCount(12)

  await page.goBack()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
})

// The category card is the third: a choice that took the page to the top took the chart away from
// the person who asked for it (MOL-136). Where the card stands on the screen is what the eye sees.
test('a category chosen further down keeps the page where it is, and so does the period', async ({
  page,
}) => {
  await seed(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: /Открыть графики/ }).click()
  const card = page.getByRole('region', { name: 'Категория во времени' })
  const choice = page.getByRole('combobox', { name: 'Категория' })
  await expect(choice.locator('option:checked')).toHaveText('Аренда жилья')

  // The card is the last on the page and cannot reach the top; it stands off the bottom of the page.
  // At the very bottom a shorter card brings the end of the page up under it — 2 px between two
  // categories, a line where a missing one was named: the height of the page, MOL-138, not the router.
  await standAt(card, 480)
  const scrolled = await page.evaluate(() => window.scrollY)
  expect(scrolled).toBeGreaterThan(0)
  const before = await topOf(card)

  await choice.selectOption({ label: 'Кафе и рестораны' })
  await expect(page).toHaveURL(/category=/)
  await expect(card).toContainText(/30\s000\s֏/)
  expect(await topOf(card)).toBe(before)
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)

  // The first twelve months on a phone are read under the skeleton, a page one screen tall, and the
  // browser brings any scroll up to it — the height of the page, not the router. Back to six, the
  // period the phone keeps is drawn at once, and the page is only a little down: the period is at
  // the top, and a little is enough to tell it from the top.
  await page.getByText('12 месяцев', { exact: true }).click()
  const bars = page.locator('fieldset.chart').first().locator('label.bar')
  await expect(bars).toHaveCount(12)
  const periods = page.getByRole('group', { name: 'Период' })
  await standAt(periods, 60)
  const down = await page.evaluate(() => window.scrollY)
  expect(down).toBeGreaterThan(0)
  const period = await topOf(periods)
  await page.getByText('6 месяцев', { exact: true }).click()
  await expect(page).not.toHaveURL(/period=/)
  await expect(bars).toHaveCount(6)
  expect(await topOf(periods)).toBe(period)
  expect(await page.evaluate(() => window.scrollY)).toBe(down)
})

test('with no connection the charts are the last ones read, under a strip that is not red', async ({
  page,
  context,
}) => {
  await seed(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: /Открыть графики/ }).click()
  await expect(page.locator('fieldset.chart').first()).toContainText(/30\s000\s֏/)
  await page.goBack()

  await context.setOffline(true)
  await page.getByRole('link', { name: /Открыть графики/ }).click()
  const strip = page.locator('.strip')
  await expect(strip).toContainText('Нет связи. Графики на')
  await expect(page.locator('fieldset.chart').first()).toContainText(/30\s000\s֏/)
  await expect(page.getByRole('button', { name: 'Повторить' })).toHaveCount(0)
  await context.setOffline(false)
})
