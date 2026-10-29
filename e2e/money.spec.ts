import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { fakeKeyboard } from './keyboard'
import { facesIn, standAt, topOf } from './scroll'
import { asBrowser, signedIn } from './session'
import { chooseCategory } from './category'
import { fillDetails, openDetails } from './spending-details'

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
  await chooseCategory(page, category)
  if (note) await fillDetails(page, { note })
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
  await chooseCategory(page, 'Красота и гигиена')
  await fillDetails(page, { note: 'Барбер' })
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
  // One place (Ф-29): 8 over the strip, and «Добавить трату» whole under it and the one tapped.
  const add = page.getByRole('button', { name: 'Добавить трату' })
  const [strip, dock, added] = await Promise.all([
    page.locator('.undo-strip').boundingBox(),
    page.locator('.dock').boundingBox(),
    add.boundingBox(),
  ])
  expect(Math.round((dock?.y ?? 0) - ((strip?.y ?? 0) + (strip?.height ?? 0)))).toBe(8)
  const centre = {
    x: (added?.x ?? 0) + (added?.width ?? 0) / 2,
    y: (added?.y ?? 0) + (added?.height ?? 0) / 2,
  }
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent.trim(),
      centre,
    ),
  ).toBe('Добавить трату')
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

// The rhythm of 157 v2 02 (MOL-184, Ф-10): the field is `AppScreen`'s 16, not 32; 24 between the
// days, 8 from a day's words to its card.
test('«Траты» stand in the field of 16, the days 24 apart and 8 over their cards (MOL-184)', async ({
  page,
}) => {
  // This month's twelve open «Траты»; the two days measured are last month's, on any day of this one.
  const fifteenth = lastMonthDay()
  await twelveADay(page, [yerevanDay(), fifteenth, `${fifteenth.slice(0, 8)}14`])
  await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
  await expect(page.locator('.days section.day')).toHaveCount(2)
  const measured = await page.locator('.days').evaluate((root) => {
    const [first, second] = [...root.querySelectorAll(':scope section.day')]
    const box = (node: Element | null | undefined) => node?.getBoundingClientRect()
    return {
      left: box(first?.querySelector('.card'))?.left ?? Number.NaN,
      // The total heads the column, 24 over its first day (review Р2-3).
      underTotal:
        (box(first)?.top ?? Number.NaN) -
        (box(document.querySelector('.content > .total'))?.bottom ?? Number.NaN),
      between: (box(second)?.top ?? Number.NaN) - (box(first)?.bottom ?? Number.NaN),
      overCard:
        (box(first?.querySelector('.card'))?.top ?? Number.NaN) -
        (box(first?.querySelector('.day-head'))?.bottom ?? Number.NaN),
    }
  })
  expect(measured).toEqual({ left: 16, underTotal: 24, between: 24, overCard: 8 })
})

// A day of one spending in dollars with no rate of its day (MOL-184, В-1, В-2): the end-to-end API
// keeps no rate, so the dollars are «не посчитано» — the day says them, never «≈ 0 ֏».
test('a day with no rate says its dollars, and the month’s total names them', async ({ page }) => {
  await signedIn(page)
  const headers = await asBrowser(page)
  const { categories } = (await (
    await page.request.get('/api/spending-categories', { headers })
  ).json()) as { categories: { id: string }[] }
  const response = await page.request.post('/api/spendings', {
    headers,
    data: {
      id: randomUUID(),
      spentOn: yerevanDay(),
      amount: { amount: '50', currency: 'USD' },
      categoryId: categories[0]?.id,
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await openSpendings(page)
  await expect(page.locator('.day-total')).toHaveText(/^50\s\$$/)
  await expect(page.locator('.total')).toContainText(/Не посчитано: 50\s\$ — курса того дня нет/)
})

// The longest head a person makes: drams and three currencies with their cents, none with a rate
// (adversarial round 2 of MOL-184, «не атаковано»). On 320 the day's words give way and the sum stays
// in the column of the rows' amounts, inside its card.
test('at 320 a day’s sum of four currencies stays in the column, inside the card', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 840 })
  await signedIn(page)
  const headers = await asBrowser(page)
  const { categories } = (await (
    await page.request.get('/api/spending-categories', { headers })
  ).json()) as { categories: { id: string }[] }
  for (const [amount, currency] of [
    // A figure wider than 60 % of the head once the font is doubled (review Р4-1).
    ['5000012400', 'AMD'],
    ['1234.56', 'RUB'],
    ['10.50', 'EUR'],
    ['0.40', 'USD'],
  ]) {
    const response = await page.request.post('/api/spendings', {
      headers,
      data: {
        id: randomUUID(),
        spentOn: yerevanDay(),
        amount: { amount, currency },
        categoryId: categories[0]?.id,
      },
    })
    expect(response.status(), await response.text()).toBe(201)
  }
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await openSpendings(page)
  const total = page.locator('.day-total')
  await expect(total).toHaveText(/^5\s000\s012\s400\s֏\s\+ 10,50\s€\s\+ 1\s234,56\s₽\s\+ 0,40\s\$$/)
  const edges = await page
    .locator('section.day')
    .first()
    .evaluate((root) => ({
      total: root.querySelector('.day-total')?.getBoundingClientRect().right ?? Number.NaN,
      card: root.querySelector('.card')?.getBoundingClientRect().right ?? Number.NaN,
      amounts: [...root.querySelectorAll('.list-row .amount')].map(
        (one) => one.getBoundingClientRect().right,
      ),
      page: document.documentElement.scrollWidth,
    }))
  for (const amount of edges.amounts) expect(amount).toBeCloseTo(edges.total, 1)
  expect(edges.total).toBeLessThanOrEqual(edges.card)
  expect(edges.page).toBe(320)

  // A large system font: a figure wider than 60 % of the head takes the room from the day's words,
  // never stands past the column (MOL-184, adversarial round 3).
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  const large = await page
    .locator('section.day')
    .first()
    .evaluate((root) => {
      const total = root.querySelector('.day-total')
      const head = root.querySelector('.day-head')
      const style = head ? getComputedStyle(head) : null
      const room =
        (head?.clientWidth ?? Infinity) -
        Number.parseFloat(style?.paddingLeft ?? '0') -
        Number.parseFloat(style?.paddingRight ?? '0')
      return {
        // «5 000 012 400 ֏ +» is wider than 60 % of the head's room: without `min-content` it stood
        // past its box.
        wider: (total?.scrollWidth ?? 0) > 0.6 * room,
        overflow: (total?.scrollWidth ?? 0) - (total?.clientWidth ?? 0),
        inside:
          (total?.getBoundingClientRect().right ?? Infinity) <=
          (root.querySelector('.card')?.getBoundingClientRect().right ?? 0),
      }
    })
  expect(large).toEqual({ wider: true, overflow: 0, inside: true })
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
  await standAt(previous, 100)
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
  await standAt(previous, 100)
  const scrolled = await page.evaluate(() => window.scrollY)
  expect(scrolled).toBeGreaterThan(0)

  await previous.click()
  await expect(page.getByRole('heading', { name: /трат нет/ })).toBeVisible()
  expect(await topOf(previous)).toBe(100)
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)
})

