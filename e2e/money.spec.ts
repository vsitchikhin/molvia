import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { standAt, topOf } from './scroll'
import { asBrowser, signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

/**
 * «Деньги» end to end (MOL-82, MOL-159): a spending written on the summary goes through the queue,
 * the month the server counts takes it in, its row is on «Траты», a removal there comes back with
 * «Вернуть» — and all of it with no connection too. What no component test shows is that the
 * screens, the queue and the server agree.
 */

async function openMoney(page: Page): Promise<void> {
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
}

/** «Траты» of the month on screen, by its row on «Деньги» (MOL-159). */
async function openSpendings(page: Page): Promise<void> {
  await page.getByRole('link', { name: /^Траты/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Траты')
}

async function writeSpending(
  page: Page,
  amount: string,
  category: string,
  note?: string,
): Promise<void> {
  const sheet = page.locator('dialog[open]')
  await expect(sheet).toContainText('Новая трата')
  // The sheet takes no tap while it rises.
  await page.waitForTimeout(400)
  await sheet.getByLabel('Сумма').fill(amount)
  await sheet.getByRole('radio', { name: category }).check()
  if (note) await sheet.getByLabel(/Что это/).fill(note)
  await sheet.getByRole('button', { name: 'Сохранить трату' }).click()
  await expect(sheet).toBeHidden()
}

test('a spending lands in the month, and a removal comes back with «Вернуть»', async ({ page }) => {
  await openMoney(page)
  await expect(page.getByRole('heading', { name: 'Добавьте первую трату' })).toBeVisible()
  await page.getByRole('button', { name: 'Добавить трату' }).click()

  // Checked on «Сохранить», not under the finger: both errors, and nothing leaves.
  const sheet = page.locator('dialog[open]')
  await page.waitForTimeout(400)
  await sheet.getByRole('button', { name: 'Сохранить трату' }).click()
  await expect(sheet).toContainText('Введите сумму больше нуля')
  await expect(sheet).toContainText('Выберите категорию')
  await sheet.getByLabel('Сумма').fill('5000')
  await sheet.getByRole('radio', { name: 'Красота и гигиена' }).check()
  await sheet.getByLabel(/Что это/).fill('Барбер')
  await sheet.getByRole('button', { name: 'Сохранить трату' }).click()
  await expect(sheet).toBeHidden()

  // The server's figure on the summary, and «Траты, 1» under it; the row is on «Траты».
  await expect(page.locator('.spent .figure')).toHaveText(/5\s000\s֏/)
  await expect(page.getByRole('link', { name: 'Траты, 1' })).toBeVisible()
  await openSpendings(page)
  await expect(page.locator('.total')).toContainText(/1 трата/)
  const row = page.getByRole('button', { name: /Открыть трату: Барбер/ })
  await expect(row).toBeVisible()

  // Removed without a question; «Вернуть» brings the same spending back.
  await row.click()
  await page.waitForTimeout(400)
  await sheet.getByRole('button', { name: 'Удалить трату' }).click()
  await expect(sheet).toBeHidden()
  await expect(row).toBeHidden()
  // The only spending gone, the month read again is empty — and «Вернуть» still stands: a person
  // reads the strip before reaching for it (adversarial Г).
  await expect(page.getByRole('heading', { name: /трат нет/ })).toBeVisible()
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: 'Вернуть' }).click()
  await expect(row).toBeVisible()
  await expect(page.locator('.total .figure')).toHaveText(/5\s000\s֏/)
  await expect(page.getByRole('button', { name: 'Добавить трату' })).toBeVisible()

  // «‹ Деньги» back onto the summary of the same month.
  await page.getByRole('button', { name: 'Деньги' }).first().click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
  await expect(page.locator('.spent .figure')).toHaveText(/5\s000\s֏/)
})

test('with no connection a spending waits on the phone, uncounted, and goes when it is back', async ({
  page,
  context,
}) => {
  await openMoney(page)
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await writeSpending(page, '160000', 'Аренда жилья')
  await expect(page.locator('.spent .figure')).toHaveText(/160\s000\s֏/)

  await context.setOffline(true)
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await expect(page.locator('dialog[open]')).toContainText('Нет связи')
  await writeSpending(page, '1500', 'Транспорт', 'Такси')

  // A line on the card — and the total is still the server's (Р-3); on «Траты», a row
  // «Отправляем…» and a word beside the sum.
  await expect(page.locator('.spent')).toContainText('Ещё не учтено: 1 трата отправляется')
  await expect(page.locator('.spent .figure')).toHaveText(/160\s000\s֏/)
  await openSpendings(page)
  await expect(page.getByRole('button', { name: /Открыть трату: Такси/ })).toContainText(
    'Отправляем…',
  )
  await expect(page.locator('.total')).toContainText('1 ещё не учтена')
  await expect(page.locator('.total .figure')).toHaveText(/160\s000\s֏/)

  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.locator('.total .figure')).toHaveText(/161\s500\s֏/)
  await expect(page.getByRole('button', { name: /Открыть трату: Такси/ })).not.toContainText(
    'Отправляем…',
  )
})

