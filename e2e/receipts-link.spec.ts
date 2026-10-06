/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { madeUpSerbianLink } from '@molvia/model/testing/serbian-receipt'
import { signedIn } from './session'

// A Serbian receipt by the link of its QR code (MOL-232): pasted on the phone, sent through the
// receipts' queue, asked of the tax office by the API — `bin/fake-purs.mjs`, which answers a journal of
// two lines, «SECER KRISTAL» and «BANANA KG», 486,37 дин in all, at «ТЕСТ ПРОДАВНИЦА 1» of Belgrade —
// reviewed and recorded in dinars. A person whose phone is in Belgrade starts in Serbia (MOL-89).
test.use({ timezoneId: 'Europe/Belgrade' })

const sheet = (page: Page) => page.locator('dialog[open]')
const READ = { timeout: 30_000 }
const AT = new Date('2025-07-18T06:56:53Z')

/** A link of its own for every test and every retry: a receipt recorded is refused a second time. */
function link(requestedBy = 'TESTAAAA'): string {
  return madeUpSerbianLink({
    totalHundredths: 48_637,
    at: AT,
    requestedBy,
    counter: Date.now() % 4_000_000_000,
  })
}

async function risen(page: Page): Promise<void> {
  await sheet(page).evaluate((dialog) =>
    Promise.allSettled(dialog.getAnimations().map((animation) => animation.finished)),
  )
  await page.waitForTimeout(350)
}

async function paste(page: Page, text: string): Promise<void> {
  await page.getByRole('button', { name: 'Receipt by link' }).click()
  await expect(sheet(page)).toContainText('Point your phone’s camera at the QR code')
  await risen(page)
  await sheet(page).getByLabel('Link from the receipt').fill(text)
}

test('a receipt by its link: pasted, asked of the tax office, reviewed and recorded in dinars', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await signedIn(page, '/purchases')
  await paste(page, `Fiskalni račun ${link()}`)
  await sheet(page).getByRole('button', { name: 'Send receipt' }).click()
  await expect(sheet(page)).toHaveCount(0)

  const ready = page.locator('.purchase-row').filter({ hasText: '2 items' })
  await expect(ready).toBeVisible(READ)
  await ready.click()
  await expect(page).toHaveURL(/\/purchases\/receipts\/[0-9a-f-]+$/)
  await expect(page.getByText('Lines from the Serbian tax office')).toBeVisible()
  await expect(page.locator('.receipt-line')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Retake' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Save 2 purchases' }).click()
  // The place is the premises' once any receipt of it was recorded — by another spec on the same
  // database too — so the sheet comes or does not; when it does, it proposes the shop's own name.
  const asked = async () => {
    if (await sheet(page).isVisible()) return 'asked'
    return new URL(page.url()).pathname.includes('/purchases/receipts/') ? null : 'left'
  }
  await expect.poll(asked, READ).not.toBeNull()
  if ((await asked()) === 'asked') {
    await risen(page)
    await expect(sheet(page).getByLabel('Another place')).toHaveValue('ТЕСТ ПРОДАВНИЦА 1')
    await sheet(page).getByRole('button', { name: 'Save 2 purchases' }).click()
  }
  await expect(page).toHaveURL(/\/purchases\/[0-9a-f-]+$/, READ)
  await expect(page.getByRole('heading', { name: 'Saved 2 purchases' })).toBeVisible()
  // at the premises the tax office named, in dinars, the weighed line by the kilogram
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ТЕСТ ПРОДАВНИЦА 1')
  await expect(
    page.getByRole('button', { name: /^Banana 1\.482 kg BANANA KG RSD 296\.39/ }),
  ).toBeVisible()
})

test('a pasted text that is no receipt to record is refused under the field, and nothing is queued', async ({
  page,
}) => {
  await signedIn(page, '/purchases')
  await paste(page, link().slice(0, -12))
  await expect(sheet(page)).toContainText('The link is damaged — copy it again')
  await sheet(page)
    .getByLabel('Link from the receipt')
    .fill(madeUpSerbianLink({ totalHundredths: 100, at: AT, transactionType: 1 }))
  await expect(sheet(page)).toContainText('This is a refund receipt — it is not recorded')
  await sheet(page).getByRole('button', { name: 'Send receipt' }).click()
  await expect(sheet(page)).toBeVisible()
})

test('a link pasted with no connection waits on the phone and is read once it is back', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000)
  await signedIn(page, '/purchases')
  await context.setOffline(true)
  await paste(page, link())
  await sheet(page).getByRole('button', { name: 'Send receipt' }).click()
  await expect(sheet(page)).toHaveCount(0)
  await expect(page.locator('.purchase-row').filter({ hasText: 'by link' })).toBeVisible()

  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.locator('.purchase-row').filter({ hasText: '2 items' })).toBeVisible(READ)
})

test('a receipt the tax office does not show yet stays «asking the tax office», with no failure', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await signedIn(page, '/purchases')
  // the fake shows a receipt of `FRESHAAA` only on its third ask, three minutes on: the ladder itself
  // is the integration test's
  await paste(page, link('FRESHAAA'))
  await sheet(page).getByRole('button', { name: 'Send receipt' }).click()
  await expect(
    page.locator('.purchase-row').filter({ hasText: 'asking the tax office' }),
  ).toBeVisible(READ)
})
