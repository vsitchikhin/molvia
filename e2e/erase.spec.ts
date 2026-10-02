import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { asBrowser, signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

// MOL-94: the second door to the erasure behind the bot's `/delete`.
test('«Удалить мои данные» стирает человека и устройство и говорит об этом на экране входа', async ({
  page,
}) => {
  const owner = await signedIn(page)
  const headers = await asBrowser(page)
  const name = `Тан ${randomUUID().slice(0, 8)}`
  const proposed = await page.request.post('/api/catalogue/items', {
    headers,
    data: { kind: 'product', name, defaultUnit: 'l' },
  })
  expect(proposed.status()).toBe(201)

  await page.getByRole('link', { name: 'Настройки', exact: true }).click()
  await page.getByRole('button', { name: /Удалить мои данные/ }).click()
  // Until it has risen the sheet takes no tap at all (MOL-69): its rise, then the double-tap floor.
  await page
    .locator('dialog[open]')
    .evaluate((dialog) =>
      Promise.allSettled(dialog.getAnimations().map((animation) => animation.finished)),
    )
  await page.waitForTimeout(350)
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText('Удалить все ваши данные?')).toBeVisible()
  await expect(sheet.getByText(/Отменить это нельзя/)).toBeVisible()
  await sheet.getByRole('button', { name: 'Удалить навсегда', exact: true }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Вход')
  // Outside the live region, which says the same words (MOL-64).
  await expect(page.locator('.erased')).toHaveText(/Ваши данные удалены/)
  expect(await page.evaluate(() => localStorage.getItem('molvia.actor'))).toBeNull()
  const cookies = await page.context().cookies()
  expect(cookies.some((cookie) => cookie.name.endsWith('molvia_session'))).toBe(false)
  // The session that asked is gone on the server, not only put out here.
  expect((await page.request.get('/api/actors/me', { headers })).status()).toBe(401)

  // Signing in again is a new, empty account; the catalogue kept the item, without its author.
  const again = await signedIn(page)
  expect(again).not.toBe(owner)
  await expect(page.locator('.erased')).toHaveCount(0)
  const found = await page.request.get(`/api/catalogue/search?q=${encodeURIComponent(name)}`, {
    headers: await asBrowser(page),
  })
  expect(JSON.stringify(await found.json())).toContain(name)
})
