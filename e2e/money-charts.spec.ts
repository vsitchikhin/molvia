import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { standAt, topOf } from './scroll'
import { asBrowser, signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

/**
 * «Графики» end to end (MOL-74, MOL-158, MOL-160): «Месяц» reached from «Деньги» by the ring of «Куда
 * ушли» — its ring, the categories against the usual month and the pace — «Год» of the calendar year
 * with its ring, twelve months against the usual and a category by month; the month, the year and
 * «Месяц · Год» in the address without an entry in the history, and the last answer kept for a shelf
 * with no connection.
 */

function yerevanDay(days = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yerevan' }).format(
    new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  )
}

/** The 15th of the month `back` months before this one in Yerevan: a day any month has. */
function monthsAgoDay(back: number): string {
  const day = new Date(`${yerevanDay().slice(0, 7)}-15T12:00:00Z`)
  day.setUTCMonth(day.getUTCMonth() - back)
  return day.toISOString().slice(0, 10)
}

/** The day is of this year in Yerevan: in January, last month is not. */
function sameYear(day: string): boolean {
  return day.slice(0, 4) === yerevanDay().slice(0, 4)
}

type Spend = (amount: string, spentOn: string, preset: string) => Promise<void>

async function seed(page: Page, more?: (spend: Spend) => Promise<void>) {
  await signedIn(page)
  const headers = await asBrowser(page)
  const { categories } = (await (
    await page.request.get('/api/spending-categories', { headers })
  ).json()) as { categories: { id: string; preset: string | null }[] }
  const spend: Spend = async (amount, spentOn, preset) => {
    const response = await page.request.post('/api/spendings', {
      headers,
      data: {
        id: randomUUID(),
        spentOn,
        amount: { amount, currency: 'AMD' },
        categoryId: categories.find((category) => category.preset === preset)?.id,
      },
    })
    expect(response.status(), await response.text()).toBe(201)
  }
  await spend('40000', monthsAgoDay(1), 'cafe')
  await spend('180000', monthsAgoDay(1), 'rent')
  await spend('30000', yerevanDay(), 'cafe')
  await more?.(spend)
}

async function toCharts(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: /Открыть графики/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Графики')
}

