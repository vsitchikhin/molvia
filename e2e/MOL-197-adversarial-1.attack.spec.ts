import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { asBrowser, open, signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

/**
 * MOL-197, адверсариальное ревью, раунд 1. ЗЕЛЁНЫЙ ТЕСТ = ДЕФЕКТ ЖИВ (кроме контроля «К»).
 *
 * А1: PR починил длинное имя в «Счёт ›» (`AccountRow`, `width: 0`), но в самой шторке выбора та же цепочка:
 * `.panel` шторки — grid, его ребёнок — грид-элемент с `min-width: auto`, внутри `.groups` (grid) → секция → `ul` →
 * `ListRow` (flex) → `.words` (`flex: 1; min-width: 0`) → `.title` (`nowrap`). Наименьшая ширина строки — всё имя,
 * и она поднимается до панели. Ждём: шторка выбора шире экрана, строка за краем, ✓ и остаток за краем.
 */

function yesterday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yerevan' }).format(
    new Date(Date.now() - 24 * 60 * 60 * 1000),
  )
}

function topSheet(page: Page): Locator {
  return page.locator('dialog[open]').last()
}

async function pickerWith(page: Page, width: number, name: string) {
  await page.setViewportSize({ width, height: 740 })
  await signedIn(page)
  const response = await page.request.post('/api/money/accounts', {
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
  expect(response.status(), await response.text()).toBe(201)
  await open(page, '/money')
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await expect(topSheet(page)).toContainText('Новая трата')
  await page.waitForTimeout(400)
  await topSheet(page)
    .getByRole('button', { name: /Выбрать счёт:/ })
    .click()
  const picker = topSheet(page)
  await expect(picker).toContainText('Остатки — на сейчас')
  await expect(picker.getByRole('radio', { name: new RegExp(name.slice(0, 12)) })).toBeChecked()
  await page.waitForTimeout(400)
  const look = await picker.evaluate((dialog) => {
    const row = dialog.querySelector('[role="radio"][aria-checked="true"]')
    const title = row?.querySelector('.title')
    const check = row?.querySelector('.check')
    const balance = row?.querySelector('.balance')
    if (!row || !title || !check || !balance) throw new Error('another shape')
    const right = (one: Element) => Math.round(one.getBoundingClientRect().right)
    return {
      viewport: window.innerWidth,
      dialog: Math.round(dialog.getBoundingClientRect().width),
      sideways: dialog.scrollWidth - dialog.clientWidth,
      row: Math.round(row.getBoundingClientRect().width),
      rowRight: right(row),
      balanceRight: right(balance),
      checkRight: right(check),
      titleCut: title.scrollWidth > title.clientWidth,
    }
  })
  console.log(`MOL-197 A1 ${width} «${name}»: ${JSON.stringify(look)}`)
  return look
}

test('А1: имя из теста самого PR на 320 — шторка выбора шире экрана, ✓ за краем', async ({
  page,
}) => {
  const look = await pickerWith(page, 320, 'Кредитка с очень длинным именем ֏')
  expect.soft(look.sideways, 'шторка выбора листается вбок').toBeGreaterThan(0)
  expect.soft(look.checkRight, '✓ выбранной строки за правым краем экрана').toBeGreaterThan(320)
  expect.soft(look.titleCut, 'имя не кончается «…»').toBe(false)
})

test('А1б: имя в 40 знаков — предел схемы — на 390, основном телефоне', async ({ page }) => {
  const look = await pickerWith(page, 390, 'Общая карта Ш. для коммунальных платежей')
  expect.soft(look.sideways, 'шторка выбора листается вбок').toBeGreaterThan(0)
  expect.soft(look.checkRight, '✓ выбранной строки за правым краем экрана').toBeGreaterThan(390)
})

test('А1 (К): короткое имя на 320 — шторка по экрану, ✓ внутри (контроль, зелёный = замер честный)', async ({
  page,
}) => {
  const look = await pickerWith(page, 320, 'Наличные ֏')
  expect.soft(look.sideways).toBe(0)
  expect.soft(look.checkRight).toBeLessThanOrEqual(320)
  expect.soft(look.titleCut).toBe(false)
})
