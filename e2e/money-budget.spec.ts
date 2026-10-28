import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { asBrowser, goOffline, signedIn } from './session'
import { chooseCategory } from './category'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

/**
 * «Бюджет» end to end (MOL-117): a plan set on its screen, a spending written on «Деньги», and the
 * server's «осталось» on the screen and on the way into it — what no component test shows is that
 * the month the budget counts is the month «Деньги» count.
 */

async function openMoney(page: Page): Promise<void> {
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
}

async function openBudget(page: Page): Promise<void> {
  await page.getByRole('link', { name: /^Бюджет/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Бюджет')
}

test('a plan from this month on: «осталось» on the screen and on «Деньгах»', async ({ page }) => {
  await openMoney(page)
  await expect(page.getByRole('link', { name: 'Бюджет, не задан' })).toBeVisible()
  await openBudget(page)
  await expect(page.getByRole('heading', { name: 'Плана пока нет' })).toBeVisible()

  await page.getByRole('button', { name: 'Задать план категории' }).click()
  const sheet = page.locator('dialog[open]')
  await expect(sheet).toContainText('Новый план')
  // The sheet takes no tap while it rises.
  await page.waitForTimeout(400)
  await sheet.getByLabel('Категория').selectOption({ label: 'Аренда жилья' })
  await sheet.getByLabel('Сумма в месяц').fill('250000')
  await sheet.getByRole('button', { name: 'Сохранить' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.locator('.total .figure')).toHaveText(/250\s000\s֏/)
  await expect(page.getByRole('button', { name: /Аренда жилья/ })).toContainText(
    /0\s֏ из 250\s000\s֏/,
  )

  // A spending written on «Деньги» is in the budget the server counts, and in the figure beside it.
  await page.getByRole('button', { name: 'Деньги' }).first().click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await expect(sheet).toContainText('Новая трата')
  await page.waitForTimeout(400)
  await sheet.getByLabel('Сумма').fill('100000')
  await chooseCategory(page, 'Аренда жилья')
  await sheet.getByRole('button', { name: 'Сохранить трату' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByRole('link', { name: /^Бюджет, осталось 150\s000\s֏$/ })).toBeVisible()

  // A share of «Пришло»: nothing came in this month, so the share waits for it — no «сверх плана»
  // on all that was spent, and the total says why it has no figure (review 1).
  await openBudget(page)
  await page.getByRole('button', { name: /Аренда жилья/ }).click()
  await expect(sheet).toContainText('С ')
  await page.waitForTimeout(400)
  // The segment is tapped, as a finger does: its radio is hidden under it.
  await sheet.locator('label.segment', { hasText: '% от пришедшего' }).click()
  await sheet.getByLabel('Доля пришедшего').fill('10')
  await sheet.getByRole('button', { name: 'Сохранить' }).click()
  await expect(sheet).toBeHidden()
  const rent = page.getByRole('button', { name: /Аренда жилья/ })
  await expect(rent).toContainText('10 % пришедшего')
  await expect(rent).toContainText('пока ничего не пришло')
  await expect(page.locator('.total')).toContainText('Доля пришедшего появится')
  await expect(page.locator('.total')).not.toContainText('Сверх плана')
})

test('must not fire: with no connection a plan is not sent, and both ways say why', async ({
  page,
}) => {
  await openMoney(page)
  await openBudget(page)
  await expect(page.getByRole('heading', { name: 'Плана пока нет' })).toBeVisible()
  const sheet = page.locator('dialog[open]')

  // A plan to open, written while there is a connection.
  await page.getByRole('button', { name: 'Задать план категории' }).click()
  await expect(sheet).toContainText('Новый план')
  await page.waitForTimeout(400)
  await sheet.getByLabel('Категория').selectOption({ label: 'Аренда жилья' })
  await sheet.getByLabel('Сумма в месяц').fill('250000')
  await sheet.getByRole('button', { name: 'Сохранить' }).click()
  await expect(sheet).toBeHidden()

  let sent = false
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/budget/plans')) sent = true
  })
  await goOffline(page)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  // The strip is not now, in the focus order and saying why (Ф-6): a tap opens nothing (MOL-192).
  const add = page.getByRole('button', { name: 'Задать план можно со связью' })
  await expect(add).toHaveAttribute('aria-disabled', 'true')
  // Playwright itself counts an `aria-disabled` button as disabled: the tap is forced, as a finger's.
  await add.click({ force: true })
  await expect(sheet).toHaveCount(0)

  // The row still opens, and the sheet says in one line what waits for the connection.
  await page.getByRole('button', { name: /Аренда жилья/ }).click()
  await expect(sheet.locator('.strip.offline')).toContainText('со связью')
  await page.waitForTimeout(400)
  const save = sheet.getByRole('button', { name: 'Сохранить можно со связью' })
  await expect(save).toHaveAttribute('aria-disabled', 'true')
  // Not a native `disabled`: the button keeps its place in the focus order (Ф-6).
  await expect(save).not.toHaveAttribute('disabled')
  await save.click({ force: true })
  await expect(sheet.getByRole('button', { name: 'Убрать можно со связью' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  expect(sent).toBe(false)
})

test("the rows stand in one column at 390 and 320, a removed category's too (MOL-192)", async ({
  page,
}) => {
  await signedIn(page)
  const headers = await asBrowser(page)
  const { categories } = (await (
    await page.request.get('/api/spending-categories', { headers })
  ).json()) as { categories: { id: string; preset: string | null }[] }
  const idOf = (preset: string) => categories.find((one) => one.preset === preset)?.id ?? ''
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yerevan' }).format(new Date())
  for (const preset of ['rent', 'cafe']) {
    const planned = await page.request.put('/api/budget/plans', {
      headers,
      data: {
        categoryId: idOf(preset),
        from: today.slice(0, 7),
        plan: { kind: 'amount', amount: { amount: '50000', currency: 'AMD' } },
      },
    })
    expect(planned.ok(), await planned.text()).toBe(true)
  }
  // A removed category keeps its row only in a month something was spent in it (MOL-117, Р-5).
  const spent = await page.request.post('/api/spendings', {
    headers,
    data: {
      id: randomUUID(),
      spentOn: today,
      amount: { amount: '6500', currency: 'AMD' },
      categoryId: idOf('cafe'),
    },
  })
  expect(spent.status(), await spent.text()).toBe(201)
  const removed = await page.request.delete(`/api/spending-categories/${idOf('cafe')}`, {
    headers,
  })
  expect(removed.ok()).toBe(true)

  await page.goto('/money/budget')
  const rows = page.locator('li .list-row')
  await expect(rows.locator('.track')).toHaveCount(2)
  await expect(page.locator('li div.list-row')).toHaveCount(1)
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 })
    const edges = await rows.evaluateAll((all) =>
      all.map((row) => {
        const bar = row.querySelector('.track')?.getBoundingClientRect()
        const figure = row.querySelector('.amount')?.getBoundingClientRect()
        return `${String(Math.round(bar?.left ?? 0))}:${String(Math.round(bar?.right ?? 0))}:${String(Math.round(figure?.right ?? 0))}`
      }),
    )
    // A circle, a chevron or its empty place, and a gap on every row: one bar, one column of figures.
    expect(new Set(edges).size).toBe(1)
    // Nothing stands past the page.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
  }
})
