import { expect, test } from '@playwright/test'
import { signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

// MOL-58. The page is read before deciding to sign in, so it opens by its address with no
// session at all — the one route `meta.public` lets past MOL-56's login screen.
test('«Данные и приватность» opens by its address without a session', async ({ page }) => {
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Данные и приватность')
  await expect(page.getByRole('heading', { name: 'Удалить всё' })).toBeVisible()
  // Both doors (MOL-94): the row in the settings and the bot's command.
  await expect(page.getByText(/«Удалить мои данные», или отправьте \/delete боту/)).toBeVisible()
})

test('and from the login screen, which is where a person without a session meets it', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Molvia')
  await page.getByRole('link', { name: 'Данные и приватность', exact: true }).click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(page.getByRole('heading', { name: 'Удалить всё' })).toBeVisible()
})

// MOL-216, Е-9: without a session «‹ Настройки» promised a screen nobody is let into. Behind the door
// the chevron is the door's, and it lands where the login stood — the address the person was going to.
test('back from it without a session is «‹ Вход», onto the address the login stood at', async ({
  page,
}) => {
  await page.goto('/purchases')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Molvia')
  await page.getByRole('link', { name: 'Данные и приватность', exact: true }).click()
  await expect(page).toHaveURL(/\/privacy$/)

  await page.getByRole('button', { name: 'Назад Вход', exact: true }).click()
  await expect(page).toHaveURL(/\/purchases$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Molvia')
})

// Owner's В-1 «а»: opened by a link with nobody on the device, home is laid underneath, where the door
// stands — not «Настройки», where a stranger would have signed in. The chevron and the system «back» agree.
for (const [path, title] of [
  ['/privacy', 'Данные и приватность'],
  ['/terms', 'Условия использования'],
] as const)
  test(`opened by its address without a session, ${path} leads back home to the door`, async ({
    page,
  }) => {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
    await page.getByRole('button', { name: 'Назад Вход', exact: true }).click()
    await expect(page).toHaveURL(/:\d+\/$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Molvia')

    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
    await page.goBack()
    await expect(page).toHaveURL(/:\d+\/$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Molvia')
  })

test('and from the settings, with the chevron back to them', async ({ page }) => {
  await signedIn(page)
  await page.getByRole('link', { name: 'Настройки', exact: true }).click()
  await page.getByRole('link', { name: 'Данные и приватность', exact: true }).click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Данные и приватность')

  await page.getByRole('button', { name: 'Назад Настройки' }).click()
  await expect(page).toHaveURL(/\/settings$/)
})