// The strip «Без связи» belongs to the month's answer and comes and goes with it: it stands under
// the switcher, so neither its going nor its coming back moves the switcher (MOL-138, В-2).
test('offline, a month not read keeps the switcher where it was, at the top of the page too', async ({
  page,
  context,
}) => {
  await twelveADay(page, [yerevanDay(), lastMonthDay()])
  await context.setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  const strip = page.locator('.strip', { hasText: /Без связи · траты на/ })
  await expect(strip).toBeVisible()

  // Not scrolled at all: where «Траты» open, and where nothing can be made up by the scroll
  // (adversarial round 2, Г).
  const previous = page.getByRole('button', { name: 'Предыдущий месяц' })
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  // No scene to set, so the faces are waited for here, as `standAt` waits for them (MOL-267).
  await facesIn(page)
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
  const strip = page.locator('.strip', { hasText: /Без связи · траты на/ })
  await expect(strip).toBeVisible()
  await standAt(previous, 100)
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

  await previous.click()
  await expect(page).toHaveURL(/month=/)
  await expect(strip).toBeVisible()
  await expect(rows).toHaveCount(12)
  expect(await topOf(previous)).toBe(100)
  await next.click()
  await expect(page).not.toHaveURL(/month=/)
  await expect(strip).toBeVisible()
  expect(await topOf(next)).toBe(100)
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
  // «Не приняты» is a group of its own: 24 from the switcher over it and the total under it
  // (MOL-184, review Р2-3).
  const around = await page.locator('section.refused').evaluate((section) => ({
    over:
      section.getBoundingClientRect().top -
      (document.querySelector('.content > .switcher')?.getBoundingClientRect().bottom ??
        Number.NaN),
    under:
      (document.querySelector('.content > .total')?.getBoundingClientRect().top ?? Number.NaN) -
      section.getBoundingClientRect().bottom,
  }))
  expect(around).toEqual({ over: 24, under: 24 })

  const previous = page.getByRole('button', { name: 'Предыдущий месяц' })
  await standAt(previous, 100)
  await previous.click()
  await expect(page).toHaveURL(/month=/)
  await expect(row).toBeVisible()
  await expect(card).toHaveCount(0)
  expect(await topOf(previous)).toBe(100)

  const next = page.getByRole('button', { name: 'Следующий месяц' })
  await next.click()
  await expect(page).not.toHaveURL(/month=/)
  await expect(row).toBeVisible()
  await expect(card).toHaveCount(0)
  expect(await topOf(next)).toBe(100)
})

