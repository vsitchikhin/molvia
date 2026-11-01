import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
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

// MOL-349, С-1: the lists are paragraphs in a plain card. Drawn as a card of rows they had no padding,
// and the radius cut the first letter of «Номер аккаунта Telegram» — a page read before signing in.
test("its lists stand inside the card's padding, never on its edge", async ({ page }) => {
  await page.goto('/privacy')
  const cards = page.locator('.card:has(dl)')
  await expect(cards).toHaveCount(2)
  for (const card of await cards.all()) {
    await expect(card).toHaveCSS('padding-left', '16px')
    const [edge, term] = await Promise.all([
      card.boundingBox(),
      card.locator('dt').first().boundingBox(),
    ])
    expect(term!.x - edge!.x).toBeGreaterThanOrEqual(16)
    expect(term!.y - edge!.y).toBeGreaterThanOrEqual(16)
  }
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

/** The entry the router laid under the screen, as the history keeps it. */
async function below(page: Page): Promise<unknown> {
  return page.evaluate(() => (window.history.state as { back?: unknown } | null)?.back)
}

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
    // Home is laid underneath — not «Настройки», and not nothing (self-review №5).
    expect(await below(page)).toBe('/')
    await page.getByRole('button', { name: 'Назад Вход', exact: true }).click()
    await expect(page).toHaveURL(/:\d+\/$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Molvia')

    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
    expect(await below(page)).toBe('/')
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
