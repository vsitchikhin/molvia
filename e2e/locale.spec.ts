import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { DEV_SEAM, acceptTerms, open, signedIn } from './session'

// A Russian phone: the app speaks Russian until the person chooses otherwise (MOL-398).
test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

function group(page: Page, name: RegExp): Locator {
  return page.getByRole('group', { name })
}

const LANGUAGE = /^(Язык|Language)$/
const DATE_STYLE = /^Date format$/

async function choose(
  page: Page,
  of: RegExp,
  word: string,
  name: string | RegExp = word,
): Promise<void> {
  const chosen = group(page, of)
  // Into the middle: at the edge of the window the group lies under the dock and the tab bar.
  await chosen.evaluate((element) => {
    element.scrollIntoView({ block: 'center' })
  })
  // The segment is tapped, as a finger does: its radio is hidden under it.
  await chosen.locator('label.segment', { hasText: word }).click()
  await expect(chosen.getByRole('radio', { name, exact: true })).toBeChecked()
}

function title(page: Page): Locator {
  return page.getByRole('heading', { level: 1 })
}

test('a language chosen in the settings speaks every screen at once, outlives a reload and gives way back to the phone', async ({
  page,
}) => {
  await signedIn(page, '/settings')
  await expect(title(page)).toHaveText('Настройки')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
  await expect(
    group(page, LANGUAGE).getByRole('radio', { name: 'Как на устройстве' }),
  ).toBeChecked()
  // Russian has one order of a day: nothing is asked about it.
  await expect(group(page, DATE_STYLE)).toHaveCount(0)

  await expect(page).toHaveTitle('Настройки · Molvia')
  await choose(page, LANGUAGE, 'English')
  await expect(title(page)).toHaveText('Settings')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB')
  // The tab is the screen's name too: a screen reader reads it, and Android's switcher shows it (А1).
  await expect(page).toHaveTitle('Settings · Molvia')
  await expect(group(page, DATE_STYLE).getByRole('radio', { name: '16 Nov, 14:05' })).toBeChecked()

  // `Intl` puts a narrow no-break space before «PM» in recent engines: the order is what is held.
  await choose(page, DATE_STYLE, 'Nov 16', /^Nov 16, 2:05\sPM$/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')

  await page.reload()
  await expect(title(page)).toHaveText('Settings')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
  await page.getByRole('link', { name: 'Purchases', exact: true }).click()
  await expect(title(page)).toHaveText('Purchases')

  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  // Tapped in English, checked in Russian: the screen speaks the phone's language again at once.
  await choose(page, LANGUAGE, 'As on device', 'Как на устройстве')
  await expect(title(page)).toHaveText('Настройки')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
  await expect(group(page, DATE_STYLE)).toHaveCount(0)
})

test('the login screen offers the other language named in itself, and it stays after signing in', async ({
  page,
}) => {
  await page.goto('/')
  const other = page.getByRole('button', { name: 'English', exact: true })
  await expect(other).toHaveAttribute('lang', 'en')
  await other.click()
  await expect(page.getByText('What to buy in a new place — and where')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Русский', exact: true })).toBeVisible()
  await expect(page).toHaveTitle('Sign in · Molvia')

  // In with no reload: the door gives the tab back by the route, in the language chosen at it (А1).
  await page.getByRole('button', { name: DEV_SEAM }).click()
  await acceptTerms(page)
  await expect(title(page)).toHaveText('What to buy')
  await expect(page).toHaveTitle('What to buy · Molvia')

  await open(page, '/settings')
  await expect(title(page)).toHaveText('Settings')
  await expect(group(page, LANGUAGE).getByRole('radio', { name: 'English' })).toBeChecked()
})
