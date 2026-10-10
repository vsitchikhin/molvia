/// <reference lib="dom" />
// DOM for the code inside evaluate, which runs in the browser.
import { expect, test } from '@playwright/test'
import { open } from './session'

/**
 * The charts of the kit in a real engine (MOL-186): what a component test cannot see, since happy-dom
 * computes no style and has no native range. Run in the phone's Chromium and the iPhone's WebKit — the
 * acceptance asked for both (review Р1-2, adversarial А3), and a screen with data comes in signed out
 * on WebKit (e2e.md), so the kit holds the components the screen draws.
 */

// Chosen is a fill and a ring at the weight of every row (Ф-5): at 700 the row grew under the thumb.
// Its dot stands on a ring of the card's colour: on the tint ten light categories fell under 3:1
// (review Р1-3, adversarial А2).
test('a chosen legend row keeps its width, and its dot stands on a ring of the card', async ({
  page,
}) => {
  await open(page, '/_kit')
  const where = page.getByRole('region', { name: 'Where it went' })
  const row = where.locator('.legend .row', { hasText: 'Cafés and restaurants' })
  const amount = row.locator('.amount')
  const unchosen = (await amount.boundingBox())?.width
  await row.click()
  await expect(where.getByRole('radio', { name: /Cafés and restaurants/ })).toBeChecked()
  await expect(row).toHaveClass(/chosen/)
  expect((await amount.boundingBox())?.width).toBe(unchosen)

  const ring = await row.locator('.dot').evaluate((dot) => {
    const card = dot.closest('.card')
    return {
      shadow: getComputedStyle(dot).boxShadow,
      surface: card ? getComputedStyle(card).backgroundColor : '',
    }
  })
  expect(ring.shadow).toContain(ring.surface)
  expect(ring.shadow).toMatch(/0px 0px 0px 2px/)
})

// The slider of «Темп» in sight (С-14): its strip is the target, 44 high and as wide as the axis, and
// chooses as the chart does (owner's «в» on review Р2-1) — a mouse on press; the thumb drags on its own,
// and the keys move the day. The range itself takes no press (owner's «а» on review Р1-1).
test('the slider of «Темп» is in sight: its strip chooses the day, the thumb drags, the keys move it', async ({
  page,
}) => {
  await open(page, '/_kit')
  const slider = page.getByRole('slider', { name: 'Month pace' })
  const strip = page.locator('.track', { has: slider })
  await strip.scrollIntoViewIfNeeded()
  await expect(slider).toBeVisible()
  const box = await strip.boundingBox()
  if (!box) throw new Error('no strip')
  expect(box.height).toBeGreaterThanOrEqual(44)
  const reading = page.getByText(/^By September \d+$/)
  await expect(reading).toHaveText('By September 2')

  // A quarter of the way along — the 8th of a month of thirty, as on the axis above.
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2)
  await expect(reading).toHaveText('By September 8')
  // Past the last day drawn — the 12th — the 12th.
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2)
  await expect(reading).toHaveText('By September 12')

  // The thumb, on the 12th, dragged left: the range's own drag, which the strip leaves alone.
  const centre = box.x + 8 + ((box.width - 16) * 11) / 29
  await page.mouse.move(centre, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(centre - 60, box.y + box.height / 2, { steps: 6 })
  await page.mouse.up()
  expect(Number(await slider.inputValue())).toBeLessThan(11)

  await slider.focus()
  await page.keyboard.press('Home')
  await expect(reading).toHaveText('By September 1')
  await page.keyboard.press('ArrowRight')
  await expect(reading).toHaveText('By September 2')
  await page.keyboard.press('End')
  await expect(reading).toHaveText('By September 12')
  await expect(slider).toHaveValue('11')
})

// A finger lifted where it touched the strip chooses the day under it, as on the chart (Р2-1). CDP is
// Chromium's alone (e2e.md); WebKit is held by the press above.
test('a finger lifted on the strip of «Темп» chooses the day under it', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'touches through CDP are Chromium’s alone')
  await open(page, '/_kit')
  const slider = page.getByRole('slider', { name: 'Month pace' })
  const strip = page.locator('.track', { has: slider })
  await strip.scrollIntoViewIfNeeded()
  const box = await strip.boundingBox()
  if (!box) throw new Error('no strip')
  const cdp = await page.context().newCDPSession(page)
  const at = { x: box.x + box.width * 0.25, y: box.y + box.height / 2 }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.getByText(/^By September \d+$/)).toHaveText('By September 8')
})

// The touch a thumb makes when it scrolls the page from the slider's strip (review Р1-1): Blink set the
// day where the finger landed, and the scroll moved the day from the 2nd to the 23rd; the strip, as the
// chart, lets a scroll be a scroll (Р2-1). CDP is Chromium's alone (e2e.md).
test('a scroll that starts on the strip of «Темп» leaves the day where it was', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'touches through CDP are Chromium’s alone')
  await open(page, '/_kit')
  const slider = page.getByRole('slider', { name: 'Month pace' })
  await slider.scrollIntoViewIfNeeded()
  const box = await slider.boundingBox()
  if (!box) throw new Error('no slider')
  const before = await page.evaluate(() => window.scrollY)
  const cdp = await page.context().newCDPSession(page)
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    })
  const x = box.x + box.width * 0.75
  const y = box.y + box.height / 2
  await touch('touchStart', x, y)
  for (let step = 1; step <= 10; step++) await touch('touchMove', x + 1, y - step * 20)
  await touch('touchEnd')

  // Control: the page did scroll — the touch was a scroll, not a press held still.
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before)
  await expect(slider).toHaveValue('1')
  await expect(page.getByText(/^By September \d+$/)).toHaveText('By September 2')
})
