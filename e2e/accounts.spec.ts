import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { signedIn } from './session'

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
  const card = page.locator('.card').filter({ hasText: 'Счета' }).first()
  await expect(card).toContainText('Где лежат деньги?')
  await card.getByRole('button', { name: 'Добавить счёт' }).click()
  await addAccount(page, 'Наличные ֏', '10000')
  await expect(card).toContainText(/Наличные ֏\s*10\s000\s֏/)

  // The first account of the currency is put in by the screen.
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await writeSpending(page, '2500', 'Кофе')
  const sheet = topSheet(page)
  await expect(sheet.getByRole('button', { name: /Выбрать счёт:/ })).toContainText('Наличные ֏')
  await sheet.getByRole('button', { name: 'Сохранить трату' }).click()
  await expect(sheet).toBeHidden()
  await expect(card).toContainText(/Наличные ֏\s*7\s500\s֏/)

  // «Без счёта» chosen by hand: in no balance, and named under the card.
  await page.getByRole('button', { name: 'Трата', exact: true }).click()
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
  await expect(card).toContainText('1 операция не попала в остатки')
  await expect(card).toContainText(/Наличные ֏\s*7\s500\s֏/)

  // The check: the fact first, then the server's count, the difference and its reason.
  await card.getByRole('link', { name: 'Все' }).click()
  await page.getByRole('link', { name: /Наличные ֏/ }).click()
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
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  await addAccount(page, 'Карта ֏', '10000')
  await page.getByRole('link', { name: 'Все' }).click()
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
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  await addAccount(page, 'Лишний', '0')
  await page.getByRole('link', { name: 'Все' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Счета')

  await page.getByRole('link', { name: /Лишний/ }).click()
  await page.getByRole('button', { name: 'Править' }).click()
  const sheet = topSheet(page)
  await expect(sheet).toContainText('Операций по счёту не было')
  await page.waitForTimeout(400)
  await sheet.getByRole('button', { name: 'Удалить счёт' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Счета')
  // The strip itself, not the live region that says the same words (MOL-64).
  await expect(page.locator('.undo .text')).toHaveText('Удалено: Лишний')
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: 'Вернуть' }).click()
  await expect(page.getByRole('link', { name: /Лишний/ })).toBeVisible()

  // Now with an operation: the server says «убрать», and the history stays.
  await page.getByRole('button', { name: 'Деньги' }).first().click()
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await writeSpending(page, '500', 'Вода')
  await topSheet(page).getByRole('button', { name: 'Сохранить трату' }).click()
  await page.getByRole('link', { name: 'Все' }).click()
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

// Opened from a line of the card, the account has «Деньги» under it, not «Счета» — and «Вернуть»
// stands on «Счета» (review 32): «Удалить» goes there, and «назад» from there is «Деньги».
test('счёт, открытый строкой карточки, удаляется на «Счета» с «Вернуть»', async ({ page }) => {
  await openMoney(page)
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  await addAccount(page, 'Лишний', '0')
  await page.getByRole('link', { name: /Лишний/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Лишний')

  await page.getByRole('button', { name: 'Править' }).click()
  await page.waitForTimeout(400)
  await topSheet(page).getByRole('button', { name: 'Удалить счёт' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Счета')
  await expect(page.locator('.undo .text')).toHaveText('Удалено: Лишний')
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: 'Вернуть' }).click()
  await expect(page.getByRole('link', { name: /Лишний/ })).toBeVisible()

  await page.goBack()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
})

test('без связи счета не красные, а шторка счёта ждёт связь', async ({ page, context }) => {
  await openMoney(page)
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  await addAccount(page, 'Наличные ֏', '1000')
  await page.getByRole('link', { name: 'Все' }).click()
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
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  await addAccount(page, 'Наличные ֏', '1000')
  await page.getByRole('link', { name: 'Все' }).click()
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

  test('the card, the page, the account and the check fit and speak English', async ({ page }) => {
    await signedIn(page)
    await page.getByRole('link', { name: 'Money', exact: true }).click()
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
    await expect(page.getByRole('link', { name: /Card in roubles/ })).toBeVisible()
    expect(await noSideScroll()).toBe(true)

    await page.getByRole('link', { name: 'All' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Accounts')
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
