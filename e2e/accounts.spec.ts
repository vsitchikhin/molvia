import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { asBrowser, open, signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

/**
 * «Счета» end to end (MOL-123): an account made on the phone, a spending that moves its balance, a
 * check that finds the operation left without an account and comes out even once it is put on it,
 * «Прочее · сверка» that closes a difference nobody can explain, and «Вернуть». What no component
 * test shows is that the sheets, the queues and the server's count agree.
 */

/** Yesterday in Yerevan: an operation on the day of the start is history and moves nothing. */
function yesterday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yerevan' }).format(
    new Date(Date.now() - 24 * 60 * 60 * 1000),
  )
}

async function openMoney(page: Page): Promise<void> {
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
}

/** «Счета» from «Деньги» — by the row «Счета» since the card over the month went (MOL-159). */
async function openAccounts(page: Page): Promise<void> {
  await page.getByRole('link', { name: /^Счета/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Счета')
}

/** Back to «Деньги» by the chevron of a screen under it. */
async function backToMoney(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Деньги' }).first().click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
}

/** The sheet on top — a picker or a reason opened over another is the last one open. */
function topSheet(page: Page): Locator {
  return page.locator('dialog[open]').last()
}

async function addAccount(page: Page, name: string, start: string): Promise<void> {
  const sheet = topSheet(page)
  await expect(sheet).toContainText('Новый счёт')
  // The sheet takes no tap while it rises.
  await page.waitForTimeout(400)
  await sheet.getByLabel('Имя').fill(name)
  await sheet.getByLabel('Остаток').fill(start)
  await sheet.getByLabel('На день').fill(yesterday())
  await sheet.getByRole('button', { name: 'Сохранить' }).click()
  await expect(sheet).toBeHidden()
}

async function writeSpending(page: Page, amount: string, note: string): Promise<void> {
  const sheet = topSheet(page)
  await expect(sheet).toContainText('Новая трата')
  await page.waitForTimeout(400)
  await sheet.getByLabel('Сумма').fill(amount)
  await sheet.getByRole('radio', { name: 'Кафе и рестораны' }).check()
  await sheet.getByLabel(/Что это/).fill(note)
}

test('счёт, трата с него, «без счёта» в сверке — и сверка сходится, когда счёт выбран', async ({
  page,
}) => {
  await openMoney(page)
  await openAccounts(page)
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  await addAccount(page, 'Наличные ֏', '10000')
  const account = page.getByRole('link', { name: /Наличные ֏/ })
  await expect(account).toContainText(/10\s000\s֏/)
  await backToMoney(page)

  // The first account of the currency is put in by the screen.
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await writeSpending(page, '2500', 'Кофе')
  const sheet = topSheet(page)
  await expect(sheet.getByRole('button', { name: /Выбрать счёт:/ })).toContainText('Наличные ֏')
  await sheet.getByRole('button', { name: 'Сохранить трату' }).click()
  await expect(sheet).toBeHidden()

  // «Без счёта» chosen by hand: in no balance, and named under the total of «Счета».
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await writeSpending(page, '1000', 'Такси')
  await topSheet(page)
    .getByRole('button', { name: /Выбрать счёт:/ })
    .click()
  await expect(topSheet(page)).toContainText('Остатки — на сейчас')
  await page.waitForTimeout(400)
  await topSheet(page)
    .getByRole('radio', { name: /Без счёта/ })
    .click()
  await topSheet(page).getByRole('button', { name: 'Сохранить трату' }).click()
  await expect(topSheet(page)).toBeHidden()
  await openAccounts(page)
  await expect(page.getByRole('button', { name: /1 операция не попала в остатки/ })).toBeVisible()
  await expect(account).toContainText(/7\s500\s֏/)

  // The check: the fact first, then the server's count, the difference and its reason.
  await account.click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Наличные ֏')
  await page.getByRole('button', { name: 'Сверить с фактом' }).click()
  const check = topSheet(page)
  await expect(check).toContainText('Сколько на счёте сейчас?')
  await expect(check).not.toContainText('7 500')
  await page.waitForTimeout(400)
  await check.getByLabel('Сколько на счёте сейчас?').fill('6500')
  await check.getByRole('button', { name: 'Сверить', exact: true }).click()
  await expect(check).toContainText(/Разница\s*−1\s000\s֏/)
  const reason = check.getByRole('button', { name: /Трата 1\s000\s֏ без счёта/ })
  await expect(reason).toBeVisible()

  // Put right in its own sheet over the check; «‹» and not ×, and the check counts again.
  await reason.click()
  const spending = topSheet(page)
  await expect(spending).toContainText('Трата')
  await expect(spending.getByRole('button', { name: 'Закрыть' })).toHaveCount(0)
  await page.waitForTimeout(400)
  await spending.getByRole('button', { name: /Выбрать счёт:/ }).click()
  await page.waitForTimeout(400)
  await topSheet(page)
    .getByRole('radio', { name: /Наличные ֏/ })
    .click()
  await spending.getByRole('button', { name: 'Сохранить трату' }).click()
  await expect(check).toContainText('Сходится с приложением')
  await check.getByRole('button', { name: 'Готово' }).click()
  await expect(page.getByText(/сверено/)).toBeVisible()
})

test('разницу, которой нет причины, закрывает «Прочее · сверка» — и сверка сходится', async ({
  page,
}) => {
  await openMoney(page)
  await openAccounts(page)
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  await addAccount(page, 'Карта ֏', '10000')
  await page.getByRole('link', { name: /Карта ֏/ }).click()

  await page.getByRole('button', { name: 'Сверить с фактом' }).click()
  const check = topSheet(page)
  await page.waitForTimeout(400)
  await check.getByLabel('Сколько на счёте сейчас?').fill('9000')
  await check.getByRole('button', { name: 'Сверить', exact: true }).click()
  await expect(check).toContainText('Похоже, какая-то трата не записана')
  await expect(check).toContainText('Запишем расход 1 000 ֏ на «Карта ֏»')
  await check.getByRole('button', { name: /Записать разницу/ }).click()
  await expect(check).toBeHidden()

  // One «Прочее · сверка» for the server's sum, and the balance is the fact.
  await expect(page.getByRole('button', { name: /Прочее · сверка/ })).toHaveCount(1)
  await expect(page.locator('.balance .figure')).toHaveText(/9\s000\s֏/)
  // The same check sent again once the spending landed: it came out even and is remembered.
  await expect(page.getByText(/сверено/)).toBeVisible()
})

test('счёт без операций удаляется с «Вернуть», с операциями — убирается в «Убранные»', async ({
  page,
}) => {
  await openMoney(page)
  await openAccounts(page)
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  await addAccount(page, 'Лишний', '0')

  await page.getByRole('link', { name: /Лишний/ }).click()
  await page.getByRole('button', { name: 'Править' }).click()
  const sheet = topSheet(page)
  await expect(sheet).toContainText('Операций по счёту не было')
  await page.waitForTimeout(400)
  await sheet.getByRole('button', { name: 'Удалить счёт' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Счета')
  // The strip itself, not the live region that says the same words (MOL-64).
  await expect(page.locator('.undo-strip .text')).toHaveText('Удалено: Лишний')
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: 'Вернуть' }).click()
  await expect(page.getByRole('link', { name: /Лишний/ })).toBeVisible()

  // Now with an operation: the server says «убрать», and the history stays.
  await backToMoney(page)
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await writeSpending(page, '500', 'Вода')
  await topSheet(page).getByRole('button', { name: 'Сохранить трату' }).click()
  await expect(topSheet(page)).toBeHidden()
  await openAccounts(page)
  await page.getByRole('link', { name: /Лишний/ }).click()
  await page.getByRole('button', { name: 'Править' }).click()
  await page.waitForTimeout(400)
  await topSheet(page).getByRole('button', { name: 'Убрать из выбора' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Счета')
  const removed = page.getByRole('button', { name: 'Убранные (1)' })
  await removed.click()
  await expect(removed).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: 'Вернуть' }).click()
  await expect(removed).toBeHidden()
  await expect(page.getByRole('link', { name: /Лишний/ })).toBeVisible()
})

test('без связи счета не красные, а шторка счёта ждёт связь', async ({ page, context }) => {
  await openMoney(page)
  await openAccounts(page)
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  await addAccount(page, 'Наличные ֏', '1000')
  await expect(page.getByRole('link', { name: /Наличные ֏/ })).toBeVisible()

  await context.setOffline(true)
  await expect(page.getByText(/Нет связи\. Остатки на/)).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Счёт', exact: true }).click()
  const sheet = topSheet(page)
  await expect(sheet).toContainText('Счета меняются только со связью')
  await expect(sheet.getByRole('button', { name: /Сохраним, когда будет связь/ })).toBeDisabled()
  await context.setOffline(false)
  await expect(sheet.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
})

test('без связи «Сверить» ждёт связь и не красная; со связью — сверяет', async ({
  page,
  context,
}) => {
  await openMoney(page)
  await openAccounts(page)
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  await addAccount(page, 'Наличные ֏', '1000')
  await page.getByRole('link', { name: /Наличные ֏/ }).click()

  await context.setOffline(true)
  await page.getByRole('button', { name: 'Сверить с фактом' }).click()
  const check = topSheet(page)
  await expect(check).toContainText('Сверку считает сервер')
  await expect(check.getByRole('button', { name: 'Сверим, когда будет связь' })).toBeDisabled()
  await expect(check.getByRole('alert')).toHaveCount(0)
  await page.waitForTimeout(400)
  await check.getByLabel('Сколько на счёте сейчас?').fill('1000')

  await context.setOffline(false)
  await check.getByRole('button', { name: 'Сверить', exact: true }).click()
  await expect(check).toContainText('Сходится с приложением')
})

test.describe('320 px, English', () => {
  test.use({ locale: 'en-US', viewport: { width: 320, height: 640 } })

  test('the page, the account and the check fit and speak English', async ({ page }) => {
    await signedIn(page)
    await page.getByRole('link', { name: 'Money', exact: true }).click()
    await page.getByRole('link', { name: /^Accounts/ }).click()
    await page.getByRole('button', { name: 'Add account' }).click()
    const sheet = topSheet(page)
    await expect(sheet).toContainText('New account')
    await page.waitForTimeout(400)
    await sheet.getByLabel('Name').fill('Card in roubles')
    await sheet.getByLabel('Currency').selectOption('RUB')
    await sheet.getByLabel('Balance').fill('-12400.50')
    await sheet.getByLabel('As of').fill(yesterday())
    await sheet.getByRole('button', { name: 'Save' }).click()
    await expect(sheet).toBeHidden()

    const noSideScroll = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Accounts')
    await expect(page.getByRole('link', { name: /Card in roubles/ })).toBeVisible()
    expect(await noSideScroll()).toBe(true)

    await page.getByRole('link', { name: /Card in roubles/ }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Card in roubles')
    expect(await noSideScroll()).toBe(true)

    await page.getByRole('button', { name: 'Check against reality' }).click()
    const check = topSheet(page)
    await page.waitForTimeout(400)
    await check.getByLabel('How much is there right now?').fill('-12000')
    await check.getByRole('button', { name: 'Check', exact: true }).click()
    await expect(check).toContainText(/Difference/)
    expect(await noSideScroll()).toBe(true)
  })
})

/**
 * A ruble card and the rent paid from it in drams, «списано» typed: its row in the account's journal, on
 * a phone of `width` (MOL-176). Beside the words, its amount and the line under it left «Аренда» under
 * 40 px on a phone of 320, where the cards of «Деньги» stand in a gutter of 32 (adversarial round 2, Б1).
 */
async function rentRow(page: Page, width: number) {
  await page.setViewportSize({ width, height: 740 })
  await signedIn(page)
  const headers = await asBrowser(page)
  const post = async (url: string, data: Record<string, unknown>) => {
    const response = await page.request.post(url, { headers, data })
    expect(response.status(), await response.text()).toBe(201)
  }
  const account = randomUUID()
  await post('/api/money/accounts', {
    id: account,
    name: 'Т-Банк',
    currency: 'RUB',
    savings: false,
    start: { amount: '100000', currency: 'RUB' },
    startOn: yesterday(),
  })
  const { categories } = (await (
    await page.request.get('/api/spending-categories', { headers })
  ).json()) as { categories: { id: string }[] }
  await post('/api/spendings', {
    id: randomUUID(),
    spentOn: yesterday(),
    amount: { amount: '120000', currency: 'AMD' },
    categoryId: categories[0]?.id,
    note: 'Аренда',
    accountId: account,
    debited: { amount: '24123', currency: 'RUB' },
  })
  await open(page, `/money/accounts/${account}`)
  const row = page.getByRole('button', { name: /^Открыть операцию: Аренда/ })
  await expect(row).toContainText('120 000 ֏ · списано')
  return row.evaluate((one) => {
    const box = (selector: string) => {
      const found = one.querySelector(selector)
      if (!found) throw new Error(`no ${selector}`)
      return found.getBoundingClientRect()
    }
    const title = one.querySelector('.title')
    return {
      words: box('.words').width,
      under: box('.tail').top >= box('.words').bottom - 1,
      lines: title
        ? Math.round(
            title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight),
          )
        : 0,
      inside: box('.chevron').right <= (one.closest('ul')?.getBoundingClientRect().right ?? 0),
    }
  })
}

// The owner's choice (MOL-176, Б1, Б2): a row narrower than 22rem stands its amount under the words, and
// the words take the whole width; a wider one keeps it beside them. The account's card stands in the
// gutter of «Деньги»: 256 on a phone of 320, 366 on one of 430.
test('a phone of 320: the rent’s amount under its words, «Аренда» on one line', async ({
  page,
}) => {
  const look = await rentRow(page, 320)
  expect(look).toMatchObject({ under: true, lines: 1, inside: true })
  expect(look.words).toBeGreaterThan(120)
})

test('a phone of 430: the rent’s amount beside its words, as the handoff draws it', async ({
  page,
}) => {
  expect(await rentRow(page, 430)).toMatchObject({ under: false, lines: 1, inside: true })
})

// MOL-225, adversarial Р1-А3: the line drops while «Сохранить» works. A native `disabled` put on the
// button at work took the focus out of the sheet to the page; the button keeps it, and its word.
test('связь пропала, пока «Сохранить» работает: кнопка держит фокус и слово «Сохраняем…»', async ({
  page,
  context,
}) => {
  await openMoney(page)
  await openAccounts(page)
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  await addAccount(page, 'Наличные', '1000')
  await page.getByRole('link', { name: /Наличные/ }).click()
  await page.getByRole('button', { name: 'Править' }).click()
  const sheet = topSheet(page)
  await expect(sheet).toContainText('Удалить счёт')
  await page.waitForTimeout(400)
  await sheet.getByLabel('Имя').fill('Наличные в кошельке')

  let release: () => void = () => undefined
  const held = new Promise<void>((done) => (release = done))
  await page.route('**/api/money/accounts**', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback()
    await held
    await route.continue().catch(() => undefined)
  })
  await sheet.getByRole('button', { name: 'Сохранить', exact: true }).click()
  const busy = sheet.getByRole('button', { name: 'Сохраняем…', exact: true })
  await expect(busy).toBeFocused()
  await context.setOffline(true)
  // Long enough for the page to hear it went offline.
  await page.waitForTimeout(300)
  // Not `toBeEnabled`: Playwright counts the `aria-disabled` of `busy` as disabled too.
  await expect(busy).not.toHaveAttribute('disabled')
  await expect(busy).toBeFocused()
  await expect(busy).toHaveAttribute('aria-busy', 'true')
  await context.setOffline(false)
  release()
})
