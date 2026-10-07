/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { madeUpSerbianLink } from '@molvia/model/testing/serbian-receipt'
import { signedIn } from './session'

// A Serbian receipt by the link of its QR code (MOL-232): pasted on the phone — the sheet's way past
// its camera since MOL-233, whose own spec is `receipts-qr.spec.ts` — sent through the
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

/** The link pasted in the sheet of a Serbian receipt, past its camera (MOL-233): «Paste». */
async function paste(page: Page, text: string): Promise<void> {
  await page.getByRole('button', { name: 'Photograph a receipt' }).click()
  await risen(page)
  await sheet(page).getByRole('button', { name: 'Paste', exact: true }).click()
  await expect(sheet(page)).toContainText('Point your phone’s camera at the QR code')
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

// A finger's double tap on «Send receipt» (adversarial А3): the sheet stays at work for it, so the
// second tap lands on the busy button — one receipt, and «Покупки» stay on the screen.
test('a double tap on «Send receipt» sends one receipt and stays in «Purchases»', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await signedIn(page, '/purchases')
  await paste(page, link())
  const box = await sheet(page).getByRole('button', { name: 'Send receipt' }).boundingBox()
  if (box === null) throw new Error('no button')
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
  await page.touchscreen.tap(x, y)
  await page.waitForTimeout(60)
  await page.touchscreen.tap(x, y)
  await expect(sheet(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/purchases$/)
  await expect(page.locator('.purchase-row').filter({ hasText: '2 items' })).toHaveCount(1, READ)
  await page.waitForTimeout(3_000)
  await expect(page.locator('.purchase-row').filter({ hasText: '2 items' })).toHaveCount(1)
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

/** The code `bin/fake-purs.mjs` gives the sugar of a CODEDAAA receipt: 860, the counter, the check. */
function sugarCode(counter: number): string {
  const twelve = `860${String(counter).padStart(9, '0').slice(-9)}`
  let sum = 0
  for (let at = 0; at < 12; at += 1) sum += Number(twelve[11 - at]) * (at % 2 ? 1 : 3)
  return `${twelve}${String((10 - (sum % 10)) % 10)}`
}

// MOL-234, owner's В-1 «а», В-2 «а»: the tax office's specification gives a line its package's code,
// and «Записать» asks once whether to bind it — the code then finds the item by the scanner.
test('a code from the tax office is asked about at «Save», and bound finds its item', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const counter = Date.now() % 1_000_000_000
  const code = sugarCode(counter)
  await signedIn(page, '/purchases')
  await paste(
    page,
    madeUpSerbianLink({ totalHundredths: 48_637, at: AT, requestedBy: 'CODEDAAA', counter }),
  )
  await sheet(page).getByRole('button', { name: 'Send receipt' }).click()
  await expect(sheet(page)).toHaveCount(0)
  const ready = page.locator('.purchase-row').filter({ hasText: '2 items' })
  await expect(ready).toBeVisible(READ)
  await ready.click()
  await expect(page.locator('.receipt-line')).toHaveCount(2)

  await page.getByRole('button', { name: 'Save 2 purchases' }).click()
  await expect(sheet(page)).toBeVisible()
  await risen(page)
  // the place first, when no receipt of the premises was recorded yet; then the codes
  if ((await sheet(page).getByLabel('Another place').count()) > 0) {
    await sheet(page).getByRole('button', { name: 'Save 2 purchases' }).click()
    await expect(sheet(page).getByText('Link the barcodes?')).toBeVisible(READ)
    await risen(page)
  }
  await expect(sheet(page)).toContainText(code)
  await sheet(page).getByRole('button', { name: 'Link and record' }).click()
  await expect(page).toHaveURL(/\/purchases\/[0-9a-f-]+$/, READ)
  await expect(page.getByRole('heading', { name: 'Saved 2 purchases' })).toBeVisible()

  const found = await page.evaluate(async (asked) => {
    const response = await fetch(`/api/catalogue/barcode?code=${asked}`, { credentials: 'include' })
    return (await response.json()) as { item: { name: string } | null }
  }, code)
  expect(found.item).not.toBeNull()
})
