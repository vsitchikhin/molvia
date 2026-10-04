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
// ring now, the fill between them, both on the row's rounded layer.
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
    const layer = getComputedStyle(row, '::before')
    const ring = /(-?[\d.]+)px inset|inset[^,]*?(-?[\d.]+)px\s*$/.exec(layer.boxShadow)
    return {
      visible: row.matches(':focus-visible'),
      own: getComputedStyle(row).outlineStyle,
      outline: layer.outlineStyle,
      offset: parseFloat(layer.outlineOffset),
      ring: parseFloat(ring?.[1] ?? ring?.[2] ?? 'NaN'),
    }
  })
  expect(look.visible).toBe(true)
  expect(look.own).toBe('none')
  expect(look.outline).toBe('solid')
  expect(look.ring).toBe(2)
  // The outline's outer edge lies `-offset` inside the layer; the ring takes the first 2 px of it.
  expect(-look.offset - look.ring).toBeGreaterThanOrEqual(2)
})

// Rounded itself, a chosen row bent the hairline the list card draws as its `border-top` (round 3,
// Р3-1; adversarial Б1): the row stays square, its fill and ring are a rounded layer.
test('a chosen row keeps the card’s hairline above it straight', async ({ page }) => {
  await open(page, '/_kit')
  const picker = page.getByRole('radiogroup', { name: 'Purchases account' })
  const second = picker.getByRole('radio').nth(1)
  await second.tap()
  await expect(second).toHaveAttribute('aria-checked', 'true')
  const edge = await second.evaluate((row) => {
    const style = getComputedStyle(row)
    return {
      hairline: style.borderTopWidth,
      left: style.borderTopLeftRadius,
      right: style.borderTopRightRadius,
      layer: getComputedStyle(row, '::before').borderTopLeftRadius,
    }
  })
  expect(edge).toMatchObject({ hairline: '1px', left: '0px', right: '0px' })
  expect(edge.layer).not.toBe('0px')
})

// The keyboard standing on the value already chosen: the row's own square fill stood out past the round
// ring at every corner (adversarial В1). The kit shows the two states apart, so the found row the
// keyboard stands on is made chosen here, by the class the row draws it with.
test('a chosen row the keyboard stands on takes its fill from its round layer alone', async ({
  page,
}) => {
  await open(page, '/_kit')
  const active = page.getByRole('listbox', { name: 'Found' }).getByRole('option').first()
  await expect(active).toHaveClass(/\bactive\b/)
  const fills = await active.evaluate(async (row) => {
    const read = () => getComputedStyle(row).backgroundColor
    const alone = read()
    row.classList.add('selected')
    await new Promise((done) => requestAnimationFrame(done))
    return { alone, chosen: read(), layer: getComputedStyle(row, '::before').backgroundColor }
  })
  expect(fills.alone).not.toBe('rgba(0, 0, 0, 0)')
  expect(fills.chosen).toBe('rgba(0, 0, 0, 0)')
  expect(fills.layer).toBe(fills.alone)
})
