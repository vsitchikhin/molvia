import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ACCEPT, AGE, DEV_SEAM } from './session'

test.use({ reducedMotion: 'reduce' })

/**
 * MOL-95. The step after the claim and before the app: a newcomer of the seam has accepted no
 * edition. **Not through `open()`**, which passes the step for every other spec — here the step is
 * what is looked at, so the spec presses the seam itself, as `login-screen.spec` does.
 */
/** Until it has risen a sheet takes no tap at all (MOL-69): its rise, then the double-tap floor. */
async function risen(page: Page): Promise<void> {
  await page
    .locator('dialog[open]')
    .evaluate((dialog) =>
      Promise.allSettled(dialog.getAnimations().map((animation) => animation.finished)),
    )
  await page.waitForTimeout(350)
}

async function newcomer(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: DEV_SEAM }).click()
  await expect(page.getByRole('heading', { name: 'Terms and privacy' })).toBeVisible()
}

test('a newcomer accepts the terms once, with the age ticked, and comes in', async ({ page }) => {
  await newcomer(page)
  // Without the age ticked «I accept» is there and inactive — Playwright will not even press it.
  const accept = page.getByRole('button', { name: ACCEPT })
  await expect(accept).toHaveAttribute('aria-disabled', 'true')

  // The terms open over the shut door and «back» returns to the step.
  await page.getByRole('link', { name: 'Terms of use' }).click()
  await expect(page).toHaveURL(/\/terms$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Terms of use')
  await expect(page.getByText('You must be 16 or older.', { exact: false })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Terms and privacy' })).toBeVisible()

  const accepted = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/actors/me/consent') && response.request().method() === 'PUT',
  )
  await page.getByRole('checkbox', { name: AGE }).check()
  await accept.click()
  expect((await accepted).status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What to buy')

  // Asked once: the device remembers the edition, and the next launch does not even ask.
  let asked = false
  page.on('request', (request) => {
    if (request.url().endsWith('/api/actors/me/consent')) asked = true
  })
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What to buy')
  expect(asked).toBe(false)
})

test('«I do not accept» shows the account is there and leads out through «Sign out»', async ({
  page,
}) => {
  await newcomer(page)
  await page.getByRole('button', { name: 'I do not accept' }).click()
  await risen(page)
  const sheet = page.getByRole('dialog')
  await expect(
    sheet.getByRole('heading', { name: 'Molvia cannot be used without consent' }),
  ).toBeVisible()

  await sheet.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Sign out of Molvia on this device?' }),
  ).toBeVisible()
  await risen(page)
  await page.getByRole('button', { name: 'Sign out and erase' }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in')
  await expect(page.getByRole('button', { name: 'Sign in with Telegram' })).toBeVisible()
})

test('the age ticked survives reading the terms (adversarial А4)', async ({ page }) => {
  await newcomer(page)
  const age = page.getByRole('checkbox', { name: AGE })
  await age.check()
  await page.getByRole('link', { name: 'Terms of use' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Terms of use')
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Terms and privacy' })).toBeVisible()
  await expect(age).toBeChecked()
  await expect(page.getByRole('button', { name: ACCEPT })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  )
})

test('«Report a problem» on the step’s error opens the sheet there, and nothing rises after (А2)', async ({
  page,
}) => {
  let refused = false
  await page.route('**/api/actors/me/consent', async (route) => {
    if (route.request().method() === 'GET' && !refused) {
      refused = true
      await route.abort('failed')
      return
    }
    await route.continue()
  })
  await page.goto('/')
  await page.getByRole('button', { name: DEV_SEAM }).click()
  await expect(page.getByRole('heading', { name: 'Could not open the terms' })).toBeVisible()

  await page.getByRole('button', { name: 'Report a problem' }).click()
  await risen(page)
  const sheet = page.locator('dialog[open]')
  await expect(sheet.getByRole('heading', { name: 'Report a problem' })).toBeVisible()
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(sheet).toHaveCount(0)

  await page.getByRole('button', { name: 'Try again' }).click()
  await page.getByRole('checkbox', { name: AGE }).check()
  await page.getByRole('button', { name: ACCEPT }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What to buy')
  await page.waitForTimeout(500)
  await expect(page.locator('dialog[open]')).toHaveCount(0)
})

test('«Terms of use» opens by its address without a session, and from the login screen', async ({
  page,
}) => {
  await page.goto('/terms')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Terms of use')
  await expect(page.getByRole('heading', { name: 'No advertising' })).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in')
  await page.getByRole('link', { name: 'Terms of use', exact: true }).click()
  await expect(page).toHaveURL(/\/terms$/)
})
