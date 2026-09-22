import { expect, test } from '@playwright/test'
import { actorCodec, settingsOf } from '@molvia/model'
import { asBrowser, signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

test('settings draft survives tabs and offline; another device produces an explicit conflict', async ({
  page,
}, testInfo) => {
  await signedIn(page)
  await page.getByRole('link', { name: 'Настройки', exact: true }).click()
  const city = page.getByLabel('Город', { exact: true })
  await expect(city).toHaveValue('Гюмри')
  await city.selectOption('Ереван')
  await page.getByRole('link', { name: 'Что брать', exact: true }).click()
  await page.getByRole('link', { name: 'Настройки', exact: true }).click()
  await expect(city).toHaveValue('Ереван')
  const headers = await asBrowser(page)
  const current = actorCodec.parse(
    await (await page.request.get('/api/actors/me', { headers })).json(),
  )
  const previous = settingsOf(current)
  await page.context().setOffline(true)
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled()
  await page.context().setOffline(false)
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled()
  const rival = { ...previous, incomeCurrency: 'EUR' }
  const response = await page.request.put('/api/actors/me/settings', {
    headers,
    data: { previous, settings: rival },
  })
  expect(response.ok()).toBe(true)
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(
    page.getByText('Настройки изменились на другом устройстве', { exact: true }),
  ).toBeVisible()
  await expect(city).toHaveValue('Ереван')
  await page.getByRole('button', { name: 'Применить мои изменения', exact: true }).click()
  await expect(page.getByText('Настройки сохранены', { exact: true })).toBeVisible()
  await page.reload()
  await expect(city).toHaveValue('Ереван')
  await expect(page.getByLabel('Валюта для пересчёта', { exact: true })).toHaveValue('RUB')
  await testInfo.attach('settings-light', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
  await page.setViewportSize({ width: 320, height: 740 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await testInfo.attach('settings-dark', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
  const footnote = page.getByText(
    'Новые настройки — для следующих походов. Уже начатые сохранят свою валюту и курс',
    { exact: true },
  )
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight)
  })
  const footBox = await footnote.boundingBox()
  const dockBox = await page.locator('.dock').boundingBox()
  expect(footBox && dockBox && footBox.y + footBox.height <= dockBox.y).toBe(true)
  // Four tabs still fit the phone, and remain real navigation links.
  await expect(page.getByRole('navigation', { name: 'Разделы' }).getByRole('link')).toHaveCount(4)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})

test('an offline trip keeps the context captured before another device changed settings', async ({
  page,
}) => {
  await signedIn(page)
  const headers = await asBrowser(page)
  const previous = settingsOf(
    actorCodec.parse(await (await page.request.get('/api/actors/me', { headers })).json()),
  )
  await page.context().setOffline(true)
  await page.getByRole('button', { name: 'Начать поход', exact: true }).click()
  const sheet = page.locator('dialog[open]')
  await expect(sheet).toBeVisible()
  await page.waitForTimeout(400)
  await page.getByLabel('Другое место', { exact: true }).fill('SAS')
  await sheet.getByRole('button', { name: 'Начать поход', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  // The API request context models the connected second device while the page is offline.
  const moved = await page.request.put('/api/actors/me/settings', {
    headers,
    data: {
      previous,
      settings: { ...previous, city: 'Ереван', spendCurrency: 'USD', incomeCurrency: 'EUR' },
    },
  })
  expect(moved.ok()).toBe(true)
  const sent = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/trips'),
  )
  await page.context().setOffline(false)
  expect((await sent).postDataJSON()).toMatchObject({ context: previous })
  await expect
    .poll(async () => {
      const response = await page.request.get('/api/trips/current', { headers })
      return ((await response.json()) as { trip: { currency: string } | null }).trip?.currency
    })
    .toBe(previous.spendCurrency)
})

test('lost save responses remain uncertain until a read confirms the result', async ({
  page,
}, testInfo) => {
  await signedIn(page)
  await page.getByRole('link', { name: 'Настройки', exact: true }).click()
  const city = page.getByLabel('Город', { exact: true })
  await expect(city).toHaveValue('Гюмри')
  await city.selectOption('Ереван')
  await page.route('**/api/actors/me', (route) => route.abort())
  await page.route('**/api/actors/me/settings', async (route) => {
    // The server commits, but its answer never reaches this window.
    await route.fetch()
    await route.abort()
  })
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(
    page.getByText('Связь прервалась во время сохранения', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled()
  await testInfo.attach('settings-unknown', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
  await page.unroute('**/api/actors/me')
  await page.unroute('**/api/actors/me/settings')
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText('Настройки сохранены', { exact: true })).toBeVisible()
  await expect(city).toHaveValue('Ереван')
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled()
})

test.describe('narrow English settings', () => {
  test.use({ locale: 'en-US', viewport: { width: 320, height: 740 } })
  test('all four tabs and both currency fields fit', async ({ page }, testInfo) => {
    await signedIn(page)
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(page.getByLabel('Spending currency', { exact: true })).toHaveValue('AMD')
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await expect(page.getByRole('navigation').getByRole('link')).toHaveCount(4)
    await testInfo.attach('settings-320-en', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })
})