test('a spending of another month: «Траты» go to it, the summary stays on its own (MOL-159)', async ({
  page,
}) => {
  await openMoney(page)
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await writeSpending(page, '5000', 'Красота и гигиена', 'Барбер')
  await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
  await expect(page).toHaveURL(/month=\d{4}-\d{2}/)

  // The summary has no row to show: it stays on the month looked at (handoff MOL-157 06).
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await writeSpending(page, '1500', 'Транспорт', 'Такси')
  await expect(page).toHaveURL(/month=\d{4}-\d{2}/)

  // «Траты» open on that month; today's spending takes them to this one, row in view (adversarial И).
  await openSpendings(page)
  await expect(page).toHaveURL(/month=\d{4}-\d{2}/)
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await writeSpending(page, '700', 'Транспорт', 'Автобус')
  await expect(page).not.toHaveURL(/month=/)
  await expect(page.getByRole('button', { name: /Открыть трату: Автобус/ })).toBeVisible()
})

test('changing the month writes nothing into the history', async ({ page }) => {
  await openMoney(page)
  const before = await page.evaluate(() => window.history.length)
  await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
  await expect(page).toHaveURL(/month=\d{4}-\d{2}/)
  expect(await page.evaluate(() => window.history.length)).toBe(before)
})

/** The middle of last month in Yerevan: a day any month has. */
function lastMonthDay(): string {
  const day = new Date(`${yerevanDay().slice(0, 7)}-15T12:00:00Z`)
  day.setUTCMonth(day.getUTCMonth() - 1)
  return day.toISOString().slice(0, 10)
}

// Taken to the top, the switcher went down by what stood over it, and the next tap on the arrow
// missed it (MOL-136). Where it stands on the screen is what the thumb finds — on «Траты», whose
// journal makes the page tall (MOL-159).
/** Twelve spendings on each day given, then «Траты» open on this month's twelve. */
async function twelveADay(page: Page, days: string[]): Promise<void> {
  await signedIn(page)
  const headers = await asBrowser(page)
  const { categories } = (await (
    await page.request.get('/api/spending-categories', { headers })
  ).json()) as { categories: { id: string }[] }
  for (const spentOn of days)
    for (let n = 1; n <= 12; n += 1) {
      const response = await page.request.post('/api/spendings', {
        headers,
        data: {
          id: randomUUID(),
          spentOn,
          amount: { amount: String(n * 100), currency: 'AMD' },
          categoryId: categories[0]?.id,
        },
      })
      expect(response.status(), await response.text()).toBe(201)
    }
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await openSpendings(page)
  await expect(page.getByRole('button', { name: /Открыть трату/ })).toHaveCount(12)
}

// The day's sum stands over the rows' sums (MOL-176, В-1 «а»): `--space-tail` is the card's hairline,
// the row's inset, its chevron and the gap. Without the hairline it ended a pixel past the column
// (adversarial А4).
for (const width of [412, 320])
  test(`at ${String(width)} the day’s sum on «Траты» ends where its rows’ amounts do (MOL-176)`, async ({
    page,
  }) => {
    // On 320 the rows stand their amounts under the words, and the day's words wrap, never its sum:
    // broken, «≈» stood over the figure and the figure left the column (review Р3-1).
    await page.setViewportSize({ width, height: 840 })
    await twelveADay(page, [yerevanDay()])
    const day = page.locator('section.day', { has: page.locator('.day-total') }).first()
    const edges = await day.evaluate((root) => ({
      total: root.querySelector('.day-total')?.getBoundingClientRect().right ?? Number.NaN,
      lines: root.querySelector('.day-total')?.getClientRects().length ?? 0,
      amounts: [...root.querySelectorAll('.list-row .amount')].map(
        (one) => one.getBoundingClientRect().right,
      ),
    }))
    expect(edges.amounts.length).toBe(12)
    for (const amount of edges.amounts) expect(amount).toBeCloseTo(edges.total, 1)
    expect(edges.lines).toBe(1)
  })

