/// <reference lib="dom" />
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { prepareZXingModule, writeBarcode } from 'zxing-wasm/writer'
import { madeUpSerbianLink } from '@molvia/model/testing/serbian-receipt'
import { signedIn } from './session'

// A Serbian receipt photographed (MOL-233): the phone reads the QR code off the photo in its worker,
// with the app's own wasm, and only the link goes — through the receipts' queue to the API, which asks
// the fake tax office (`bin/fake-purs.mjs`, as `receipts-link.spec.ts`). The photo is drawn here: a
// receipt on a dark table, its rows, and at its foot the tax office's QR at correction L, four pixels
// a module — what a 12 Mp shot of an 80 mm roll gives (MOL-223). A phone in Belgrade starts in Serbia.
test.use({ timezoneId: 'Europe/Belgrade' })

const sheet = (page: Page) => page.locator('dialog[open]')
const READ = { timeout: 30_000 }
const AT = new Date('2025-07-18T06:56:53Z')

const require = createRequire(import.meta.url)

test.beforeAll(async () => {
  await prepareZXingModule({
    overrides: {
      wasmBinary: readFileSync(require.resolve('zxing-wasm/writer/zxing_writer.wasm')).buffer,
    },
    fireImmediately: true,
  })
})

/** A link of its own for every test and every retry: a receipt recorded is refused a second time. */
function link(transactionType = 0): string {
  return madeUpSerbianLink({
    totalHundredths: 48_637,
    at: AT,
    transactionType,
    counter: Date.now() % 4_000_000_000,
  })
}

/** The modules of a QR code, dark as 1, row by row. */
async function modules(text: string): Promise<{ size: number; dark: number[] }> {
  const { symbol, error } = await writeBarcode(text, { format: 'QRCode', ecLevel: 'L' })
  if (error) throw new Error(error)
  return { size: symbol.width, dark: Array.from(symbol.data, (value) => (value === 0 ? 1 : 0)) }
}

/** A receipt on a table as the browser draws it, a JPEG; the QR at its foot, if given. */
async function photo(page: Page, qr: string | null): Promise<Buffer> {
  const code = qr === null ? null : await modules(qr)
  const encoded = await page.evaluate(async (symbol) => {
    const [width, height, scale] = [1400, 2100, 4]
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no canvas')
    context.fillStyle = '#2b2622'
    context.fillRect(0, 0, width, height)
    context.fillStyle = '#f7f3ea'
    context.fillRect(250, 60, 900, 1980)
    context.fillStyle = '#222'
    for (let y = 140; y < 1400; y += 48) context.fillRect(300, y, 800 - (y % 240), 16)
    if (symbol) {
      const left = 700 - (symbol.size * scale) / 2
      for (let y = 0; y < symbol.size; y++) {
        for (let x = 0; x < symbol.size; x++) {
          if (symbol.dark[y * symbol.size + x]) {
            context.fillRect(left + x * scale, 1500 + y * scale, scale, scale)
          }
        }
      }
    }
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.9)
    })
    if (!blob) throw new Error('no jpeg')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }, code)
  return Buffer.from(encoded, 'base64')
}

async function risen(page: Page): Promise<void> {
  await sheet(page).evaluate((dialog) =>
    Promise.allSettled(dialog.getAnimations().map((animation) => animation.finished)),
  )
  await page.waitForTimeout(350)
}

/** «Photograph a receipt» → «Choose photo» with the photo given. */
async function shoot(page: Page, qr: string | null): Promise<void> {
  await page.getByRole('button', { name: 'Photograph a receipt' }).click()
  await expect(sheet(page)).toContainText('the photo stays on your phone')
  await risen(page)
  await sheet(page)
    .locator('input[type="file"]:not([capture])')
    .setInputFiles({ name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: await photo(page, qr) })
}

test('a receipt photographed from «What to buy»: its QR read on the phone, the link asked of the tax office', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await signedIn(page, '/')
  // Serbia is in the version «with receipts» of «What to buy» now (MOL-233, Р-9 of MOL-232 lifted)
  await shoot(page, link())
  await expect(sheet(page)).toHaveCount(0, READ)
  await expect(page).toHaveURL(/\/purchases$/)

  const ready = page.locator('.purchase-row').filter({ hasText: '2 items' })
  await expect(ready).toBeVisible(READ)
  await ready.click()
  await expect(page.getByText('Lines from the Serbian tax office')).toBeVisible()
  await expect(page.locator('.receipt-line')).toHaveCount(2)
})

test('a photo with no QR says how to shoot it, and the link may be pasted', async ({ page }) => {
  await signedIn(page, '/purchases')
  await shoot(page, null)
  await expect(sheet(page)).toContainText('No QR code found', READ)
  await sheet(page).getByRole('button', { name: 'Paste the link' }).click()
  await expect(sheet(page).getByLabel('Link from the receipt')).toBeFocused()
})

test('a refund’s QR is said by its reason, and nothing is queued', async ({ page }) => {
  await signedIn(page, '/purchases')
  await shoot(page, link(1))
  await expect(sheet(page)).toContainText('This is a refund receipt — it is not recorded', READ)
  await expect(sheet(page).getByRole('button', { name: 'Shoot another' })).toBeVisible()
  await expect(page.locator('.purchase-row').filter({ hasText: 'by link' })).toHaveCount(0)
})
