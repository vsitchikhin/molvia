import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { SESSION_COOKIE } from '@molvia/model'
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
  await expect(page.locator('.erasure')).toHaveText(/Ваши данные удалены/)
  expect(await page.evaluate(() => localStorage.getItem('molvia.actor'))).toBeNull()
  const cookies = await page.context().cookies()
  expect(cookies.some((cookie) => cookie.name.endsWith('molvia_session'))).toBe(false)
  // The session that asked is gone on the server, not only put out here.
  expect((await page.request.get('/api/actors/me', { headers })).status()).toBe(401)

  // Signing in again is a new, empty account; the catalogue kept the item, without its author.
  const again = await signedIn(page)
  expect(again).not.toBe(owner)
  await expect(page.locator('.erasure')).toHaveCount(0)
  const found = await page.request.get(`/api/catalogue/search?q=${encodeURIComponent(name)}`, {
    headers: await asBrowser(page),
  })
  expect(JSON.stringify(await found.json())).toContain(name)
})

// Adversarial А: the session ended from «Устройства» while the sheet was open. The server erases
// nothing, and the phone must neither erase its drawer nor look as if it had.
test('сессию кончили, пока лист открыт: нажатие ничего не удалило, ящик цел, вход — тот же человек', async ({
  page,
}) => {
  const owner = await signedIn(page)
  const headers = await asBrowser(page)
  await page.getByRole('link', { name: 'Настройки', exact: true }).click()
  await page.getByRole('button', { name: /Удалить мои данные/ }).click()
  await page
    .locator('dialog[open]')
    .evaluate((dialog) =>
      Promise.allSettled(dialog.getAnimations().map((animation) => animation.finished)),
    )
  await page.waitForTimeout(350)
  const [held] = (await page.context().cookies()).filter((one) => one.name === SESSION_COOKIE)
  if (!held) throw new Error('no session cookie')

  // «Устройства» on another device ends this one's session; the phone keeps its cookie — put back
  // after `page.request`, which shares the jar, dropped it.
  const listed = await page.request.get('/api/sessions', { headers })
  const { sessions } = (await listed.json()) as { sessions: { id: string; current: boolean }[] }
  const mine = sessions.find((one) => one.current)
  expect((await page.request.delete(`/api/sessions/${mine?.id ?? ''}`, { headers })).status()).toBe(
    204,
  )
  await page.context().addCookies([held])

  const answered = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/actors/me') && response.request().method() === 'DELETE',
  )
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Удалить навсегда', exact: true })
    .click()
  expect((await answered).status()).toBe(401)

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Вход')
  await expect(page.locator('.erasure')).toHaveText(/это нажатие ничего не удалило/)
  // A 401 erases nothing: the drawer of an account that is still there stays.
  expect(await page.evaluate(() => localStorage.getItem('molvia.actor'))).toBe(owner)

  const again = await signedIn(page)
  expect(again).toBe(owner)
})