test('changing the month keeps the switcher where it was on the screen, under the skeleton too', async ({
  page,
}) => {
  await twelveADay(page, [yerevanDay(), lastMonthDay()])
  const rows = page.getByRole('button', { name: /Открыть трату/ })

  // Last month is read for the first time on this phone, and its answer is held back: the screen
  // stands under the skeleton, a page shorter than the one under the window (MOL-138).
  let answer: () => void = () => undefined
  const answered = new Promise<void>((resolve) => (answer = resolve))
  await page.route(`**/api/money/months/${lastMonthDay().slice(0, 7)}*`, async (route) => {
    await answered
    await route.continue()
  })

  const previous = page.getByRole('button', { name: 'Предыдущий месяц' })
  await standAt(previous, 120)
  const scrolled = await page.evaluate(() => window.scrollY)
  expect(scrolled).toBeGreaterThan(0)
  const before = await topOf(previous)

  await previous.click()
  await expect(page).toHaveURL(/month=\d{4}-\d{2}/)
  await expect(page.locator('.skeleton')).toBeVisible()
  expect(await topOf(previous)).toBe(before)
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)

  answer()
  await expect(rows).toHaveCount(12)
  expect(await topOf(previous)).toBe(before)

  // Back to this month, the one the phone keeps, drawn at once.
  const next = page.getByRole('button', { name: 'Следующий месяц' })
  await next.click()
  await expect(page).not.toHaveURL(/month=/)
  await expect(rows).toHaveCount(12)
  expect(await topOf(next)).toBe(before)
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)

  // The room held under the window is not a page to scroll into: scrolled up, it goes.
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--page-hold')))
    .toBe('')
})

// The answer comes shorter than the page under the window: the empty month is held, and so is the
// switcher (MOL-138, review С-2).
test('an empty month after a full one keeps the switcher where it was', async ({ page }) => {
  await twelveADay(page, [yerevanDay()])
  const previous = page.getByRole('button', { name: 'Предыдущий месяц' })
  await standAt(previous, 120)
  const scrolled = await page.evaluate(() => window.scrollY)
  expect(scrolled).toBeGreaterThan(0)

  await previous.click()
  await expect(page.getByRole('heading', { name: /трат нет/ })).toBeVisible()
  expect(await topOf(previous)).toBe(120)
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)
})

// The strip «Нет связи» belongs to the month's answer and comes and goes with it: it stands under
// the switcher, so neither its going nor its coming back moves the switcher (MOL-138, В-2).
test('offline, a month not read keeps the switcher where it was, at the top of the page too', async ({
  page,
  context,
}) => {
  await twelveADay(page, [yerevanDay(), lastMonthDay()])
  await context.setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  const strip = page.getByText(/Нет связи. Траты на/)
  await expect(strip).toBeVisible()

  // Not scrolled at all: where «Траты» open, and where nothing can be made up by the scroll
  // (adversarial round 2, Г).
  const previous = page.getByRole('button', { name: 'Предыдущий месяц' })
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  const before = await topOf(previous)
  await previous.click()
  await expect(page).toHaveURL(/month=/)
  await expect(page.getByRole('heading', { name: 'Нет связи' })).toBeVisible()
  await expect(strip).toBeHidden()
  expect(await topOf(previous)).toBe(before)
})