test('the ring of «Куда ушли» opens «Месяц» of the same month; a sector is chosen and let go', async ({
  page,
}) => {
  await seed(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  // The ring names this month's one category, and the card is one link (MOL-156).
  await page
    .getByRole('link', { name: /^Куда ушли: Кафе и рестораны 100\s%\. Открыть графики$/ })
    .click()
  await expect(page).toHaveURL(new RegExp(`month=${yerevanDay().slice(0, 7)}`))

  const where = page.getByRole('region', { name: 'Куда ушло' })
  const centre = where.locator('.center')
  await expect(centre).toContainText('идёт')
  await expect(centre).toContainText(/30\s000\s֏/)
  // The row is tapped, as a thumb does; its radio is what a screen reader reads.
  const row = where.locator('.legend .row', { hasText: 'Кафе и рестораны' })
  await row.click()
  await expect(where.getByRole('radio', { name: /Кафе и рестораны/ })).toBeChecked()
  await expect(centre).toContainText('Кафе и рестораны')
  await expect(centre).toContainText('100')
  await row.click()
  await expect(centre).toContainText('идёт')

  await page.getByRole('button', { name: 'Назад Деньги' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
})

test('the month and the tab move by replace: «назад» from them is «Деньги»', async ({ page }) => {
  await seed(page)
  await toCharts(page)
  const centre = page.getByRole('region', { name: 'Куда ушло' }).locator('.center')
  await expect(centre).toContainText(/30\s000\s֏/)

  await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
  await expect(page).toHaveURL(new RegExp(`month=${monthsAgoDay(1).slice(0, 7)}`))
  await expect(centre).toContainText(/220\s000\s֏/)

  await page.getByText('Год', { exact: true }).click()
  await expect(page).toHaveURL(/mode=year/)
  // Twelve months of the calendar year, a bar only where there is data (MOL-160, handoff 04).
  const spent = page.getByRole('region', { name: 'Расходы по месяцам' })
  await expect(spent.locator('.labels .label')).toHaveCount(12)
  await expect(spent).toContainText('идёт')
  if (sameYear(monthsAgoDay(1))) {
    // Last month is of this year in eleven months of twelve: its bar is chosen by a tap.
    const bars = spent.locator('label.bar')
    await expect(bars).toHaveCount(2)
    await bars.first().click()
    await expect(spent).toContainText(/220\s000\s֏/)
  }

  await page.goBack()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
})

test('a bookmark of the old period opens «Год»', async ({ page }) => {
  await seed(page)
  await page.goto('/money/charts?period=6')
  await expect(page).toHaveURL(/mode=year/)
  await expect(page).not.toHaveURL(/period=/)
  const spent = page.getByRole('region', { name: 'Расходы по месяцам' })
  await expect(spent.locator('.labels .label')).toHaveCount(12)
})

test('«Год» moves by replace to the year before, as far back as there is anything (MOL-160)', async ({
  page,
}) => {
  await seed(page, async (spend) => {
    // Twelve months back is always last year, whatever this month is.
    await spend('7000', monthsAgoDay(12), 'pets')
  })
  await toCharts(page)
  await page.getByText('Год', { exact: true }).click()
  const year = Number(yerevanDay().slice(0, 4))
  await expect(page.locator('.switcher .month')).toHaveText(String(year))
  await expect(page.getByRole('button', { name: 'Следующий год' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )

  await page.getByRole('button', { name: 'Предыдущий год' }).click()
  await expect(page).toHaveURL(new RegExp(`year=${String(year - 1)}`))
  await expect(page.locator('.switcher .month')).toHaveText(String(year - 1))
  await expect(page.getByRole('region', { name: 'Куда ушло за год' })).toContainText(/7\s000\s֏/)
  // The first year with anything in it: no further back.
  await expect(page.getByRole('button', { name: 'Предыдущий год' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )

  await page.goBack()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
})

test('the average of «Год» comes with three closed months, across the new year too (В-1)', async ({
  page,
}) => {
  await seed(page, async (spend) => {
    await spend('20000', monthsAgoDay(2), 'cafe')
  })
  await page.goto('/money/charts?mode=year')
  const spent = page.getByRole('region', { name: 'Расходы по месяцам' })
  // «после …» while that month is of this year; in December — how many of the three there are.
  await expect(spent).toContainText(/Среднее появится после|мало закрытых месяцев/)
  await expect(spent.locator('.average')).toHaveCount(0)

  const headers = await asBrowser(page)
  const { categories } = (await (
    await page.request.get('/api/spending-categories', { headers })
  ).json()) as { categories: { id: string; preset: string | null }[] }
  const response = await page.request.post('/api/spendings', {
    headers,
    data: {
      id: randomUUID(),
      spentOn: monthsAgoDay(3),
      amount: { amount: '10000', currency: 'AMD' },
      categoryId: categories.find((category) => category.preset === 'cafe')?.id,
    },
  })
  expect(response.status()).toBe(201)
  await page.reload()
  await expect(spent).toContainText('В среднем')
  await expect(spent.locator('.average')).toHaveCount(1)
})

test('a sector of the year’s ring chooses its category below, with no scroll (В-3)', async ({
  page,
}) => {
  // Rent this month too: the year's largest is not the café in any month, January included.
  await seed(page, async (spend) => {
    await spend('180000', yerevanDay(), 'rent')
  })
  await page.goto('/money/charts?mode=year')
  const choice = page.getByRole('combobox', { name: 'Категория' })
  await expect(choice.locator('option:checked')).not.toHaveText('Кафе и рестораны')
  const scrolled = await page.evaluate(() => window.scrollY)

  await page
    .getByRole('region', { name: 'Куда ушло за год' })
    .locator('.legend .row', { hasText: 'Кафе и рестораны' })
    .click()
  await expect(page).toHaveURL(/category=/)
  await expect(choice.locator('option:checked')).toHaveText('Кафе и рестораны')
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)
})

test('against the usual comes with three closed months, and says when before (handoff 3g)', async ({
  page,
}) => {
  await seed(page, async (spend) => {
    await spend('20000', monthsAgoDay(2), 'cafe')
  })
  await toCharts(page)
  // Two closed months with data: the card stays and names the first month with a comparison.
  const usual = page.getByRole('region', { name: 'Против обычного' })
  await expect(usual).toContainText('Сравнение — с')
  await expect(usual).toContainText('закрыты только')
  const pace = page.getByRole('region', { name: 'Темп месяца' })
  await expect(pace).toContainText('Пунктир обычного месяца — с')

  await page.goto('/money')
  const headers = await asBrowser(page)
  const { categories } = (await (
    await page.request.get('/api/spending-categories', { headers })
  ).json()) as { categories: { id: string; preset: string | null }[] }
  const response = await page.request.post('/api/spendings', {
    headers,
    data: {
      id: randomUUID(),
      spentOn: monthsAgoDay(3),
      amount: { amount: '10000', currency: 'AMD' },
      categoryId: categories.find((category) => category.preset === 'cafe')?.id,
    },
  })
  expect(response.status()).toBe(201)
  await page.getByRole('link', { name: /Открыть графики/ }).click()

  // Against the usual to this day of the month — whatever day it is, the café of this month is in it.
  await expect(usual.getByRole('listitem')).not.toHaveCount(0)
  await expect(usual).toContainText('Кафе и рестораны')
  await expect(usual).toContainText('обычно')
  await expect(pace).toContainText('Обычный')

  // A tap on the pace chooses the day under it: the first of the month at its left edge.
  await pace.locator('.area').click({ position: { x: 1, y: 60 } })
  await expect(pace.locator('.reading')).toContainText(/^К 1 /)
})

// The category card of «Год» is the third: a choice that took the page to the top took the chart away
// from the person who asked for it (MOL-136). Where the card stands on the screen is what the eye sees.
/** Scrolls to the very end of the page, where the category card stands when it is the last one. */
async function toTheEnd(page: Page): Promise<number> {
  await page.evaluate(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
  })
  const scrolled = await page.evaluate(() => window.scrollY)
  expect(scrolled).toBeGreaterThan(0)
  return scrolled
}

test('a category chosen at the end of «Год» stays under the thumb', async ({ page }) => {
  await seed(page)
  await page.goto('/money/charts?mode=year')
  const card = page.getByRole('region', { name: 'Категория по месяцам' })
  const choice = page.getByRole('combobox', { name: 'Категория' })
  await choice.selectOption({ label: 'Аренда жилья' })
  await expect(choice.locator('option:checked')).toHaveText('Аренда жилья')

  // The card is the last on the page, and «Кафе и рестораны» draws it 2 px shorter under the choice
  // than «Аренда жилья»: the page is held, not brought up under it (MOL-138).
  const scrolled = await toTheEnd(page)
  const before = await topOf(choice)
  await choice.selectOption({ label: 'Кафе и рестораны' })
  await expect(page).toHaveURL(/category=/)
  await expect(card).toContainText(/30\s000\s֏/)
  expect(await topOf(choice)).toBe(before)
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)
})

test('a month read for the first time keeps the switcher where it was under the skeleton', async ({
  page,
}) => {
  await seed(page)
  await toCharts(page)
  await expect(page.getByRole('region', { name: 'Темп месяца' })).toBeVisible()

  // The month before is read for the first time on this phone, and the answer is held back: under
  // the skeleton the page is one window tall, and the switcher stays where it was (MOL-138).
  let answer: () => void = () => undefined
  const answered = new Promise<void>((resolve) => (answer = resolve))
  await page.route(`**/api/money/months/${monthsAgoDay(1).slice(0, 7)}/charts`, async (route) => {
    await answered
    await route.continue()
  })
  const previous = page.getByRole('button', { name: 'Предыдущий месяц' })
  await standAt(previous, 60)
  const down = await page.evaluate(() => window.scrollY)
  expect(down).toBeGreaterThan(0)
  const at = await topOf(previous)

  await previous.click()
  await expect(page.locator('.skeleton')).toBeVisible()
  expect(await topOf(previous)).toBe(at)
  expect(await page.evaluate(() => window.scrollY)).toBe(down)

  answer()
  await expect(page.getByRole('region', { name: 'Куда ушло' })).toContainText(/220\s000\s֏/)
  expect(await topOf(previous)).toBe(at)
})

test('a line gone under the category of «Год» keeps the choice and the page where they were', async ({
  page,
}) => {
  await seed(page)
  // An address that names a category the charts do not have: said on the card, under the choice
  // (MOL-74, MOL-138 В-2). Chosen another, the line goes and the card is shorter at the very end of
  // the page: held, not brought up.
  await page.goto(`/money/charts?mode=year&category=${randomUUID()}`)
  const card = page.getByRole('region', { name: 'Категория по месяцам' })
  const choice = page.getByRole('combobox', { name: 'Категория' })
  await expect(card).toContainText('Этой категории на графиках нет')

  const scrolled = await toTheEnd(page)
  const before = await topOf(choice)
  await choice.selectOption({ label: 'Кафе и рестораны' })
  await expect(card).not.toContainText('Этой категории на графиках нет')
  await expect(card).toContainText(/30\s000\s֏/)
  expect(await topOf(choice)).toBe(before)
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)
})

// The strip belongs to the month and stands under the switcher: neither its going with a month not
// read nor its coming back over one the phone keeps moves the switcher (MOL-138, В-2; adversarial
// Б2, round 2 Д1 of MOL-74).
test('offline, the month is the last one read under a strip that is not red, and the switcher stays', async ({
  page,
  context,
}) => {
  await seed(page)
  await toCharts(page)
  const centre = page.getByRole('region', { name: 'Куда ушло' }).locator('.center')
  await expect(centre).toContainText(/30\s000\s֏/)
  await page.goBack()

  await context.setOffline(true)
  await page.getByRole('link', { name: /Открыть графики/ }).click()
  const strip = page.getByText(/Нет связи. Графики на/)
  await expect(strip).toBeVisible()
  await expect(centre).toContainText(/30\s000\s֏/)
  await expect(page.getByRole('button', { name: 'Повторить' })).toHaveCount(0)

  const previous = page.getByRole('button', { name: 'Предыдущий месяц' })
  await standAt(previous, 60)
  const at = await topOf(previous)
  await previous.click()
  await expect(strip).toBeHidden()
  // Said out loud too: taken by its heading, outside the live region (MOL-64).
  await expect(page.getByRole('heading', { name: 'Нет связи' })).toBeVisible()
  expect(await topOf(previous)).toBe(at)

  // Back to this month, kept on the phone: the strip goes with the move, back with the failed read.
  await page.getByRole('button', { name: 'Следующий месяц' }).click()
  await expect(strip).toBeVisible()
  expect(await topOf(previous)).toBe(at)
  await context.setOffline(false)
})
