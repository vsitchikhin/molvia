import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { fakeKeyboard } from './keyboard'
import { asBrowser, open, signedIn } from './session'
import { chooseCategory } from './category'
import { fillDetails } from './spending-details'

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
  await chooseCategory(page, 'Кафе и рестораны')
  await fillDetails(page, { note })
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
  // Blind behind it too (Ф-33): «•••» on the balance while the fact is typed.
  const figure = page.locator('.balance .figure')
  await expect(figure).toContainText('•••')
  await expect(figure).not.toContainText(/7\s500/)
  await page.waitForTimeout(400)
  await check.getByLabel('Сколько на счёте сейчас?').fill('6500')
  await check.getByRole('button', { name: 'Сверить', exact: true }).click()
  await expect(check).toContainText(/Разница\s*−1\s000\s֏/)
  // The server answered: the balance is back behind the sheet.
  await expect(figure).toHaveText(/7\s500\s֏/)
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

// С-16 of MOL-118: «+ Своя» is the last row of «Ещё…» since MOL-198, so from a check a new category
// is the fourth sheet — Сверка → Трата → Категория → Новая. Each over the one under it has «‹» and no
// ×, one scrim, and Esc and «back» take one at a time; made, it takes the list with it (owner's В-1
// «а») and stands first and chosen in the spending, the check still under it.
test('четыре шторки от сверки: Esc и «назад» снимают по одной, созданная категория — в трате', async ({
  page,
}) => {
  await openMoney(page)
  await openAccounts(page)
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  await addAccount(page, 'Наличные ֏', '10000')
  const account = page.getByRole('link', { name: /Наличные ֏/ })
  await backToMoney(page)
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await writeSpending(page, '1000', 'Такси')
  await topSheet(page)
    .getByRole('button', { name: /Выбрать счёт:/ })
    .click()
  await page.waitForTimeout(400)
  await topSheet(page)
    .getByRole('radio', { name: /Без счёта/ })
    .click()
  await topSheet(page).getByRole('button', { name: 'Сохранить трату' }).click()
  await expect(topSheet(page)).toBeHidden()

  await openAccounts(page)
  await account.click()
  await page.getByRole('button', { name: 'Сверить с фактом' }).click()
  const check = topSheet(page)
  await page.waitForTimeout(400)
  await check.getByLabel('Сколько на счёте сейчас?').fill('9000')
  await check.getByRole('button', { name: 'Сверить', exact: true }).click()
  await check.getByRole('button', { name: /Трата 1\s000\s֏ без счёта/ }).click()
  const spending = topSheet(page)
  await expect(spending).toContainText('Трата')
  await page.waitForTimeout(400)

  const open = page.locator('dialog[open]')
  const more = async () => {
    await spending.getByRole('button', { name: 'Ещё…' }).click()
    await expect(open).toHaveCount(3)
    await expect(topSheet(page)).toContainText('Категория')
    await page.waitForTimeout(400)
  }
  const own = async () => {
    await topSheet(page).getByRole('button', { name: 'Своя' }).click()
    await expect(open).toHaveCount(4)
    await expect(topSheet(page)).toContainText('Новая категория')
    await page.waitForTimeout(400)
  }

  await more()
  await own()
  // Every sheet over another: «‹», no ×, and only the lowest draws the scrim.
  for (const sheet of await open.all()) {
    const over = await sheet.evaluate((dialog) => dialog.classList.contains('over'))
    await expect(sheet.getByRole('button', { name: 'Закрыть', exact: true })).toHaveCount(
      over ? 0 : 1,
    )
    if (over)
      expect(
        await sheet.evaluate((dialog) => getComputedStyle(dialog, '::backdrop').backgroundColor),
      ).toBe('rgba(0, 0, 0, 0)')
  }

  // Esc takes the new one alone, «back» the list alone: the spending and the check stay.
  await page.keyboard.press('Escape')
  await expect(open).toHaveCount(3)
  await expect(topSheet(page)).toContainText('Категория')
  await page.goBack()
  await expect(open).toHaveCount(2)
  await expect(topSheet(page)).toContainText('Трата')

  // Made, it takes «Ещё…» with it: back on the spending, chosen and first among the chips.
  await page.waitForTimeout(400)
  await more()
  await own()
  await topSheet(page).getByLabel('Название').fill('Метро')
  await topSheet(page).getByRole('button', { name: 'Добавить' }).click()
  await expect(open).toHaveCount(2)
  await expect(topSheet(page)).toContainText('Трата')
  const chips = spending.locator('.chips').getByRole('radio')
  await expect(chips.first()).toHaveAccessibleName('Метро')
  await expect(chips.first()).toBeChecked()
  // The focus goes back to «Ещё…», the list's opener (review 1, №7).
  await expect(spending.getByRole('button', { name: 'Ещё…' })).toBeFocused()

  // One more Esc is the spending's: the check is the one left.
  await page.keyboard.press('Escape')
  await expect(open).toHaveCount(1)
  await expect(check).toContainText(/Разница/)
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
  context,
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
  // «Вернуть» over the strip, which stays under it (Ф-29, MOL-193).
  await expect(page.locator('.dock').getByRole('button', { name: 'Добавить счёт' })).toBeVisible()
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

  // Its own screen: «Вернуть» in the strip where «Сверить» stood, not now offline and saying why;
  // brought back, «Сверить с фактом» takes its place and the focus (MOL-194).
  await page.getByRole('link', { name: /Лишний/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Лишний')
  const dock = page.locator('.dock')
  await expect(dock.getByRole('button')).toHaveText(['Вернуть'])
  await context.setOffline(true)
  const waiting = dock.getByRole('button', { name: 'Вернём, когда будет связь' })
  await expect(waiting).toHaveAttribute('aria-disabled', 'true')
  await context.setOffline(false)
  await dock.getByRole('button', { name: 'Вернуть' }).click()
  const reconcile = dock.getByRole('button', { name: 'Сверить с фактом' })
  await expect(reconcile).toBeFocused()
  await expect(page.getByText(/Убран из выбора/)).toBeHidden()
  await page.getByRole('button', { name: /Счета/ }).click()
  await expect(removed).toBeHidden()
  await expect(page.getByRole('link', { name: /Лишний/ })).toBeVisible()
})

test('перевод между своими счетами: два остатка, комиссия отдельной строкой, «Вернуть» (MOL-253)', async ({
  page,
}) => {
  await openMoney(page)
  await openAccounts(page)
  // One account a currency is nowhere to transfer to: no way in yet.
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  await addAccount(page, 'Карта ֏', '10000')
  await expect(page.getByRole('button', { name: /Перевод между счетами/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  await addAccount(page, 'Копилка ֏', '0')

  await page.getByRole('button', { name: /Перевод между счетами/ }).click()
  const sheet = topSheet(page)
  await expect(sheet).toContainText('Между своими счетами одной валюты')
  await page.waitForTimeout(400)
  await expect(sheet.getByRole('button', { name: 'Выберите, откуда' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await sheet.getByRole('button', { name: /Откуда/ }).click()
  await expect(topSheet(page)).toContainText('Остатки — на сейчас')
  await page.waitForTimeout(400)
  await topSheet(page)
    .getByRole('radio', { name: /Карта ֏/ })
    .click()
  // The one account it can go to is put in by the screen (Р-6).
  await expect(sheet.getByRole('button', { name: /Куда/ })).toContainText('Копилка ֏')
  await sheet.getByLabel('Сумма').fill('3000')
  await sheet.getByLabel(/Комиссия/).fill('100')
  await expect(sheet).toContainText(/всего уйдёт 3\s100\s֏/)
  await sheet.getByRole('button', { name: /Перевести 3\s000\s֏/ }).click()
  await expect(sheet).toBeHidden()

  await expect(page.getByRole('link', { name: /Карта ֏/ })).toContainText(/6\s900\s֏/)
  await expect(page.getByRole('link', { name: /Копилка ֏/ })).toContainText(/3\s000\s֏/)

  // In the source's journal the transfer and its fee stand apart, both opening the transfer.
  await page.getByRole('link', { name: /Карта ֏/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Карта ֏')
  const moved = page.getByRole('button', { name: /операцию: → Копилка ֏/ })
  await expect(moved).toContainText(/−3\s000\s֏/)
  await expect(page.getByRole('button', { name: /Комиссия за перевод/ })).toContainText(/−100\s֏/)
  await moved.click()
  const amend = topSheet(page)
  await expect(amend).toContainText('Правка перевода')
  await page.waitForTimeout(400)
  await amend.getByRole('button', { name: 'Удалить перевод' }).click()
  await expect(amend).toBeHidden()
  await expect(page.locator('.undo-strip .text')).toHaveText('Перевод удалён')
  await expect(moved).toHaveCount(0)
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: 'Вернуть' }).click()
  await expect(moved).toBeVisible()
  await expect(page.getByRole('button', { name: /Комиссия за перевод/ })).toBeVisible()
})

test('без связи счета не красные, а шторка счёта ждёт связь', async ({ page, context }) => {
  await openMoney(page)
  await openAccounts(page)
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  await addAccount(page, 'Наличные ֏', '1000')
  await expect(page.getByRole('link', { name: /Наличные ֏/ })).toBeVisible()

  await context.setOffline(true)
  // The strip itself, not the live region that says the same words (MOL-64).
  await expect(
    page.locator('.strip.offline').filter({ hasText: /Без связи · остатки на/ }),
  ).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  const sheet = topSheet(page)
  await expect(sheet).toContainText('Счета меняются только со связью')
  // Not now in the focus order (Ф-6): `aria-disabled`, never `disabled`, which `toBeDisabled` takes alike.
  const waits = sheet.getByRole('button', { name: /Сохраним, когда будет связь/ })
  await expect(waits).toHaveAttribute('aria-disabled', 'true')
  await expect(waits).not.toHaveAttribute('disabled')
  await context.setOffline(false)
  await expect(sheet.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
})

test('без связи «Сверить» ждёт связь словами и не красная; со связью — сверяет', async ({
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
  await expect(check).toContainText('Сверить можно со связью — введённое останется здесь')
  // Not now in the kit's one look: in the focus order, saying why (Ф-6) — a native `disabled` takes
  // no focus. Not `toBeEnabled`: Playwright reads `aria-disabled` as disabled.
  const wait = check.getByRole('button', { name: 'Сверим, когда будет связь' })
  await expect(wait).toHaveAttribute('aria-disabled', 'true')
  await wait.focus()
  await expect(wait).toBeFocused()
  await expect(check.getByRole('alert')).toHaveCount(0)
  await page.waitForTimeout(400)
  await check.getByLabel('Сколько на счёте сейчас?').fill('1000')

  await context.setOffline(false)
  await check.getByRole('button', { name: 'Сверить', exact: true }).click()
  await expect(check).toContainText('Сходится с приложением')
})

test.describe('320 px, English', () => {
  test.use({ locale: 'en-US', viewport: { width: 320, height: 640 } })

  // MOL-318: the screen's large title is the account's name, and a name of one word wider than the
  // phone took the page sideways — the title had no place to break it.
  test('an account named by one word wider than the phone breaks its title, not the page', async ({
    page,
  }) => {
    const name = 'Raiffeisenbanksavingsaccountforholidays'
    await signedIn(page)
    const made = await page.request.post('/api/money/accounts', {
      headers: await asBrowser(page),
      data: {
        id: randomUUID(),
        name,
        currency: 'AMD',
        savings: false,
        start: { amount: '1000', currency: 'AMD' },
        startOn: yesterday(),
      },
    })
    expect(made.status(), await made.text()).toBe(201)
    await page.getByRole('link', { name: 'Money', exact: true }).click()
    await page.getByRole('link', { name: /^Accounts/ }).click()
    await page.getByRole('link', { name: new RegExp(name) }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0)
  })

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
    // The total in two currencies, the tiles too (MOL-193, В-1 «б»): no figure cut on a phone of 320.
    const cut = await page
      .locator('.total :is(.figure, .figure-second, .tile-figure, .tile-second)')
      .evaluateAll((nodes) => nodes.filter((node) => node.scrollWidth > node.clientWidth).length)
    expect(cut).toBe(0)

    await page.getByRole('link', { name: /Card in roubles/ }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Card in roubles')
    expect(await noSideScroll()).toBe(true)
    // The account's actions are its strip, the header «Edit» alone, «‹ Accounts» whole (MOL-194).
    await expect(page.locator('.dock').getByRole('button')).toHaveText(['Check against reality'])
    await expect(page.locator('.bar .back')).toContainText('Accounts')
    const cutInDock = await page
      .locator('.dock button')
      .evaluateAll((nodes) => nodes.filter((node) => node.scrollWidth > node.clientWidth).length)
    expect(cutInDock).toBe(0)

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

// MOL-197, handoff 116 v2/06: the chosen account is the kit's chosen row — a ring of 2 on its layer, not
// a fill alone, which the dark scheme did not show (Ф-5) — every row 64, the groups 24 apart and the
// footnote 8 under the last card. The kit's ring and focus are held on WebKit by `kit-rows`.
test('выбор счёта: строки 64, у выбранной кольцо 2 px, группы через 24, сноска через 8', async ({
  page,
}) => {
  await signedIn(page)
  const headers = await asBrowser(page)
  for (const [name, currency] of [
    ['Наличные ֏', 'AMD'],
    ['Карта ₽', 'RUB'],
  ] as const) {
    const response = await page.request.post('/api/money/accounts', {
      headers,
      data: {
        id: randomUUID(),
        name,
        currency,
        savings: false,
        start: { amount: '1000', currency },
        startOn: yesterday(),
      },
    })
    expect(response.status(), await response.text()).toBe(201)
  }
  await open(page, '/money')
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await expect(topSheet(page)).toContainText('Новая трата')
  await page.waitForTimeout(400)
  await topSheet(page)
    .getByRole('button', { name: /Выбрать счёт:/ })
    .click()
  const picker = topSheet(page)
  await expect(picker).toContainText('Остатки — на сейчас')
  await expect(picker.getByRole('radio', { name: /Наличные ֏/ })).toBeChecked()

  const look = await picker.evaluate((sheet) => {
    const box = (one: Element | undefined | null) => {
      if (!one) throw new Error('another shape')
      return one.getBoundingClientRect()
    }
    const group = sheet.querySelector('[role="radiogroup"]')
    const cards = [...(group?.querySelectorAll('ul') ?? [])]
    const captions = [...(group?.querySelectorAll('h3') ?? [])]
    const chosen = sheet.querySelector('[role="radio"][aria-checked="true"]')
    if (!chosen) throw new Error('no chosen row')
    const ring = /(-?[\d.]+)px inset|inset[^,]*?(-?[\d.]+)px\s*$/.exec(
      getComputedStyle(chosen, '::before').boxShadow,
    )
    return {
      heights: [...sheet.querySelectorAll('[role="radio"]')].map((row) =>
        Math.round(box(row).height),
      ),
      ring: parseFloat(ring?.[1] ?? ring?.[2] ?? 'NaN'),
      toCaption: Math.round(box(captions[1]).top - box(cards[0]).bottom),
      toNone: Math.round(box(cards[2]).top - box(cards[1]).bottom),
      toFootnote: Math.round(box(sheet.querySelector('.footnote')).top - box(cards[2]).bottom),
      // On the tint muted is under 4.5:1 (MOL-172): the chosen balance is the title's ink, another's muted.
      ink: [...sheet.querySelectorAll('[role="radio"]')]
        .filter((row) => row.querySelector('.balance'))
        .map((row) => {
          const colour = (selector: string) => {
            const one = row.querySelector(selector)
            return one ? getComputedStyle(one).color : ''
          }
          return colour('.balance') === colour('.title')
        }),
    }
  })
  expect(look).toEqual({
    heights: [64, 64, 64],
    ring: 2,
    toCaption: 24,
    toNone: 24,
    toFootnote: 8,
    ink: [true, false],
  })
})

// MOL-197, adversarial round 2, Б1: the chosen row's balance goes to ink only while it is not below zero —
// a card in debt stays `bad-ink` on the tint; the e2e above sees two balances above zero, the unit test a class.
test('выбор счёта: минус выбранной строки — bad-ink, плюс соседней — приглушённый', async ({
  page,
}) => {
  await signedIn(page)
  const headers = await asBrowser(page)
  for (const [name, currency, amount] of [
    ['Кредитка ֏', 'AMD', '-12000'],
    ['Карта ₽', 'RUB', '1000'],
  ] as const) {
    const response = await page.request.post('/api/money/accounts', {
      headers,
      data: {
        id: randomUUID(),
        name,
        currency,
        savings: false,
        start: { amount, currency },
        startOn: yesterday(),
      },
    })
    expect(response.status(), await response.text()).toBe(201)
  }
  await open(page, '/money')
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await expect(topSheet(page)).toContainText('Новая трата')
  await page.waitForTimeout(400)
  await topSheet(page)
    .getByRole('button', { name: /Выбрать счёт:/ })
    .click()
  const picker = topSheet(page)
  await expect(picker.getByRole('radio', { name: /Кредитка ֏/ })).toBeChecked()
  const look = await picker.evaluate((sheet) => {
    const ink = (token: string) => {
      const probe = document.createElement('span')
      probe.style.color = `var(${token})`
      sheet.append(probe)
      const colour = getComputedStyle(probe).color
      probe.remove()
      return colour
    }
    const balance = (checked: string) => {
      const one = sheet.querySelector(`[role="radio"][aria-checked="${checked}"] .balance`)
      return one ? getComputedStyle(one).color : ''
    }
    return {
      chosenMinus: balance('true') === ink('--bad-ink'),
      otherPlus: balance('false') === ink('--text-muted'),
    }
  })
  expect(look).toEqual({ chosenMinus: true, otherPlus: true })
})

// MOL-197: the name's whole line was the least width of «Счёт ›», and a long one pushed the sheet of a
// spending to 483 px on a phone of 320 — every field past the edge — instead of ending in «…».
test('длинное имя счёта на 320: строка «Счёт ›» кончается «…», шторка не шире экрана', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await signedIn(page)
  const response = await page.request.post('/api/money/accounts', {
    headers: await asBrowser(page),
    data: {
      id: randomUUID(),
      name: 'Кредитка с очень длинным именем ֏',
      currency: 'AMD',
      savings: false,
      start: { amount: '1000', currency: 'AMD' },
      startOn: yesterday(),
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  await open(page, '/money')
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  const sheet = topSheet(page)
  const row = sheet.getByRole('button', { name: /Выбрать счёт:/ })
  await expect(row).toContainText('Кредитка с очень длинным именем')
  const look = await sheet.evaluate((dialog) => {
    const value = dialog.querySelector('.row .value')
    if (!value) throw new Error('no row')
    return {
      sideways: dialog.scrollWidth - dialog.clientWidth,
      cut: value.scrollWidth > value.clientWidth,
    }
  })
  expect(look).toEqual({ sideways: 0, cut: true })
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

// The edit of an account over the keys held upright: a sheet of 324 and a footer of 167 —
// «Сохранить», «Удалить счёт» and its note. Half the sheet let the footer go, «Сохранить» below the
// edge as the name is typed — the very sheet MOL-182 began with (adversarial round 2, Р2-А1). The name
// has room above it, and the footer stays pinned.
test('the edit of an account keeps «Сохранить» pinned in sight over the keys (MOL-182)', async ({
  page,
}) => {
  const keyboard = await fakeKeyboard(page)
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await openAccounts(page)
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  const sheet = page.locator('dialog[open]').last()
  await expect(sheet).toContainText('Новый счёт')
  await page.waitForTimeout(400)
  await sheet.getByLabel('Имя').fill('Наличные')
  await sheet.getByLabel('Остаток').fill('1000')
  await sheet.getByLabel('На день').fill(yesterday())
  await sheet.getByRole('button', { name: 'Сохранить' }).click()
  await expect(sheet).toBeHidden()
  await page.getByRole('link', { name: /Наличные/ }).click()
  await page.getByRole('button', { name: 'Править' }).click()
  await expect(sheet).toContainText('Удалить счёт')
  await page.waitForTimeout(400)

  await sheet.getByLabel('Имя').focus()
  const window = page.viewportSize()?.height ?? 0
  await keyboard(window - 395, window - 395)
  await expect
    .poll(() =>
      sheet.evaluate((dialog) => {
        const button = [...dialog.querySelectorAll('button')].find(
          (one) => one.textContent.trim() === 'Сохранить',
        )
        const name = document.activeElement
        if (!button || !(name instanceof HTMLInputElement))
          throw new Error('no «Сохранить» or no name')
        const box = dialog.getBoundingClientRect()
        const sees = (rect: DOMRect) => rect.top >= box.top && rect.bottom <= box.bottom + 0.5
        return {
          pinned: dialog.classList.contains('pinned'),
          save: sees(button.getBoundingClientRect()),
          name: sees(name.getBoundingClientRect()),
        }
      }),
    )
    .toEqual({ pinned: true, save: true, name: true })
})