// The login takes the place of the screen with no move of the router: the page held for the month
// must not hold it scrolled off the window (adversarial А).
test('the session over under a changed month: the login stands from the top', async ({
  page,
  context,
}) => {
  await twelveADay(page, [yerevanDay(), lastMonthDay()])
  const previous = page.getByRole('button', { name: 'Предыдущий месяц' })
  await standAt(previous, 100)
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

// MOL-198, Ф-17: two rows of chips, «Ещё…» last in the second, and «Сохранить трату» in sight without a
// scroll — 21 chips in six rows pushed it off the screen. The order is the person's, by frequency: a
// spending in a category the rows did not hold stands it first at the next opening.
test('the chips stand in two rows by frequency, «Ещё…» last, «Сохранить трату» in sight', async ({
  page,
}) => {
  await openMoney(page)
  const sheet = page.locator('dialog[open]').first()
  const rows = sheet.locator('.chips .row')
  const opened = async () => {
    await page.getByRole('button', { name: 'Добавить трату' }).click()
    await expect(sheet).toContainText('Новая трата')
    await page.waitForTimeout(400)
  }
  const twoRows = async () => {
    await expect(rows).toHaveCount(2)
    // Each row on one line, as tall as a chip.
    for (const row of await rows.all()) expect((await row.boundingBox())?.height).toBeCloseTo(44, 2)
    await expect(rows.last().locator('> *').last()).toHaveText('Ещё…')
    await expect(sheet.getByRole('button', { name: 'Ещё…' })).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    )
    await expect(sheet.getByRole('button', { name: 'Сохранить трату' })).toBeInViewport()
  }

  await opened()
  await twoRows()
  // A newcomer's are the presets as listed: «Документы» is in «Ещё…», not in the rows.
  await expect(rows.first().getByRole('radio').first()).toHaveAccessibleName('Продукты')
  await expect(sheet.locator('.chips').getByRole('radio', { name: 'Документы' })).toHaveCount(0)
  await sheet.getByLabel('Сумма').fill('3000')
  await chooseCategory(page, 'Документы')
  await sheet.getByRole('button', { name: 'Сохранить трату' }).click()
  await expect(sheet).toBeHidden()
  // The month read again with the spending in it names «Документы» frequent.
  await expect(page.getByRole('link', { name: 'Траты, 1' })).toBeVisible()

  await page.setViewportSize({ width: 320, height: 640 })
  await opened()
  await twoRows()
  await expect(rows.first().getByRole('radio').first()).toHaveAccessibleName('Документы')
})

/** How far the sheet goes sideways, and whether any chip stands past its field. */
function sideways(sheet: Locator): Promise<{ sheet: number; past: string[] }> {
  return sheet.evaluate((dialog) => {
    const edge = dialog.querySelector('.chips-field')?.getBoundingClientRect().right ?? 0
    return {
      sheet: dialog.scrollWidth - dialog.clientWidth,
      past: [...dialog.querySelectorAll('.chips .chip')]
        .filter((chip) => chip.getBoundingClientRect().right > edge + 0.5)
        .map((chip) => chip.textContent?.trim() ?? ''),
    }
  })
}

// MOL-318: a row on one line gave the sheet's grid the whole name of its first chip as its least width,
// and a long one of one's own, chosen and so first, took the sheet — × and all — past the phone, more so
// once turned from wide to narrow, the rows laid for the wide one. A newcomer at 320 had «Продукты» alone
// in the first row, the chips at 15 with sides of 12 and 16.
test('a long name of one’s own is cut in the chips, and the sheet never goes sideways', async ({
  page,
}) => {
  const long = 'Подарки родным и друзьям на дни рождения'
  await page.setViewportSize({ width: 412, height: 760 })
  await signedIn(page)
  const made = await page.request.post('/api/spending-categories', {
    headers: await asBrowser(page),
    data: { id: randomUUID(), name: long },
  })
  expect(made.status(), await made.text()).toBe(201)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')

  const sheet = page.locator('dialog[open]').first()
  const rows = sheet.locator('.chips .row')
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await expect(sheet).toContainText('Новая трата')
  await page.waitForTimeout(400)
  await chooseCategory(page, long)
  await expect(rows.first().getByRole('radio').first()).toHaveAccessibleName(long)
  expect(await sideways(sheet)).toEqual({ sheet: 0, past: [] })

  // Turned to a narrow phone with the rows laid for the wide one.
  await page.setViewportSize({ width: 320, height: 640 })
  await expect(rows.first().getByRole('radio').first()).toHaveAccessibleName(long)
  await expect.poll(() => sideways(sheet)).toEqual({ sheet: 0, past: [] })
  const name = sheet.locator('.chips .chip.on .name')
  expect(await name.evaluate((one) => one.scrollWidth > one.clientWidth)).toBe(true)
  await expect(rows).toHaveCount(2)
  for (const row of await rows.all()) expect((await row.boundingBox())?.height).toBeCloseTo(44, 2)
  await expect(sheet.getByRole('button', { name: 'Закрыть' })).toBeInViewport({ ratio: 1 })

  // A newcomer's two first at 320 stand side by side.
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await expect(sheet).toContainText('Новая трата')
  await page.waitForTimeout(400)
  await expect(rows.first().locator('.chip')).toHaveText(['Продукты', 'Кафе и рестораны'])
  expect(await sideways(sheet)).toEqual({ sheet: 0, past: [] })
})

test('a category of one’s own is made from the sheet, and a preset’s name is refused', async ({
  page,
}) => {
  await openMoney(page)
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  const sheet = page.locator('dialog[open]')
  await page.waitForTimeout(400)
  await sheet.getByLabel('Сумма').fill('2000')
  // «+ Своя» is the last row of «Ещё…», and a new one is a third sheet over it (MOL-198, С-16).
  await sheet.getByRole('button', { name: 'Ещё…' }).click()
  const list = page.locator('dialog[open]').last()
  await expect(list).toContainText('Категория')
  await page.waitForTimeout(400)
  await list.getByRole('button', { name: 'Своя' }).click()

  const named = page.locator('dialog[open]').last()
  await expect(named).toContainText('Новая категория')
  await page.waitForTimeout(400)
  await named.getByLabel('Название').fill('Продукты')
  await named.getByRole('button', { name: 'Добавить' }).click()
  await expect(named).toContainText('Такая категория уже есть')
  await named.getByLabel('Название').fill('Такси')
  await named.getByRole('button', { name: 'Добавить' }).click()

  // Chosen as soon as it exists (В-1), the list gone with its sheet and the new one first (owner's
  // В-1 «а», В-2 «а» of MOL-198).
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await expect(sheet.locator('.chips').getByRole('radio').first()).toHaveAccessibleName('Такси')
  await expect(sheet.getByRole('radio', { name: 'Такси' })).toBeChecked()
  await sheet.getByRole('button', { name: 'Сохранить трату' }).click()
  await expect(sheet).toBeHidden()

  await page.getByRole('link', { name: /^Категории/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Категории')
  await expect(page.getByText('Такси')).toBeVisible()
  // One's own is taken out from its sheet (MOL-285, В-2 «а»).
  await removeOwn(page, 'Такси')
  await expect(page.getByRole('heading', { name: 'Убранные' })).toBeVisible()
  await page.getByRole('button', { name: 'Вернуть категорию «Такси»' }).click()
  await expect(page.getByRole('heading', { name: 'Убранные' })).toBeHidden()
})

// «Дата, заметка, место» is a sheet over the spending (MOL-199, Д-1): «‹» and no ×, one scrim, Esc takes
// it alone; what is typed is in the line at once, and a wrong one is opened by «Сохранить трату».
test('the day, the note and the place are behind one line, in a sheet over the spending', async ({
  page,
}) => {
  await openMoney(page)
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  const sheet = page.locator('dialog[open]').first()
  await expect(sheet).toContainText('Новая трата')
  await page.waitForTimeout(400)
  const line = sheet.getByRole('button', { name: /^Дата, заметка, место:/ })
  await expect(line).toHaveAccessibleName('Дата, заметка, место: Сегодня · без заметки')
  await expect(sheet.getByLabel(/Что это/)).toHaveCount(0)

  const details = await openDetails(page)
  await expect(page.locator('dialog[open]')).toHaveCount(2)
  await expect(details.getByRole('button', { name: 'Назад' })).toBeVisible()
  await expect(details.getByRole('button', { name: 'Закрыть' })).toHaveCount(0)
  await details.getByLabel(/Что это/).fill('Обед')
  await details.getByLabel(/Где/).fill('Кинза')
  await expect(line).toHaveText('Сегодня · Обед · Кинза')
  // Esc takes the details alone, and the focus goes back to the line it was opened from.
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await expect(line).toBeFocused()
  await expect(line).toHaveText('Сегодня · Обед · Кинза')

  // A day the picker cleared: «Сохранить трату» opens the details on it, and the line is marked.
  await sheet.getByLabel('Сумма').fill('2500')
  await chooseCategory(page, 'Кафе и рестораны')
  const again = await openDetails(page)
  await again.getByLabel('Когда').fill('')
  await again.getByRole('button', { name: 'Готово' }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await sheet.getByRole('button', { name: 'Сохранить трату' }).click()
  const opened = page.locator('dialog[open]').last()
  await expect(opened).toContainText('Выберите день не позже сегодняшнего')
  await expect(opened.getByLabel('Когда')).toBeFocused()
  await expect(line).toHaveAttribute('aria-invalid', 'true')
})

// The line is a row of the kit in the form too — the sheet's own `.field` stood it in a column 84 high
// (adversarial А1) — and a long note ends in «…» inside it: without `width: 0` its whole line widened
// the sheet past a phone, × off the screen (А3). At 320, where the fewest letters do it (self-review 3).
test('the line of the day, the note and the place is one row, and a long one ends in «…» at 320', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await openMoney(page)
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  const sheet = page.locator('dialog[open]').first()
  await expect(sheet).toContainText('Новая трата')
  await page.waitForTimeout(400)
  const line = sheet.getByRole('button', { name: /^Дата, заметка, место:/ })
  const shape = () =>
    line.evaluate((row) => {
      const rect = (selector: string): DOMRect => {
        const found = row.querySelector(selector)
        if (!found) throw new Error(`no ${selector} in the line`)
        return found.getBoundingClientRect()
      }
      const dialog = row.closest('dialog')
      const label = row.querySelector('.label')
      if (!dialog || !label) throw new Error('the line is not in a sheet')
      const own = row.getBoundingClientRect()
      const [icon, text, chevron] = [rect('.icon'), rect('.label'), rect('.chevron')]
      return {
        height: own.height,
        row: icon.right <= text.left && text.right <= chevron.left,
        inside: chevron.right <= own.right && own.right <= dialog.getBoundingClientRect().right,
        wider: dialog.scrollWidth - dialog.clientWidth,
        cut: label.scrollWidth > label.clientWidth,
      }
    })
  // Widths are measured once the faces have come (MOL-306). At 320 even «Сегодня · без заметки» needs
  // 185 of the label's 166 and ends in «…» — the price, named in `money-spendings.md`; from 375 it fits.
  await facesIn(page)
  expect(await shape()).toMatchObject({ row: true, inside: true, wider: 0 })
  expect((await shape()).height).toBeLessThan(60)

  const note = 'Подарок коллеге на день рождения'
  await fillDetails(page, { note, place: 'Торговый центр «Ташир»' })
  expect(await shape()).toMatchObject({ row: true, inside: true, wider: 0, cut: true })
  expect((await shape()).height).toBeLessThan(60)
  await expect(line).toHaveAccessibleName(
    `Дата, заметка, место: Сегодня · ${note} · Торговый центр «Ташир»`,
  )
  // × stays on the screen: the sheet is no wider than the window.
  const close = sheet.getByRole('button', { name: 'Закрыть' })
  const box = await close.boundingBox()
  expect(box && box.x + box.width).toBeLessThanOrEqual(320)
})

test('a category is made from the strip of «Категории», removed quietly and brought back', async ({
  page,
}) => {
  await openMoney(page)
  await page.getByRole('link', { name: /^Категории/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Категории')

  // The main action stands in the strip over the tab bar, not over the list (MOL-191, Ф-28).
  const add = page.locator('.dock').getByRole('button', { name: 'Добавить категорию' })
  await add.click()
  const sheet = page.locator('dialog[open]')
  await expect(sheet).toContainText('Новая категория')
  await page.waitForTimeout(400)
  await sheet.getByLabel('Название').fill('Подарки')
  await sheet.getByRole('button', { name: 'Добавить' }).click()
  await expect(sheet).toBeHidden()
  await expect(add).toBeFocused()

  const live = page.locator('section', { has: page.getByRole('heading', { name: 'Свои' }) })
  await expect(live.getByText('Подарки')).toBeVisible()
  await expect(live.getByText('Отправляем…')).toBeHidden()
  await removeOwn(page, 'Подарки')
  const archived = page.locator('section', { has: page.getByRole('heading', { name: 'Убранные' }) })
  await expect(archived.getByText('Подарки')).toBeVisible()
  await page.getByRole('button', { name: 'Вернуть категорию «Подарки»' }).click()
  await expect(page.getByRole('heading', { name: 'Убранные' })).toBeHidden()
  await expect(live.getByText('Подарки')).toBeVisible()
})

/** One's own opened from «Категории» and taken out from its sheet (MOL-285). */
async function removeOwn(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click()
  const sheet = page.locator('dialog[open]')
  await expect(sheet).toContainText('Категория')
  await page.waitForTimeout(400)
  await sheet.getByRole('button', { name: 'Убрать категорию' }).click()
  await expect(sheet).toBeHidden()
}

// The icon and the colour go to the server and back, and «Траты» draw the category by them (MOL-285).
test('one’s own takes the icon and the colour chosen, and its sheet amends them', async ({
  page,
}) => {
  await openMoney(page)
  await page.getByRole('link', { name: /^Категории/ }).click()
  await page.locator('.dock').getByRole('button', { name: 'Добавить категорию' }).click()
  const sheet = page.locator('dialog[open]')
  await expect(sheet).toContainText('Новая категория')
  await page.waitForTimeout(400)
  // A new one starts on the tag and the first colour of the palette.
  await expect(sheet.getByRole('radio', { name: 'Бирка' })).toBeChecked()
  await expect(sheet.getByRole('radio', { name: 'Цвет 1 из 8' })).toBeChecked()
  await sheet.getByLabel('Название').fill('Подарки')
  await sheet.getByRole('radio', { name: 'Подарок' }).check()
  await sheet.getByRole('radio', { name: 'Цвет 6 из 8' }).check()
  await sheet.getByRole('button', { name: 'Добавить' }).click()
  await expect(sheet).toBeHidden()

  const own = page.locator('section', { has: page.getByRole('heading', { name: 'Свои' }) })
  const row = own.getByRole('button', { name: 'Подарки', exact: true })
  await expect(row.locator('.circle')).toHaveAttribute('style', /--cat-own-5/)
  await expect(own.getByText('Отправляем…')).toBeHidden()

  // Read again from the server, the sheet opens on what it holds.
  await page.reload()
  await row.click()
  await expect(sheet).toContainText('Категория')
  await page.waitForTimeout(400)
  await expect(sheet.getByLabel('Название')).toHaveValue('Подарки')
  await expect(sheet.getByRole('radio', { name: 'Подарок' })).toBeChecked()
  await expect(sheet.getByRole('radio', { name: 'Цвет 6 из 8' })).toBeChecked()
  await sheet.getByLabel('Название').fill('Подарки и цветы')
  await sheet.getByRole('radio', { name: 'Цветы' }).check()
  await sheet.getByRole('button', { name: 'Сохранить' }).click()
  await expect(sheet).toBeHidden()
  const amended = own.getByRole('button', { name: 'Подарки и цветы', exact: true })
  await expect(amended).toBeVisible()
  await expect(own.getByText('Отправляем…')).toBeHidden()
  const drawn = await amended.locator('.circle svg').innerHTML()

  // A spending in it is drawn by the same icon and colour on «Траты».
  await page.goBack()
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await writeSpending(page, '3000', 'Подарки и цветы', 'Букет')
  await openSpendings(page)
  const spent = page.locator('.list-row', { hasText: 'Букет' })
  await expect(spent.locator('.circle')).toHaveAttribute('style', /--cat-own-5/)
  expect(await spent.locator('.circle svg').innerHTML()).toBe(drawn)
})

// The skeleton is the answer's shape (Ф-13, MOL-178): its rows as tall as the rows that come, a button of
// 44 in their tail — and no strip under it: the sheet knows one's own names from the list alone (В-2 «а»).
test('the skeleton of «Категории» is as tall, row by row, as the list that comes', async ({
  page,
}) => {
  let release: () => void = () => undefined
  let hold = false
  await page.route('**/api/spending-categories', async (route) => {
    if (hold) await new Promise<void>((resolve) => (release = resolve))
    await route.continue()
  })
  await openMoney(page)
  hold = true
  await page.getByRole('link', { name: /^Категории/ }).click()
  const skeleton = page.locator('.skeleton-rows .item')
  await expect(skeleton).toHaveCount(6)
  const add = page.locator('.dock').getByRole('button', { name: 'Добавить категорию' })
  await expect(add).toBeHidden()
  const bars = await skeleton.evaluateAll((rows) =>
    rows.map((row) => row.getBoundingClientRect().height),
  )
  hold = false
  release()
  const rows = page.locator('.list-row')
  await expect(rows.first()).toBeVisible()
  await expect(add).toBeVisible()
  const answer = await rows.evaluateAll((all) =>
    all.slice(0, 6).map((row) => row.parentElement?.getBoundingClientRect().height ?? 0),
  )
  expect(answer).toHaveLength(6)
  for (const [index, height] of bars.entries()) expect(height).toBeCloseTo(answer[index] ?? 0, 0)
  // The row keeps 64 by its button standing over its padding, and the button keeps its 44.
  const target = await page
    .getByRole('button', { name: /^Убрать категорию/ })
    .first()
    .boundingBox()
  expect(target?.height).toBeCloseTo(44, 0)
})

/** The words of the names of «Категории» that stand on two lines: broken in their middle. */
async function brokenWords(page: Page): Promise<string[]> {
  await expect(page.locator('.lists .title').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  return page.evaluate(() =>
    [...document.querySelectorAll('.lists .title')].flatMap((title) => {
      const text = [...title.childNodes].find(
        (node): node is Text => node instanceof Text && node.data.trim() !== '',
      )
      if (!text) return []
      return [...text.data.matchAll(/\S+/g)].flatMap((match) => {
        const range = document.createRange()
        range.setStart(text, match.index)
        range.setEnd(text, match.index + match[0].length)
        const lines = new Set(
          [...range.getClientRects()]
            .filter((rect) => rect.width > 0)
            .map((rect) => Math.round(rect.top)),
        )
        return lines.size > 1 ? [match[0]] : []
      })
    }),
  )
}

// At 320 the words of a row had some 100 px beside a circle of 40 and a button of 90, and «Развлечения»
// broke in its middle (adversarial А2 of MOL-191) — and under «Вернуть», wider than «Убрать», with the
// button's sides of 8 alone still (Б1). So the longest word is taken out first: both tails are measured.
for (const locale of ['ru-RU', 'en-US'])
  test.describe(`at 320 in ${locale}`, () => {
    test.use({ locale, viewport: { width: 320, height: 844 } })

    test('no name of a category breaks in the middle of a word, in either group', async ({
      page,
    }) => {
      await signedIn(page)
      const headers = await asBrowser(page)
      const { categories } = (await (
        await page.request.get('/api/spending-categories', { headers })
      ).json()) as { categories: { id: string; preset: string | null }[] }
      const leisure = categories.find((category) => category.preset === 'leisure')
      expect(leisure).toBeDefined()
      const removed = await page.request.delete(`/api/spending-categories/${leisure?.id ?? ''}`, {
        headers,
      })
      expect(removed.ok()).toBe(true)

      await page.goto('/money/categories')
      await expect(page.locator('.lists .group')).toHaveCount(2)
      expect(await brokenWords(page)).toEqual([])
    })
  })

async function fitsNarrowPhone(page: Page, money: string): Promise<void> {
  await page.setViewportSize({ width: 320, height: 640 })
  await signedIn(page)
  await page.getByRole('link', { name: money, exact: true }).click()
  const labels = page.locator('.tabbar .label')
  await expect(labels).toHaveCount(5)
  // Each label at 700 too, as the current tab draws it (Ф-5) — the widest ones are the ones at risk.
  for (const tab of await page.locator('.tabbar a').all()) {
    await tab.click()
    await expect(tab).toHaveAttribute('aria-current', 'page')
    await fitsItsColumn(labels)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
}

async function fitsItsColumn(labels: Locator): Promise<void> {
  for (const label of await labels.all()) {
    const box = await label.boundingBox()
    const tab = await label.locator('xpath=..').boundingBox()
    // One line of an 11 px caption: «Настройки» and «What to buy» on 64 px columns — and inside
    // its own column, not spilling into the next.
    expect(box?.height ?? 0).toBeLessThan(20)
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(tab?.x ?? 0)
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((tab?.x ?? 0) + (tab?.width ?? 0))
  }
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

// «На счетах сейчас» (MOL-183, Ф-27): the money on the accounts now, in the income currency, over the
// switcher — the same balances «Счета» add up, and «now», not the month's.
test('«На счетах сейчас» is the money on the accounts: a spending from one moves it (MOL-134, MOL-183)', async ({
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
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  const now = page.getByRole('link', { name: /^Счета: на счетах сейчас ≈\s*900\s*₽/ })
  await expect(now).toBeVisible()
  await expect(now).not.toContainText('курс')
  const previous = page.getByRole('button', { name: 'Предыдущий месяц' })
  // Over the switcher, and one way to the accounts: no row «Счета» among the ways out (С-10).
  const [card, switcher] = await Promise.all([now.boundingBox(), previous.boundingBox()])
  expect((card?.y ?? 0) + (card?.height ?? 0)).toBeLessThan(switcher?.y ?? 0)
  await expect(page.getByRole('navigation').getByRole('link', { name: /^Счета/ })).toHaveCount(0)

  // «Now», not the month's: the month before shows it the same, and stays where it was.
  await previous.click()
  await expect(page).toHaveURL(/month=/)
  await expect(now).toBeVisible()
  await now.click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Счета')
})

// «Куда ушли» of a month with nothing spent (MOL-183, С-13): the same card of the same height, so the
// first spending moves nothing under it — the dashed ring, «0 ֏» and the month's words.
test('a month with nothing spent keeps «Куда ушли» as tall as with a spending', async ({
  page,
}) => {
  await signedIn(page)
  const headers = await asBrowser(page)
  const categories = (await (
    await page.request.get('/api/spending-categories', { headers })
  ).json()) as { categories: { id: string }[] }
  // Last month spent in: this one is a month, not a newcomer's introduction.
  const last = await page.request.post('/api/spendings', {
    headers,
    data: {
      id: randomUUID(),
      spentOn: lastMonthDay(),
      amount: { amount: '2500', currency: 'AMD' },
      categoryId: categories.categories[0]?.id,
    },
  })
  expect(last.status(), await last.text()).toBe(201)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  const card = page.locator('.donut')
  await expect(card).toContainText(/трат пока нет/)
  await expect(card.locator('circle.none')).toHaveCount(1)
  await expect(card).toContainText(/0\s*֏/)
  const empty = await card.boundingBox()

  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await writeSpending(page, '1500', 'Кафе и рестораны')
  await expect(card.locator('.sector')).toHaveCount(1)
  await expect(card.locator('circle.none')).toHaveCount(0)
  const spent = await card.boundingBox()
  expect(Math.round(spent?.height ?? 0)).toBe(Math.round(empty?.height ?? 0))
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

// A field focused with the keys down is in sight at the bottom of its sheet; the keys come up, the
// sheet is made lower from the top down, and the field is left under its edge — the sheet scrolls to
// it, not the window. The browser's own focus has done its part before, so only the sheet's scroll can
// pass this (review С-2). Since MOL-199 the last field typed in is «Где» of «Дата, заметка, место»,
// a sheet short enough that an iPhone SE's window, not a Pixel's, leaves it under the keys.
test('the field typed in stays in sight as the keyboard makes the sheet lower (MOL-135)', async ({
  page,
}) => {
  const keyboard = await fakeKeyboard(page)
  await page.setViewportSize({ width: 375, height: 667 })
  await openMoney(page)
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await expect(page.locator('dialog[open]')).toContainText('Новая трата')
  await page.waitForTimeout(400)
  const sheet = await openDetails(page)

  // Focused where a person left it: at the very bottom of the sheet, as a tap there leaves it.
  // Not by `focus()` alone — Chromium would centre it, and the lower sheet would still show it.
  const note = sheet.getByLabel(/Где/)
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

// The ways out are not under the month's skeleton (MOL-269): there the answer moved them from under
// the finger — 291 px up for a newcomer, 99 down with a spending — and the tap aimed at «Обмен денег»
// went nowhere, as it did in CI. They come once the month and «Счета» have both answered, «Счета»
// too since their card over the switcher moves them as well. The test holds the order, not the runner.
test('the ways out come with the answers of the month and «Счета», and a tap leads where it says', async ({
  page,
}) => {
  const hold = async (url: string): Promise<() => void> => {
    let release: () => void = () => undefined
    const released = new Promise<void>((resolve) => (release = resolve))
    await page.route(url, async (route) => {
      await released
      await route.continue()
    })
    return release
  }
  // Laid before the page opens (MOL-249).
  const month = await hold('**/api/money/months/**')
  const accounts = await hold('**/api/money/accounts')
  await openMoney(page)
  const ways = page.getByRole('navigation', { name: 'Разделы «Денег»' })
  const exchange = page.getByRole('link', { name: /^Обмен денег/ })

  await expect(page.locator('.skeleton')).toBeVisible()
  await expect(ways).toHaveCount(0)

  const answered = page.waitForResponse('**/api/money/months/**')
  month()
  await answered
  await expect(page.locator('.skeleton')).toHaveCount(0)
  await expect(ways).toHaveCount(0)

  accounts()
  await expect(exchange).toBeVisible()
  await exchange.click()
  await expect(page).toHaveURL(/\/money\/exchange$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Обмен денег')
})

// A failed month read again by «Повторить» (MOL-269, adversarial А1): the phase stays `error` until the
// answer, which puts the month in place of the error card. The rows stood the whole retry and went from
// under the finger with the answer — the tap of CI, one press after «Повторить». They are unseen for the
// retry with their place kept: taken out, the page under a small phone scrolled down shortened, and the
// card of «Повторить» itself dropped under the finger (adversarial Б2).
test.describe('a small phone', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('«Повторить» hides the ways out in their place until its answer, and a tap then leads where it says', async ({
    page,
  }) => {
    let failed = false
    let release: () => void = () => undefined
    const released = new Promise<void>((resolve) => (release = resolve))
    // Laid before the page opens (MOL-249): the first read fails, the retry is held.
    await page.route('**/api/money/months/**', async (route) => {
      if (!failed) {
        failed = true
        await route.fulfill({ status: 500, body: '{}' })
        return
      }
      await released
      await route.continue()
    })
    await openMoney(page)
    const ways = page.getByRole('navigation', { name: 'Разделы «Денег»' })
    const exchange = page.getByRole('link', { name: /^Обмен денег/ })
    const retry = page.getByRole('button', { name: 'Повторить' })
    await expect(page.getByRole('heading', { name: 'Не удалось загрузить траты' })).toBeVisible()
    await expect(exchange).toBeVisible()
    await facesIn(page)
    await page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
    })
    const scrolled = await page.evaluate(() => window.scrollY)
    expect(scrolled).toBeGreaterThan(0)
    const before = await topOf(retry)
    const box = await retry.boundingBox()
    if (!box) throw new Error('no «Повторить» in sight')

    // Pressed where it stands, as a finger does: `click()` would scroll it into view first.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(ways).toBeHidden()
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)
    expect(await topOf(retry)).toBe(before)

    const answered = page.waitForResponse('**/api/money/months/**')
    release()
    await answered
    await expect(page.getByRole('heading', { name: 'Не удалось загрузить траты' })).toHaveCount(0)
    await exchange.click()
    await expect(page).toHaveURL(/\/money\/exchange$/)
  })
})

// The summary broke, the connection did not: a section's quiet card with its «Повторить», and
// «Добавить трату» keeps the strip — a spending goes through the queue with the server down
// (MOL-180, В-1, 157 v2 1k). The month is turned back before this month answers — the order that
// lost the strip before MOL-183 — and the test holds that order itself, not the runner (MOL-262).
test('a summary that did not load is a quiet card, and the strip still adds a spending', async ({
  page,
}) => {
  // This month's answer is held until the month before is asked for; last month is read for the
  // first time and fails. Both laid before the page opens (MOL-249).
  let answer: () => void = () => undefined
  const answered = new Promise<void>((resolve) => (answer = resolve))
  const current = `**/api/money/months/${yerevanDay().slice(0, 7)}*`
  await page.route(current, async (route) => {
    await answered
    await route.continue()
  })
  const last = `**/api/money/months/${lastMonthDay().slice(0, 7)}*`
  await page.route(last, (route) => route.fulfill({ status: 500, body: '{}' }))
  await openMoney(page)
  const add = page.locator('.dock').getByRole('button', { name: /Добавить трату/ })
  await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
  await expect(page).toHaveURL(/month=/)
  // Nothing kept on this phone and nothing answered: no category is known, so no strip at the move.
  // Looked at once, not over the hold — a strip come a moment later with no category would pass here.
  await expect(add).toHaveCount(0)

  // This month's answer lands for a month no longer on screen, and still names the categories. Waited
  // for as an answer, not within a check's five seconds: on a loaded machine it came later (MOL-262).
  const landed = page.waitForResponse(current)
  answer()
  await landed
  const failed = page.getByRole('heading', { name: 'Не удалось загрузить траты' })
  await expect(failed).toBeVisible()
  const retry = page.getByRole('button', { name: 'Повторить' })
  await expect(retry).toHaveCount(1)
  await expect(page.locator('.dock').getByRole('button', { name: 'Повторить' })).toHaveCount(0)
  await expect(add).toBeVisible()

  await page.unroute(last)
  await retry.click()
  await expect(failed).toHaveCount(0)
})

/**
 * How much of a field of the open sheet stands in sight: between the sheet's top and whichever comes
 * first, the sheet's bottom or the top of a pinned footer.
 */
async function inSight(page: Page, selector: string) {
  return page.locator('dialog[open]').evaluate((dialog, css) => {
    const field = dialog.querySelector(css)
    const footer = dialog.querySelector('.footer')
    if (!field || !footer) throw new Error('no field or no footer')
    const box = dialog.getBoundingClientRect()
    const place = field.getBoundingClientRect()
    const edge = dialog.classList.contains('pinned')
      ? Math.min(box.bottom, footer.getBoundingClientRect().top)
      : box.bottom
    return {
      field: Math.round(place.height),
      seen: Math.max(0, Math.round(Math.min(place.bottom, edge) - Math.max(place.top, box.top))),
      focused: document.activeElement === field,
    }
  }, selector)
}

// Over the keys of a turned phone the sheet has some 107 px, and the edit of a spending a footer of
// 121 — «Сохранить» and «Удалить». Pinned, it covered the whole sheet and the sum being typed with it
// (MOL-182, adversarial А1); taller than half the sheet, it goes with the content, and the sum stands
// in sight. Upright, it stays pinned.
test('the sum being typed stands in sight over the keys of a turned phone (MOL-182)', async ({
  page,
}) => {
  const keyboard = await fakeKeyboard(page)
  await page.setViewportSize({ width: 844, height: 390 })
  await openMoney(page)
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  const sheet = page.locator('dialog[open]')
  await expect(sheet).toContainText('Новая трата')
  await page.waitForTimeout(400)
  await sheet.getByLabel('Сумма').fill('5000')
  await chooseCategory(page, 'Красота и гигиена')
  await fillDetails(page, { note: 'Барбер' })
  await sheet.getByRole('button', { name: 'Сохранить трату' }).click()
  await expect(sheet).toBeHidden()
  await openSpendings(page)
  await page.getByRole('button', { name: /Открыть трату: Барбер/ }).click()
  await page.waitForTimeout(400)
  await expect(sheet.getByRole('button', { name: 'Удалить трату' })).toBeVisible()
  await expect(sheet).toHaveClass(/pinned/)

  const sum = 'input[inputmode="decimal"]'
  await page.locator(`dialog[open] ${sum}`).focus()
  await keyboard(260, 260)
  await expect(sheet).not.toHaveClass(/pinned/)
  await expect.poll(async () => inSight(page, sum)).toEqual({ field: 54, seen: 54, focused: true })
})
