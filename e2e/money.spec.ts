import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { standAt, topOf } from './scroll'
import { asBrowser, signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

/**
 * «Деньги» end to end (MOL-82): a spending written on the screen goes through the queue, the
 * month the server counts takes it in, a removal comes back with «Вернуть» — and all of it with
 * no connection too. What no component test shows is that the screen, the queue and the server
 * agree.
 */

async function openMoney(page: Page): Promise<void> {
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
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

  // The server's figure on the card, and the row in today's day.
  await expect(page.locator('.spent .figure')).toHaveText(/5\s000\s֏/)
  const row = page.getByRole('button', { name: /Открыть трату: Барбер/ })
  await expect(row).toBeVisible()

  // Removed without a question; «Вернуть» brings the same spending back.
  await row.click()
  await page.waitForTimeout(400)
  await sheet.getByRole('button', { name: 'Удалить трату' }).click()
  await expect(sheet).toBeHidden()
  await expect(row).toBeHidden()
  // The only spending gone, the month read again is empty — a newcomer's screen — and «Вернуть»
  // still stands: a person reads the strip before reaching for it (adversarial Г).
  await expect(page.getByRole('heading', { name: 'Добавьте первую трату' })).toBeVisible()
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: 'Вернуть' }).click()
  await expect(row).toBeVisible()
  await expect(page.locator('.spent .figure')).toHaveText(/5\s000\s֏/)
  await expect(page.getByRole('button', { name: 'Трата', exact: true })).toBeVisible()
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
  await page.getByRole('button', { name: 'Трата', exact: true }).click()
  await expect(page.locator('dialog[open]')).toContainText('Нет связи')
  await writeSpending(page, '1500', 'Транспорт', 'Такси')

  // A row «Отправляем…», a line on the card — and the total is still the server's (Р-3).
  await expect(page.getByRole('button', { name: /Открыть трату: Такси/ })).toContainText(
    'Отправляем…',
  )
  await expect(page.locator('.spent')).toContainText('Ещё не учтено: 1 трата отправляется')
  await expect(page.locator('.spent .figure')).toHaveText(/160\s000\s֏/)

  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.locator('.spent .figure')).toHaveText(/161\s500\s֏/)
  await expect(page.getByRole('button', { name: /Открыть трату: Такси/ })).not.toContainText(
    'Отправляем…',
  )
})

test('a spending saved while another month is looked at brings the screen to its own month', async ({
  page,
}) => {
  await openMoney(page)
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await writeSpending(page, '5000', 'Красота и гигиена', 'Барбер')
  await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
  await expect(page).toHaveURL(/month=\d{4}-\d{2}/)

  await page.getByRole('button', { name: 'Трата', exact: true }).click()
  await writeSpending(page, '1500', 'Транспорт', 'Такси')
  // Today's spending: the screen comes back to this month and shows it (adversarial И).
  await expect(page).not.toHaveURL(/month=/)
  await expect(page.getByRole('button', { name: /Открыть трату: Такси/ })).toBeVisible()
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

// The switcher is under the accounts card: taken to the top, it went down by the card, and the next
// tap on the arrow missed it (MOL-136). Where it stands on the screen is what the thumb finds.
test('changing the month keeps the switcher where it was on the screen', async ({ page }) => {
  await signedIn(page)
  const headers = await asBrowser(page)
  const { categories } = (await (
    await page.request.get('/api/spending-categories', { headers })
  ).json()) as { categories: { id: string }[] }
  for (const spentOn of [yerevanDay(), lastMonthDay()])
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
  const rows = page.getByRole('button', { name: /Открыть трату/ })
  await expect(rows).toHaveCount(12)

  // A month read for the first time on the phone comes under the skeleton, a shorter page, and the
  // browser brings the scroll up to its end — the height of the page, not the router. Back to this
  // month, the one the phone keeps is drawn at once.
  await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
  await expect(page).toHaveURL(/month=\d{4}-\d{2}/)
  await expect(rows).toHaveCount(12)

  const next = page.getByRole('button', { name: 'Следующий месяц' })
  await standAt(next, 120)
  const scrolled = await page.evaluate(() => window.scrollY)
  expect(scrolled).toBeGreaterThan(0)
  const before = await topOf(next)

  await next.click()
  await expect(page).not.toHaveURL(/month=/)
  await expect(rows).toHaveCount(12)
  expect(await topOf(next)).toBe(before)
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)
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
  await expect(page.getByRole('button', { name: /Открыть трату: Такси/ })).toBeVisible()

  await page.getByRole('link', { name: 'Категории' }).click()
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
  const income = page.locator('.tile.income')
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
 * px of the window, and what is visible has been scrolled `pan` px down it. Not what Safari was
 * measured doing (MOL-135): it shrinks the window to the visible part and leaves `dvh` — which a
 * Chromium window cannot, since its `dvh` shrinks along. A scroll down an unshrunk window is
 * another geometry with the same fault: a sheet sized from `dvh` is taller than what is visible.
 * The measured numbers are held by «takes what Safari leaves visible…» in `useKeyboardInset.test`.
 */
async function fakeKeyboard(page: Page): Promise<(covered: number, pan: number) => Promise<void>> {
  await page.addInitScript(() => {
    const events = new EventTarget()
    const state = { covered: 0, pan: 0 }
    const viewport = {
      get height() {
        return window.innerHeight - state.covered - state.pan
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
async function within(page: Page, selector: string, covered: number, pan: number) {
  return page.evaluate(
    ({ css, c, p }) => {
      const element = document.querySelector(css)
      if (!element) throw new Error(`nothing at ${css}`)
      const box = element.getBoundingClientRect()
      return { top: box.top >= p, bottom: box.bottom <= innerHeight - c }
    },
    { css: selector, c: covered, p: pan },
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

  await keyboard(0, 300)
  expect(await within(page, 'dialog[open]', 0, 300)).toEqual({ top: true, bottom: true })
  expect(await within(page, 'dialog[open] input[inputmode="decimal"]', 0, 300)).toEqual({
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

  await keyboard(0, 300)
  const after = await place()
  expect(after.inside).toBe(true)
  expect(after.scrolled).toBeGreaterThan(before.scrolled)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})
