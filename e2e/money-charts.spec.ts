import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { asBrowser, signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

/**
 * «Графики» end to end (MOL-74): the months the server counts side by side, reached from «Деньги»
 * by a category or by «Графики по месяцам», a bar chosen by a tap, the period in the address
 * without an entry in the history, and the last answer kept for a shelf with no connection.
 */

function yerevanDay(days = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yerevan' }).format(
    new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  )
}

/** The middle of last month in Yerevan: a day any month has. */
function lastMonthDay(): string {
  const day = new Date(`${yerevanDay().slice(0, 7)}-15T12:00:00Z`)
  day.setUTCMonth(day.getUTCMonth() - 1)
  return day.toISOString().slice(0, 10)
}

async function seed(page: Page): Promise<void> {
  await signedIn(page)
  const headers = await asBrowser(page)
  const { categories } = (await (
    await page.request.get('/api/spending-categories', { headers })
  ).json()) as { categories: { id: string; preset: string | null }[] }
  const cafe = categories.find((category) => category.preset === 'cafe')?.id
  const rent = categories.find((category) => category.preset === 'rent')?.id
  const spend = async (amount: string, spentOn: string, categoryId: string | undefined) => {
    const response = await page.request.post('/api/spendings', {
      headers,
      data: { id: randomUUID(), spentOn, amount: { amount, currency: 'AMD' }, categoryId },
    })
    expect(response.status(), await response.text()).toBe(201)
  }
  await spend('40000', lastMonthDay(), cafe)
  await spend('180000', lastMonthDay(), rent)
  await spend('30000', yerevanDay(), cafe)
}

test('a category of «Куда ушли» opens its charts, a bar is chosen by a tap, «назад» is «Деньги»', async ({
  page,
}) => {
  await seed(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: /Кафе и рестораны/ }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Графики')
  await expect(page.getByRole('combobox', { name: 'Категория' })).toHaveValue(/.+/)
  await expect(
    page.getByRole('combobox', { name: 'Категория' }).locator('option:checked'),
  ).toHaveText('Кафе и рестораны')

  // The running month is read first; a tap on the bar before it reads that one.
  const spent = page.locator('fieldset.chart').first()
  await expect(spent).toContainText(/30\s000\s֏/)
  const bars = spent.locator('label.bar')
  const count = await bars.count()
  expect(count).toBe(6)
  await bars.nth(count - 2).click()
  await expect(spent).toContainText(/220\s000\s֏/)

  await page.getByRole('button', { name: 'Назад Деньги' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
})

test('the period moves by replace: «назад» from twelve months is «Деньги», not six', async ({
  page,
}) => {
  await seed(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: 'Графики по месяцам' }).click()
  await expect(page.locator('fieldset.chart').first().locator('label.bar')).toHaveCount(6)

  await page.getByText('12 месяцев', { exact: true }).click()
  await expect(page).toHaveURL(/period=12/)
  await expect(page.locator('fieldset.chart').first().locator('label.bar')).toHaveCount(12)

  await page.goBack()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
})

test('with no connection the charts are the last ones read, under a strip that is not red', async ({
  page,
  context,
}) => {
  await seed(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: 'Графики по месяцам' }).click()
  await expect(page.locator('fieldset.chart').first()).toContainText(/30\s000\s֏/)
  await page.goBack()

  await context.setOffline(true)
  await page.getByRole('link', { name: 'Графики по месяцам' }).click()
  const strip = page.locator('.strip')
  await expect(strip).toContainText('Нет связи. Графики на')
  await expect(page.locator('fieldset.chart').first()).toContainText(/30\s000\s֏/)
  await expect(page.getByRole('button', { name: 'Повторить' })).toHaveCount(0)
  await context.setOffline(false)
})
