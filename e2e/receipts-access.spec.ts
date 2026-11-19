import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ffOff, signedIn } from './session'

// Where a person stands with the model that reads receipts, on the phone (MOL-276): the row of the settings and
// the sheet «Trial receipts are used up» before the camera. The suite's API has no model, so no receipt spends the
// trial here: the figures the server sends are put at the end of the trial by a route laid before `open()`, the
// wire and its codec left as they are. **WebKit is not run** (`iphone`): it keeps no `Secure` cookie on the
// loopback and opens no screen of a person (`session.ts`) — the sheet is the kit's `BottomSheet`, which
// `sheet.spec` holds there.

const sheet = (page: Page) => page.locator('dialog[open]')

/** Until it has risen a sheet takes no tap at all (MOL-69): its rise, then the double-tap floor. */
async function risen(page: Page): Promise<void> {
  await sheet(page).evaluate((dialog) =>
    Promise.allSettled(dialog.getAnimations().map((animation) => animation.finished)),
  )
  await page.waitForTimeout(350)
}

/**
 * The server's answer to «who am I» with the trial spent: ten read, none left, nothing paid. An answer that says no
 * figures — the `401` before the login — goes as it came.
 */
async function trialSpent(page: Page): Promise<void> {
  await page.route('**/api/actors/me', async (route) => {
    const response = await route.fetch()
    const body = (await response.json()) as { receiptsAccess?: Record<string, unknown> }
    if (!body.receiptsAccess) {
      await route.fulfill({ response })
      return
    }
    body.receiptsAccess = { ...body.receiptsAccess, until: null, trialLeft: 0, read: 10 }
    await route.fulfill({ response, json: body })
  })
}

test('the settings say the trial the server counts, a status with nothing to open', async ({
  page,
}) => {
  await signedIn(page, '/settings')
  const row = page.locator('.list-row').filter({ hasText: 'Receipt reading' })
  await expect(row).toContainText('Trial receipts left: 10 of 10')
  await expect(page.getByRole('heading', { name: 'Receipts', exact: true })).toBeVisible()
  await expect(row.getByRole('button')).toHaveCount(0)
})

test('the trial spent, payment open: the sheet at every tap, and «Add by hand» goes on to «Where are you?»', async ({
  page,
}) => {
  await trialSpent(page)
  // The seam's answer is the login's and says no figures; a launch asks `/actors/me`, as the app does at every start.
  await signedIn(page, '/settings')
  await expect(page.locator('.list-row').filter({ hasText: 'Receipt reading' })).toContainText(
    'Trial receipts are used up. Purchases can be recorded by hand',
  )
  await page.goto('/purchases')
  const capture = page.getByRole('button', { name: 'Photograph a receipt' })

  await capture.click()
  await expect(sheet(page)).toContainText('Trial receipts are used up')
  await expect(sheet(page)).toContainText('Purchases can be recorded by hand')
  // Nobody would read the receipt: no camera is offered.
  await expect(sheet(page).getByRole('button', { name: 'Photograph', exact: true })).toHaveCount(0)
  await risen(page)
  await sheet(page).getByRole('button', { name: 'Add by hand' }).click()
  await expect(sheet(page)).toContainText('Where are you?')
  await risen(page)
  await sheet(page).getByRole('button', { name: 'Close' }).click()
  await expect(sheet(page)).toHaveCount(0)

  // Again, the same words: nothing is told once while nobody reads.
  await capture.click()
  await expect(sheet(page)).toContainText('Trial receipts are used up')
})

test('the trial spent, payment not open: the sheet once, the camera first in it, then the camera at once', async ({
  page,
}) => {
  await ffOff(page, ['payments'])
  await trialSpent(page)
  await signedIn(page, '/settings')
  await expect(page.locator('.list-row').filter({ hasText: 'Receipt reading' })).toContainText(
    'Trial receipts are used up. Receipts are read by simple recognition',
  )

  await page.goto('/purchases')
  const capture = page.getByRole('button', { name: 'Photograph a receipt' })
  await capture.click()
  await expect(sheet(page)).toContainText('Trial receipts are used up')
  await expect(sheet(page).locator('.footer button').first()).toHaveText(/Photograph/)
  await risen(page)
  await sheet(page).getByRole('button', { name: 'Photograph', exact: true }).click()
  await expect(sheet(page)).toContainText('Smooth the receipt out')
  await risen(page)
  await sheet(page).getByRole('button', { name: 'Close' }).click()
  await expect(sheet(page)).toHaveCount(0)

  await capture.click()
  await expect(sheet(page)).toContainText('Smooth the receipt out')
  await expect(sheet(page)).not.toContainText('Trial receipts are used up')
})
