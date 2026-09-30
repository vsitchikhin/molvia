import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { standAt, topOf } from './scroll'
import { asBrowser, signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

/**
 * «Графики» end to end (MOL-74): the months the server counts side by side, reached from «Деньги»
 * by a category or by «Графики по месяцам», a bar chosen by a tap, the period in the address
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

test('a category of «Куда ушли» opens its charts, a bar is chosen by a tap, «назад» is «Деньги»', async ({
  page,
}) => {
  await seed(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: /Кафе и рестораны/ }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Графики')
  await expect(page.getByRole('combobox', { name: 'Категория' })).toHaveValue(/.+/)
  await expect(
    page.getByRole('combobox', { name: 'Категория' }).locator('option:checked'),
  ).toHaveText('Кафе и рестораны')

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
  await page.getByRole('link', { name: 'Графики по месяцам' }).click()
  await expect(page.locator('fieldset.chart').first().locator('label.bar')).toHaveCount(6)

  await page.getByText('12 месяцев', { exact: true }).click()
  await expect(page).toHaveURL(/period=12/)
  await expect(page.locator('fieldset.chart').first().locator('label.bar')).toHaveCount(12)

  await page.goBack()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
})

// The category card is the third: a choice that took the page to the top took the chart away from
// the person who asked for it (MOL-136). Where the card stands on the screen is what the eye sees.
/** Scrolls to the very end of the page, where the category card stands when it is the last one. */
async function toTheEnd(page: Page): Promise<number> {
  await page.evaluate(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
  })
  const scrolled = await page.evaluate(() => window.scrollY)
  expect(scrolled).toBeGreaterThan(0)
  return scrolled
}

test('a category chosen at the end of the page keeps its card where it is, and so does the period', async ({
  page,
}) => {
  await seed(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: 'Графики по месяцам' }).click()
  const card = page.getByRole('region', { name: 'Категория во времени' })
  const choice = page.getByRole('combobox', { name: 'Категория' })
  await expect(choice.locator('option:checked')).toHaveText('Аренда жилья')

  // The card is the last on the page, and «Кафе и рестораны» draws it 2 px shorter than «Аренда
  // жилья»: the page is held, not brought up under it (MOL-138).
  const scrolled = await toTheEnd(page)
  const before = await topOf(card)
  await choice.selectOption({ label: 'Кафе и рестораны' })
  await expect(page).toHaveURL(/category=/)
  await expect(card).toContainText(/30\s000\s֏/)
  expect(await topOf(card)).toBe(before)
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)

  // Twelve months are read for the first time on this phone, and the answer is held back: under
  // the skeleton the page is one window tall, and the period stays where it was.
  let answer: () => void = () => undefined
  const answered = new Promise<void>((resolve) => (answer = resolve))
  await page.route('**/api/money/charts?period=12', async (route) => {
    await answered
    await route.continue()
  })
  const periods = page.getByRole('group', { name: 'Период' })
  await standAt(periods, 60)
  const down = await page.evaluate(() => window.scrollY)
  expect(down).toBeGreaterThan(0)
  const period = await topOf(periods)

  await page.getByText('12 месяцев', { exact: true }).click()
  await expect(page).toHaveURL(/period=12/)
  await expect(page.locator('.skeleton')).toBeVisible()
  expect(await topOf(periods)).toBe(period)
  expect(await page.evaluate(() => window.scrollY)).toBe(down)

  answer()
  const bars = page.locator('fieldset.chart').first().locator('label.bar')
  await expect(bars).toHaveCount(12)
  expect(await topOf(periods)).toBe(period)

  // Back to six, the period the phone keeps.
  await page.getByText('6 месяцев', { exact: true }).click()
  await expect(page).not.toHaveURL(/period=/)
  await expect(bars).toHaveCount(6)
  expect(await topOf(periods)).toBe(period)
  expect(await page.evaluate(() => window.scrollY)).toBe(down)
})

test('a card a line shorter at the end of the page stays, and the room under it goes once scrolled up', async ({
  page,
}) => {
  await seed(page)
  // An address that names a category the charts do not have: said on the card, a line more (MOL-74).
  await page.goto(`/money/charts?category=${randomUUID()}`)
  const card = page.getByRole('region', { name: 'Категория во времени' })
  await expect(card).toContainText('Этой категории на графиках нет')

  const scrolled = await toTheEnd(page)
  const before = await topOf(card)
  await page
    .getByRole('combobox', { name: 'Категория' })
    .selectOption({ label: 'Кафе и рестораны' })
  await expect(card).not.toContainText('Этой категории на графиках нет')
  await expect(card).toContainText(/30\s000\s֏/)
  expect(await topOf(card)).toBe(before)
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)

  // The room held under the card is not a page to scroll into: scrolled up, it goes, and the end
  // of the page comes up to the card again.
  const hold = () =>
    page.evaluate(() => document.documentElement.style.getPropertyValue('--page-hold'))
  expect(await hold()).not.toBe('')
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  })
  await expect.poll(hold).toBe('')
  // The line gone, the page ends that much higher than it did.
  expect(await toTheEnd(page)).toBeLessThan(scrolled)
})

test('with no connection the charts are the last ones read, under a strip that is not red', async ({
  page,
  context,
}) => {
  await seed(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: 'Графики по месяцам' }).click()
  await expect(page.locator('fieldset.chart').first()).toContainText(/30\s000\s֏/)
  await page.goBack()

  await context.setOffline(true)
  await page.getByRole('link', { name: 'Графики по месяцам' }).click()
  const strip = page.locator('.strip')
  await expect(strip).toContainText('Нет связи. Графики на')
  await expect(page.locator('fieldset.chart').first()).toContainText(/30\s000\s֏/)
  await expect(page.getByRole('button', { name: 'Повторить' })).toHaveCount(0)
  await context.setOffline(false)
})
