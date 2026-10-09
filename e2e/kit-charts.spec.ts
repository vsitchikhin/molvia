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

// The slider of «Темп» in sight (С-14): as tall as a thumb, moved by the keys, and only its thumb
// takes a press (owner's «а» on review Р1-1) — a press on the track chose the day under it.
test('the slider of «Темп» is in sight, the keys move it, a press on its track chooses nothing', async ({
  page,
}) => {
  await open(page, '/_kit')
  const slider = page.getByRole('slider', { name: 'Month pace' })
  await slider.scrollIntoViewIfNeeded()
  await expect(slider).toBeVisible()
  const box = await slider.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  const reading = page.getByText(/^By September \d+$/)
  await expect(reading).toHaveText('By September 2')

  // Far from the thumb, on the 20th of the track: nothing.
  if (!box) throw new Error('no slider')
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2)
  await expect(slider).toHaveValue('1')
  await expect(reading).toHaveText('By September 2')

  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await expect(reading).toHaveText('By September 3')
  // Past the last day drawn — the 12th of a month of thirty — the slider stays on the 12th.
  await page.keyboard.press('End')
  await expect(reading).toHaveText('By September 12')
  await expect(slider).toHaveValue('11')
})

// The touch a thumb makes when it scrolls the page from the slider's track (review Р1-1): Blink set the
// day where the finger landed, and the scroll moved the day from the 2nd to the 23rd. CDP is
// Chromium's alone (e2e.md); WebKit is held by the press above.
test('a scroll that starts on the track of «Темп» leaves the day where it was', async ({
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
