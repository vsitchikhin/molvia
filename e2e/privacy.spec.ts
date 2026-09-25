import { expect, test } from '@playwright/test'
import { signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

// MOL-58. The page is read before deciding to sign in, so it opens by its address with no
// session at all — the one route `meta.public` lets past MOL-56's login screen.
test('«Данные и приватность» opens by its address without a session', async ({ page }) => {
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Данные и приватность')
  await expect(page.getByRole('heading', { name: 'Удалить всё' })).toBeVisible()
  await expect(page.getByText(/Отправьте \/delete боту/)).toBeVisible()
})

test('and from the login screen, which is where a person without a session meets it', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Вход')
  await page.getByRole('link', { name: 'Данные и приватность', exact: true }).click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(page.getByRole('heading', { name: 'Удалить всё' })).toBeVisible()
})

test('and from the settings, with the chevron back to them', async ({ page }) => {
  await signedIn(page)
  await page.getByRole('link', { name: 'Настройки', exact: true }).click()
  await page.getByRole('button', { name: 'Данные и приватность', exact: true }).click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Данные и приватность')

  await page.getByRole('button', { name: 'Назад Настройки' }).click()
  await expect(page).toHaveURL(/\/settings$/)
})
