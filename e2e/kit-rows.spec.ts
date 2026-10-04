/// <reference lib="dom" />
// DOM for the code inside page.evaluate, which runs in the browser.
import { expect, test } from '@playwright/test'
import { open } from './session'

/**
 * The kit's rows in a real engine (MOL-175): what a component test cannot see, since happy-dom
 * computes no style. Run in the phone's Chromium and in the iPhone's WebKit.
 */

// The focus of a chosen row stood on its ring — 2 px of the same colour on the same place — and the
// keyboard lost the row it stood on (adversarial А1, review Р2-1, WCAG 2.4.7). It stands inside the
// ring now, the fill between them.
test('a chosen row shows the keyboard’s focus inside its ring, with the fill between', async ({
  page,
}) => {
  await open(page, '/_kit')
  const picker = page.getByRole('radiogroup', { name: 'Purchases account' })
  const chosen = picker.getByRole('radio', { checked: true })
  // A key first, so the engine takes the focus that follows for the keyboard's (WebKit tabs fields only).
  await page.keyboard.press('Tab')
  await chosen.focus()
  const look = await chosen.evaluate((row) => {
    const style = getComputedStyle(row)
    const ring = /(-?[\d.]+)px inset|inset[^,]*?(-?[\d.]+)px\s*$/.exec(style.boxShadow)
    return {
      visible: row.matches(':focus-visible'),
      outline: style.outlineStyle,
      offset: parseFloat(style.outlineOffset),
      ring: parseFloat(ring?.[1] ?? ring?.[2] ?? 'NaN'),
    }
  })
  expect(look.visible).toBe(true)
  expect(look.outline).toBe('solid')
  expect(look.ring).toBe(2)
  // The outline's outer edge lies `-offset` inside the row; the ring takes the first 2 px of it.
  expect(-look.offset - look.ring).toBeGreaterThanOrEqual(2)
})
