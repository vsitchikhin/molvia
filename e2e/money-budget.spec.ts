import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { signedIn } from './session'

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
  await sheet.getByRole('radio', { name: 'Аренда жилья' }).check()
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

test('must not fire: with no connection a plan is not sent, and the button waits', async ({
  page,
  context,
}) => {
  await openMoney(page)
  await openBudget(page)
  await expect(page.getByRole('heading', { name: 'Плана пока нет' })).toBeVisible()

  await context.setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await page.getByRole('button', { name: 'Задать план категории' }).click()
  const sheet = page.locator('dialog[open]')
  await expect(sheet).toContainText('План сохраняется только с интернетом')
  await expect(sheet.getByRole('button', { name: 'Ждём связь' })).toBeDisabled()
})