// Both months kept on the phone: each is drawn at once, and «Нет связи» stands through the move —
// under the switcher, where it is checked to be. The strip that does go and come back a moment
// later, «Сервер не ответил» (review С-7, adversarial round 2, Д2), is held by the same place, not
// by a test of its own (review С-10).
test('offline, between two months the phone keeps, the switcher stays over the strip', async ({
  page,
  context,
}) => {
  await twelveADay(page, [yerevanDay(), lastMonthDay()])
  const rows = page.getByRole('button', { name: /Открыть трату/ })
  const previous = page.getByRole('button', { name: 'Предыдущий месяц' })
  const next = page.getByRole('button', { name: 'Следующий месяц' })
  await previous.click()
  await expect(rows).toHaveCount(12)
  await next.click()
  await expect(page).not.toHaveURL(/month=/)

  await context.setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  const strip = page.getByText(/Нет связи. Траты на/)
  await expect(strip).toBeVisible()
  await standAt(previous, 120)
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

  await previous.click()
  await expect(page).toHaveURL(/month=/)
  await expect(strip).toBeVisible()
  await expect(rows).toHaveCount(12)
  expect(await topOf(previous)).toBe(120)
  await next.click()
  await expect(page).not.toHaveURL(/month=/)
  await expect(strip).toBeVisible()
  expect(await topOf(next)).toBe(120)
})

// A refused spending is a row of «Не приняты» on top of «Траты» in every month (MOL-159), never a
// card that drops it; it stands under the switcher and moves nothing as the month changes
// (adversarial round 3, Ж).
test('a refused spending moves nothing as the month changes: its row stands in every month', async ({
  page,
}) => {
  await twelveADay(page, [yerevanDay(), lastMonthDay()])
  await page.route('**/api/spendings', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'error.invalid_amount' }),
        })
      : route.fallback(),
  )
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await writeSpending(page, '1500', 'Транспорт', 'Такси')
  const card = page.getByRole('heading', { name: 'Сервер не принял действие' })
  const row = page.getByRole('button', { name: /Открыть трату: Такси/ })
  const group = page.getByRole('heading', { name: 'Не приняты' })
  await expect(row).toBeVisible()
  await expect(group).toBeVisible()
  await expect(card).toHaveCount(0)

  const previous = page.getByRole('button', { name: 'Предыдущий месяц' })
  await standAt(previous, 120)
  await previous.click()
  await expect(page).toHaveURL(/month=/)
  await expect(row).toBeVisible()
  await expect(card).toHaveCount(0)
  expect(await topOf(previous)).toBe(120)

  const next = page.getByRole('button', { name: 'Следующий месяц' })
  await next.click()
  await expect(page).not.toHaveURL(/month=/)
  await expect(row).toBeVisible()
  await expect(card).toHaveCount(0)
  expect(await topOf(next)).toBe(120)
})

// The login takes the place of the screen with no move of the router: the page held for the month
// must not hold it scrolled off the window (adversarial А).
test('the session over under a changed month: the login stands from the top', async ({
  page,
  context,
}) => {
  await twelveADay(page, [yerevanDay(), lastMonthDay()])
  const previous = page.getByRole('button', { name: 'Предыдущий месяц' })
  await standAt(previous, 120)
  await previous.click()
  await expect(page).toHaveURL(/month=/)
  await expect(page.getByRole('button', { name: /Открыть трату/ })).toHaveCount(12)

  await context.clearCookies()
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  const title = page.getByRole('heading', { level: 1 })
  await expect(title).toHaveText('Вход')
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  expect(await topOf(title)).toBeGreaterThan(0)
  expect(
    await page.evaluate(() => document.documentElement.style.getPropertyValue('--page-hold')),
  ).toBe('')
})

