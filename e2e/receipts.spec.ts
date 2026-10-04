/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { signedIn } from './session'

// Receipts on the phone (MOL-127): taken in the browser, kept by the queue, read by the fake reader
// (`bin/fake-receipt-reader.mjs` answers every photo with the bench's reading of am-05 — thirteen
// lines dated 1 October), reviewed and recorded. The list asks again every five seconds while a
// receipt is being read, so the waits below are generous.

const sheet = (page: Page) => page.locator('dialog[open]')
/** «Края чека» (MOL-222), over the capture sheet. */
const edges = (page: Page) => page.locator('dialog[open]').filter({ hasText: 'Receipt edges' })

/** Every shot passes «Края чека»: «Done» once its sheet has come up. */
async function edged(page: Page): Promise<void> {
  await expect(edges(page)).toBeVisible()
  await page.waitForTimeout(400)
  await edges(page).getByRole('button', { name: 'Done' }).click()
  await expect(edges(page)).toHaveCount(0)
}
const READ = { timeout: 30_000 }

/** A photo the browser itself draws and encodes: a sheet of paper with rows on it, as a JPEG. */
async function photo(page: Page, width = 900, height = 2400): Promise<Buffer> {
  const encoded = await page.evaluate(
    async ([w, h]) => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const context = canvas.getContext('2d')
      if (!context) throw new Error('no canvas')
      context.fillStyle = '#f7f3ea'
      context.fillRect(0, 0, w, h)
      context.fillStyle = '#222'
      for (let y = 80; y < h - 80; y += 60) context.fillRect(60, y, w - 120 - (y % 300), 18)
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', 0.9)
      })
      if (!blob) throw new Error('no jpeg')
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return btoa(binary)
    },
    [width, height] as const,
  )
  return Buffer.from(encoded, 'base64')
}

/** «Сфотографировать чек» → «Выбрать фото» → the parts given, then «Отправить чек». */
async function capture(page: Page, parts = 1): Promise<void> {
  await page.getByRole('button', { name: 'Photograph a receipt' }).click()
  await expect(sheet(page)).toContainText('Smooth the receipt out')
  // The gallery's field: the camera's has `capture`, «Next part» uses the same plain one.
  for (let part = 1; part <= parts; part += 1) {
    await sheet(page)
      .locator('input[type="file"]:not([capture])')
      .first()
      .setInputFiles({
        name: `part-${String(part)}.jpg`,
        mimeType: 'image/jpeg',
        buffer: await photo(page),
      })
    await edged(page)
    await expect(sheet(page)).toContainText(`Part ${String(part)}`)
  }
  await page.waitForTimeout(400)
  await sheet(page).getByRole('button', { name: 'Send receipt' }).click()
  await expect(sheet(page)).toHaveCount(0)
}

/**
 * «Save 13 purchases», naming the place when the review asks for it. The place is found by the tax
 * number once any receipt of that seller was recorded — by another spec on the same database too —
 * so the sheet comes or does not, and neither is the point of a spec: the spec takes whichever came.
 */
async function saveAll(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save 13 purchases' }).click()
  // One of two outcomes, waited for and never timed (review 30): the sheet asks, or the review
  // gave way.
  const asked = async () => {
    if (await sheet(page).isVisible()) return 'asked'
    return new URL(page.url()).pathname.includes('/purchases/receipts/') ? null : 'left'
  }
  await expect.poll(asked, READ).not.toBeNull()
  if ((await asked()) === 'asked') {
    // Seen at once, it is still rising, and until it has risen it takes no tap at all (MOL-69): its
    // rise, then the double-tap floor — as `erase.spec.ts` waits.
    await sheet(page).evaluate((dialog) =>
      Promise.allSettled(dialog.getAnimations().map((animation) => animation.finished)),
    )
    await page.waitForTimeout(350)
    await expect(sheet(page)).toContainText('Where was it?')
    await sheet(page).getByLabel('Another place').fill('Ереван Сити')
    await sheet(page).getByRole('button', { name: 'Save 13 purchases' }).click()
  }
}

