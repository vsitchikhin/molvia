/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { signedIn } from './session'

// «Края чека» (MOL-222): every shot passes it before it is a part — the corners the phone found on a
// receipt lying on a dark table, moved by a finger, «Чек мелкий» for one too narrow to read, «‹» for
// a shot given up. The photos are drawn by the browser itself: nothing of anyone's receipt.

const edges = (page: Page) => page.locator('dialog[open]').filter({ hasText: 'Receipt edges' })
const capturing = (page: Page) =>
  page.locator('dialog[open]').filter({ hasText: 'Photograph a receipt' }).first()

/**
 * A receipt on a table, as a JPEG: the table dark and grained, the paper `paper` wide and tilted a
 * little, rows printed on it.
 */
async function onTable(page: Page, paper = 900): Promise<Buffer> {
  const encoded = await page.evaluate(async (width) => {
    const canvas = document.createElement('canvas')
    canvas.width = 2400
    canvas.height = 3200
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no canvas')
    context.fillStyle = '#3a2a1e'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#4a3626'
    for (let y = 0; y < canvas.height; y += 40) context.fillRect(0, y, canvas.width, 12)
    context.translate(canvas.width / 2, canvas.height / 2)
    context.rotate(0.06)
    context.fillStyle = '#f4f1ea'
    context.fillRect(-width / 2, -1300, width, 2600)
    context.fillStyle = '#222'
    for (let y = -1200; y < 1200; y += 60)
      context.fillRect(-width / 2 + 40, y, width - 80 - ((y + 1200) % 300), 18)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.9)
    })
    if (!blob) throw new Error('no jpeg')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }, paper)
  return Buffer.from(encoded, 'base64')
}

async function shoot(page: Page, paper = 900): Promise<void> {
  await signedIn(page, '/purchases')
  await page.getByRole('button', { name: 'Photograph a receipt' }).click()
  await expect(capturing(page)).toContainText('Smooth the receipt out')
  await capturing(page)
    .locator('input[type="file"]:not([capture])')
    .first()
    .setInputFiles({
      name: 'receipt.jpg',
      mimeType: 'image/jpeg',
      buffer: await onTable(page, paper),
    })
  await expect(edges(page)).toBeVisible()
  // the sheet takes no tap until it has come up (MOL-69)
  await page.waitForTimeout(400)
}

test('the corners found on the paper, «Done» makes the receipt a part', async ({ page }) => {
  await shoot(page)
  await expect(edges(page)).toContainText('Drag the corners to the receipt')
  // the top-left corner stands on the paper, not on the photo's corner
  const corner = edges(page).locator('.handle').first()
  const left = await corner.evaluate((node) => parseFloat((node as HTMLElement).style.left))
  expect(left).toBeGreaterThan(20)
  expect(left).toBeLessThan(40)
  await edges(page).getByRole('button', { name: 'Done' }).click()
  await expect(edges(page)).toHaveCount(0)
  await expect(capturing(page)).toContainText('Part 1')
  await expect(capturing(page).getByRole('button', { name: 'Send receipt' })).toBeVisible()
})

test('a corner dragged by the pointer moves, and the sheet stays where it is', async ({ page }) => {
  await shoot(page)
  const corner = edges(page).locator('.handle').nth(2)
  const before = await corner.boundingBox()
  if (!before) throw new Error('no corner')
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 - 30, before.y + before.height / 2 - 60, {
    steps: 6,
  })
  // the loupe shows where the finger is
  await expect(edges(page).locator('.loupe')).toBeVisible()
  await page.mouse.up()
  const after = await corner.boundingBox()
  expect(after?.y ?? 0).toBeLessThan(before.y - 30)
  await expect(edges(page)).toBeVisible()
  await expect(edges(page).locator('.loupe')).toBeHidden()
})

test('a receipt too narrow to read asks first, and «Keep it» takes it all the same', async ({
  page,
}) => {
  // 400 px of paper on a frame of 2 400: under the 600 of a till's grid
  await shoot(page, 400)
  await edges(page).getByRole('button', { name: 'Done' }).click()
  await expect(edges(page)).toContainText('The receipt is small')
  await expect(edges(page).getByRole('button', { name: 'Move closer' })).toBeVisible()
  await edges(page).getByRole('button', { name: 'Keep it' }).click()
  await expect(edges(page)).toHaveCount(0)
  await expect(capturing(page)).toContainText('Part 1')
})

test('«‹» gives the shot up: no part, the capture sheet as it was', async ({ page }) => {
  await shoot(page)
  await edges(page).getByRole('button', { name: 'Back' }).click()
  await expect(edges(page)).toHaveCount(0)
  await expect(capturing(page)).toContainText('Smooth the receipt out')
  await expect(capturing(page).getByRole('button', { name: 'Send receipt' })).toHaveCount(0)
})

/** One finger through Chromium's own touch input: down at `from`, slowly to `to`, up. */
async function pull(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page)
  const point = (x: number, y: number) => [{ x, y, id: 1 }]
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: point(from.x, from.y),
  })
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: point(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12),
    })
    await page.waitForTimeout(16)
  }
  await page.waitForTimeout(300)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

// adversarial А3: the photo is the step's to drag on — a pull down from the outline, between two
// corners, never takes the sheet and the shot with it
test('a pull down from the photo between the corners keeps the step and its shot', async ({
  page,
}) => {
  await shoot(page)
  const right = await edges(page).locator('.handle').nth(2).boundingBox()
  const left = await edges(page).locator('.handle').nth(3).boundingBox()
  if (!right || !left) throw new Error('no corners')
  const from = {
    x: (left.x + right.x) / 2 + left.width / 2,
    y: (left.y + right.y) / 2 + left.height / 2,
  }
  await pull(page, from, { x: from.x, y: from.y + 260 })
  await expect(edges(page)).toBeVisible()
  await edges(page).getByRole('button', { name: 'Done' }).click()
  await expect(capturing(page)).toContainText('Part 1')
})

// adversarial А2: under the 200 px the server takes, «Keep it» is still a part — paper added to its
// sides, never «didn't open as a photo»
test('«Keep it» on a receipt narrower than the server takes still makes a part', async ({
  page,
}) => {
  await shoot(page, 150)
  await edges(page).getByRole('button', { name: 'Done' }).click()
  await expect(edges(page)).toContainText('The receipt is small')
  await edges(page).getByRole('button', { name: 'Keep it' }).click()
  await expect(edges(page)).toHaveCount(0)
  await expect(capturing(page)).toContainText('Part 1')
  await expect(capturing(page)).not.toContainText('didn’t open as a photo')
})

// Р-10: the step is opened by the file's `change`, not by a tap — the system's «back» still takes
// the step alone, never the capture sheet under it
test('the system’s «back» gives the shot up and leaves the capture sheet', async ({ page }) => {
  await shoot(page)
  await page.goBack()
  await expect(edges(page)).toHaveCount(0)
  await expect(capturing(page)).toContainText('Smooth the receipt out')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Purchases')
})