test('a category of one’s own is made from the sheet, and a preset’s name is refused', async ({
  page,
}) => {
  await openMoney(page)
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  const sheet = page.locator('dialog[open]')
  await page.waitForTimeout(400)
  await sheet.getByLabel('Сумма').fill('2000')
  await sheet.getByRole('button', { name: 'Своя' }).click()

  const named = page.locator('dialog[open]').last()
  await expect(named).toContainText('Новая категория')
  await page.waitForTimeout(400)
  await named.getByLabel('Название').fill('Продукты')
  await named.getByRole('button', { name: 'Добавить' }).click()
  await expect(named).toContainText('Такая категория уже есть')
  await named.getByLabel('Название').fill('Такси')
  await named.getByRole('button', { name: 'Добавить' }).click()

  // Chosen as soon as it exists (В-1).
  await expect(sheet.getByRole('radio', { name: 'Такси' })).toBeChecked()
  await sheet.getByRole('button', { name: 'Сохранить трату' }).click()
  await expect(sheet).toBeHidden()

  await page.getByRole('link', { name: /^Категории/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Категории')
  await expect(page.getByText('Такси')).toBeVisible()
  await page.getByRole('button', { name: 'Убрать категорию «Такси»' }).click()
  await expect(page.getByRole('heading', { name: 'Убранные' })).toBeVisible()
  await page.getByRole('button', { name: 'Вернуть категорию «Такси»' }).click()
  await expect(page.getByRole('heading', { name: 'Убранные' })).toBeHidden()
})

async function fitsNarrowPhone(page: Page, money: string): Promise<void> {
  await page.setViewportSize({ width: 320, height: 640 })
  await signedIn(page)
  await page.getByRole('link', { name: money, exact: true }).click()
  const labels = page.locator('.tabbar .label')
  await expect(labels).toHaveCount(5)
  for (const label of await labels.all()) {
    const box = await label.boundingBox()
    const tab = await label.locator('xpath=..').boundingBox()
    // One line of an 11 px caption: «Настройки» and «What to buy» on 64 px columns — and inside
    // its own column, not spilling into the next.
    expect(box?.height ?? 0).toBeLessThan(20)
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(tab?.x ?? 0)
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((tab?.x ?? 0) + (tab?.width ?? 0))
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
}

test('five tabs fit a 320 px phone, one line each', async ({ page }) => {
  await fitsNarrowPhone(page, 'Деньги')
})

test.describe('in English', () => {
  test.use({ locale: 'en-US' })

  test('five tabs fit a 320 px phone, one line each', async ({ page }) => {
    await fitsNarrowPhone(page, 'Money')
  })
})

/** A day of Yerevan's calendar, `days` from today. */
function yerevanDay(days = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yerevan' }).format(
    new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  )
}

test('«Остаток» is the money on the accounts: a spending from one moves it (MOL-134)', async ({
  page,
}) => {
  await signedIn(page)
  const headers = await asBrowser(page)
  const post = async (url: string, data: Record<string, unknown>) => {
    const response = await page.request.post(url, { headers, data })
    expect(response.status(), await response.text()).toBe(201)
  }
  const account = randomUUID()
  await post('/api/money/accounts', {
    id: account,
    name: 'Карта ₽',
    currency: 'RUB',
    savings: false,
    start: { amount: '1000', currency: 'RUB' },
    startOn: yerevanDay(-1),
  })
  const categories = (await (
    await page.request.get('/api/spending-categories', { headers })
  ).json()) as { categories: { id: string }[] }
  await post('/api/spendings', {
    id: randomUUID(),
    spentOn: yerevanDay(),
    amount: { amount: '100', currency: 'RUB' },
    categoryId: categories.categories[0]?.id,
    accountId: account,
  })
  // A newcomer's «Деньги» is an introduction with no month card: the rest is looked at once there
  // is money to count (the tile with no account is a component test's).
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  const tile = page.locator('.tile.rest')
  await expect(tile).toContainText(/≈\s*900\s*₽/)
  await expect(tile).not.toContainText('курс')
})

test('«зарплата — в следующий месяц»: the salary counts next month, and «Пришло» says so (MOL-134)', async ({
  page,
}) => {
  await signedIn(page)
  const headers = await asBrowser(page)
  const receive = async (receivedOn: string) => {
    const response = await page.request.post('/api/incomes', {
      headers,
      data: {
        id: randomUUID(),
        amount: { amount: '1000', currency: 'RUB' },
        receivedOn,
        source: 'salary',
      },
    })
    expect(response.status(), await response.text()).toBe(201)
  }
  const today = yerevanDay()
  const firstOfLastMonth = new Date(`${today.slice(0, 7)}-01T12:00:00Z`)
  firstOfLastMonth.setUTCMonth(firstOfLastMonth.getUTCMonth() - 1)
  await receive(firstOfLastMonth.toISOString().slice(0, 10))
  await receive(today)
  const shift = await page.request.put('/api/actors/me/salary-shift', {
    headers,
    data: { day: 1 },
  })
  expect(shift.status()).toBe(200)

  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  const income = page.locator('.tiles .tile').first()
  // Last month's salary is this month's «Пришло»; today's has gone to the next one.
  await expect(income).toContainText(/1\s*000\s*₽/)
  await expect(income).toContainText('с зарплатой')
  await expect(income).toContainText('— в следующем месяце')
})

/**
 * «Покупки ›» in a new spending (review Р-22): the sheet steps back off its own entry first, and
 * the tab is opened only once that step has landed — in a real browser the sheet hears it is
 * closed from inside the router's `popstate`, and a tab tapped there was dropped (Р-11). Checked
 * with the page's animation and without, since the step lands at a different moment in each.
 */
for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test.describe(`«Покупки ›» from a new spending, motion: ${reducedMotion}`, () => {
    test.use({ reducedMotion })

    test('opens «Покупки», and «back» leaves no sheet behind', async ({ page }) => {
      await openMoney(page)
      await page.getByRole('button', { name: 'Добавить трату' }).click()
      const sheet = page.locator('dialog[open]')
      await expect(sheet).toContainText('Новая трата')
      await page.waitForTimeout(400)
      await sheet.getByRole('button', { name: /Покупки ›/ }).click()

      await expect(page).toHaveURL(/\/purchases$/)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Покупки')
      await expect(sheet).toBeHidden()

      // A tab replaces a tab (`tabMove`): «back» is home, the sheet's entry is gone with it.
      await page.goBack()
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Что брать')
      await expect(page.locator('dialog[open]')).toHaveCount(0)
    })
  })
}

/**
 * Stands in for the iOS keyboard, which no Playwright browser has: the visual viewport is replaced
 * before the app loads, and `keyboard(covered, pan)` moves it — the keys cover the bottom `covered`
 * px of the window, and the visible part is said to be `pan` px down it, as Safari says it on the
 * owner's iPhone (304 for keys of 304, MOL-135) while what a page draws stays where it was. Not all
 * of what Safari was measured doing: it also shrinks the window to the visible part and leaves
 * `dvh`, which a Chromium window cannot, since its `dvh` shrinks along. The same faults show in
 * this geometry: a sheet sized from `dvh` is taller than what is visible, and a lift less the
 * reported scroll leaves it under the keys (MOL-151). The measured numbers are held by
 * `useKeyboardInset.test`.
 */
async function fakeKeyboard(page: Page): Promise<(covered: number, pan: number) => Promise<void>> {
  await page.addInitScript(() => {
    const events = new EventTarget()
    const state = { covered: 0, pan: 0 }
    const viewport = {
      get height() {
        return window.innerHeight - state.covered
      },
      get width() {
        return window.innerWidth
      },
      get offsetTop() {
        return state.pan
      },
      get pageTop() {
        return window.scrollY + state.pan
      },
      offsetLeft: 0,
      pageLeft: 0,
      scale: 1,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    }
    Object.defineProperty(window, 'visualViewport', { get: () => viewport, configurable: true })
    Object.assign(window, {
      keyboard(covered: number, pan: number) {
        state.covered = covered
        state.pan = pan
        events.dispatchEvent(new Event('resize'))
        events.dispatchEvent(new Event('scroll'))
      },
    })
  })
  return async (covered, pan) => {
    await page.evaluate(
      ({ c, p }) => {
        ;(window as unknown as { keyboard: (c: number, p: number) => void }).keyboard(c, p)
      },
      { c: covered, p: pan },
    )
  }
}

/** Where a locator stands against what the fake keyboard leaves visible. */
async function within(page: Page, selector: string, covered: number) {
  return page.evaluate(
    ({ css, c }) => {
      const element = document.querySelector(css)
      if (!element) throw new Error(`nothing at ${css}`)
      const box = element.getBoundingClientRect()
      return { top: box.top >= 0, bottom: box.bottom <= innerHeight - c }
    },
    { css: selector, c: covered },
  )
}

// The sheet's height was a share of `dvh`, which the keyboard does not change: with what is visible
// scrolled down the window, the top went off the screen with the sum (MOL-135).
test('the spending sheet stays in what is visible over the keyboard (MOL-135)', async ({
  page,
}) => {
  const keyboard = await fakeKeyboard(page)
  await openMoney(page)
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  const sheet = page.locator('dialog[open]')
  await expect(sheet).toContainText('Новая трата')
  await page.waitForTimeout(400)
  await expect(sheet.getByLabel('Сумма')).toBeFocused()

  await keyboard(300, 300)
  expect(await within(page, 'dialog[open]', 300)).toEqual({ top: true, bottom: true })
  expect(await within(page, 'dialog[open] input[inputmode="decimal"]', 300)).toEqual({
    top: true,
    bottom: true,
  })
})

// A field focused with the keys down is in sight at the bottom of the tall sheet; the keys come up,
// the sheet is made lower from the top down, and the field is left under its edge — the sheet
// scrolls to it, not the window. The browser's own focus has done its part before, so only the
// sheet's scroll can pass this (review С-2).
test('the field typed in stays in sight as the keyboard makes the sheet lower (MOL-135)', async ({
  page,
}) => {
  const keyboard = await fakeKeyboard(page)
  await openMoney(page)
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  const sheet = page.locator('dialog[open]')
  await expect(sheet).toContainText('Новая трата')
  await page.waitForTimeout(400)

  // Focused where a person left it: at the very bottom of the tall sheet, as a tap there leaves it.
  // Not by `focus()` alone — Chromium would centre it, and the lower sheet would still show it.
  const note = sheet.getByLabel(/Что это/)
  await note.evaluate((field) => {
    field.focus({ preventScroll: true })
    const dialog = field.closest('dialog')
    if (!dialog) throw new Error('the field is not in a sheet')
    dialog.scrollTop +=
      field.getBoundingClientRect().bottom - dialog.getBoundingClientRect().bottom + 8
  })
  const place = () =>
    note.evaluate((field) => {
      const dialog = field.closest('dialog')
      if (!dialog) throw new Error('the field is not in a sheet')
      const box = dialog.getBoundingClientRect()
      const own = field.getBoundingClientRect()
      return { inside: own.top >= box.top && own.bottom <= box.bottom, scrolled: dialog.scrollTop }
    })
  const before = await place()
  expect(before.inside).toBe(true)

  await keyboard(300, 300)
  const after = await place()
  expect(after.inside).toBe(true)
  expect(after.scrolled).toBeGreaterThan(before.scrolled)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})

// The first keyboard of a page came 300–800 ms after the focus on the owner's iPhone, once the sheet
// had risen; the page drew nothing meanwhile, and iOS slid the last picture up with the keys — the
// sheet in it the screen's share, its top off the screen (MOL-151). With the height the keys left
// last time remembered, the sheet rises already that high, and the keys coming late change nothing.
test('the spending sheet rises as high as the keys leave it, before they come (MOL-151)', async ({
  page,
}) => {
  const keyboard = await fakeKeyboard(page)
  await openMoney(page)
  const visible = await page.evaluate(() => {
    const height = Math.round(innerHeight * 0.55)
    const kept = { [`decimal ${String(innerHeight)}x${String(innerWidth)}`]: height }
    localStorage.setItem('molvia.keyboard', JSON.stringify(kept))
    return height
  })
  // Every frame from the tap on: how tall the sheet is, and where its top stands.
  await page.evaluate(() => {
    const seen: { height: number; top: number }[] = []
    Object.assign(window, { seen })
    const look = () => {
      const dialog = document.querySelector('dialog[open]')
      if (dialog) {
        const box = dialog.getBoundingClientRect()
        seen.push({ height: Math.round(box.height), top: Math.round(box.top) })
      }
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  const sheet = page.locator('dialog[open]')
  await expect(sheet.getByLabel('Сумма')).toBeFocused()
  await page.waitForTimeout(400)
  const covered = (await page.evaluate(() => innerHeight)) - visible
  await keyboard(covered, covered)
  await page.waitForTimeout(200)

  const seen = await page.evaluate(
    () => (window as unknown as { seen: { height: number; top: number }[] }).seen,
  )
  expect(seen.length).toBeGreaterThan(10)
  expect(new Set(seen.map((frame) => frame.height)).size).toBe(1)
  expect(seen[0]?.height).toBeLessThanOrEqual(Math.ceil(visible * 0.82))
  expect(await within(page, 'dialog[open]', covered)).toEqual({ top: true, bottom: true })
})