test('a receipt from the photo to the purchases: read, reviewed, recorded under a place named', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await signedIn(page, '/purchases')
  await capture(page)

  // Read by the fake reader: «Check and save», thirteen items dated 1 October.
  const ready = page.locator('.purchase-row').filter({ hasText: '13 items' })
  await expect(ready).toBeVisible(READ)
  await ready.click()
  await expect(page).toHaveURL(/\/purchases\/receipts\/[0-9a-f-]+$/)
  await expect(page.locator('.receipt-line')).toHaveCount(13)
  await saveAll(page)

  // The review gives way to the purchases (`router.replace`), and says once what was written.
  await expect(page).toHaveURL(/\/purchases\/[0-9a-f-]+$/, READ)
  // The heading, not the text: the state speaks its words through the live region too.
  await expect(page.getByRole('heading', { name: 'Saved 13 purchases' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/\S/)
  // «Back» is «Покупки»: the review is in the history no more.
  await page.goBack()
  await expect(page).toHaveURL(/\/purchases$/)
  await expect(
    page.locator('.recorded .purchase-row').filter({ hasText: 'from a receipt' }),
  ).toBeVisible(READ)
})

test('a receipt taken with no connection waits on the phone and goes once it is back', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000)
  await signedIn(page, '/purchases')
  await context.setOffline(true)
  await capture(page, 2)

  const waiting = page.locator('.purchase-row').filter({ hasText: 'waiting for a connection' })
  await expect(waiting).toBeVisible()
  // No red anywhere while offline.
  await expect(page.locator('.state.bad')).toHaveCount(0)

  // Kept across a reload: the queue is storage and the photos are in IndexedDB. The dev server has
  // no worker to load the page offline, so the reload is made with the API refused instead.
  await page.route('**/api/**', (route) => route.abort())
  await context.setOffline(false)
  await page.reload()
  const held = page.locator('.purchase-row').filter({ hasText: '2 parts' })
  await expect(held).toBeVisible()

  await page.unroute('**/api/**')
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(held).toHaveCount(0, READ)
  await expect(page.locator('.purchase-row').filter({ hasText: '13 items' })).toBeVisible(READ)
})

test('a file that is not a photo is said in the sheet and never queued', async ({ page }) => {
  await signedIn(page, '/purchases')
  await page.getByRole('button', { name: 'Photograph a receipt' }).click()
  await expect(sheet(page)).toContainText('Smooth the receipt out')
  await sheet(page)
    .locator('input[type="file"]:not([capture])')
    .first()
    .setInputFiles({
      name: 'notes.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('not a picture'),
    })
  await expect(sheet(page)).toContainText('This file didn’t open as a photo')
  await expect(sheet(page).getByRole('button', { name: 'Send receipt' })).toHaveCount(0)
})

test('four parts and no fifth: the tile for the next part goes', async ({ page }) => {
  await signedIn(page, '/purchases')
  await page.getByRole('button', { name: 'Photograph a receipt' }).click()
  const field = sheet(page).locator('input[type="file"]:not([capture])').first()
  for (let part = 1; part <= 4; part += 1) {
    await field.setInputFiles({
      name: 'part.jpg',
      mimeType: 'image/jpeg',
      buffer: await photo(page),
    })
    await edged(page)
    await expect(sheet(page)).toContainText(`Part ${String(part)}`)
  }
  await expect(sheet(page)).toContainText('Four parts is the limit')
  await expect(sheet(page).getByText('Next part')).toHaveCount(0)
})

test('«Удалить чек» goes with «Вернуть» for ten seconds, and «Вернуть» brings it back', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await signedIn(page, '/purchases')
  await capture(page)
  const ready = page.locator('.purchase-row').filter({ hasText: '13 items' })
  await expect(ready).toBeVisible(READ)
  await ready.click()
  await page.getByRole('button', { name: 'Delete receipt' }).click()

  await expect(page).toHaveURL(/\/purchases$/)
  await expect(
    page.locator('.undo').filter({ hasText: 'Receipt deleted with its photo' }),
  ).toBeVisible()
  await expect(ready).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(ready).toBeVisible(READ)
})

test('a receipt sent from «Что брать» opens «Покупки», where its row is (review 3)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await signedIn(page, '/')
  await capture(page)
  await expect(page).toHaveURL(/\/purchases$/)
  await expect(
    page.locator('.purchase-row').filter({ hasText: /sending|reading|13 items/ }),
  ).toBeVisible(READ)
})

test('a line put right goes with «Записать»; recorded with no connection, it waits and goes (Р-5)', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000)
  await signedIn(page, '/purchases')
  await capture(page)
  const ready = page.locator('.purchase-row').filter({ hasText: '13 items' })
  await expect(ready).toBeVisible(READ)
  await ready.click()
  await expect(page.locator('.receipt-line')).toHaveCount(13)

  // The first line: its sum put right in the line's sheet, into the draft on the phone.
  await page.locator('.receipt-line').first().click()
  await expect(sheet(page)).toContainText('Receipt line')
  await page.waitForTimeout(400)
  await sheet(page).getByLabel('Price for all, as on the receipt').fill('777')
  await sheet(page).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(sheet(page)).toHaveCount(0)
  await expect(page.locator('.receipt-line').first()).toContainText('777')

  // No connection now: «Записать» waits in the queue and the review gives way to «Покупки».
  await context.setOffline(true)
  await saveAll(page)
  await expect(page).toHaveURL(/\/purchases$/)
  await expect(
    page.locator('.purchase-row').filter({ hasText: 'we’ll save it once you are online' }),
  ).toBeVisible()

  const sent = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && /\/api\/receipts\/[0-9a-f-]+\/record$/.test(request.url()),
  )
  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  const body = (await sent).postDataJSON() as {
    lines: { position: number; amount?: { amount: string } }[]
  }
  expect(body.lines.find((one) => one.position === 0)?.amount?.amount).toBe('777.00')
  await expect(
    page.locator('.recorded .purchase-row').filter({ hasText: 'from a receipt' }),
  ).toBeVisible(READ)
})
