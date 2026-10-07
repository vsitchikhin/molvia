/// <reference lib="dom" />
// DOM for the code inside page.evaluate, which runs in the browser.
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { open } from './session'

/**
 * The buttons of an error of the whole screen stand in the screen's strip, carried there by a
 * `Teleport`, and come back into the block when it turns a section's (MOL-180, К-1, Ф-15). Moving a
 * node is where engines part ways — a focus moved with `insertBefore` falls to the body
 * (adversarial А2) — so this runs in the phone's Chromium and the iPhone's WebKit, on the kit: a
 * screen with data would come in signed out on WebKit (`e2e.md`).
 */

async function states(page: Page): Promise<Locator> {
  await open(page, '/_kit')
  const found = page.locator('section', { has: page.getByRole('heading', { name: 'States' }) })
  await expect(found).toBeVisible()
  return found
}

/** A switch flipped without moving the focus — `click()` from the page, as a script would. */
async function flip(section: Locator, name: string): Promise<void> {
  await section.getByRole('switch', { name }).evaluate((input) => {
    ;(input as HTMLElement).click()
  })
}

const focusedText = (page: Page): Promise<string> =>
  page.evaluate(() => document.activeElement?.textContent.trim() ?? '')

test('an error of the whole screen draws its «Try again» in the strip, and only there', async ({
  page,
}) => {
  const section = await states(page)
  await flip(section, 'An error of the screen')

  const dock = page.locator('.dock')
  await expect(dock.getByRole('button', { name: 'Try again' })).toBeVisible()
  // The kit keeps a section's error of its own beside it: this one is the switched, by its words.
  const error = section.locator('.state', { hasText: 'The list did not load' })
  await expect(error).toHaveClass(/\bbad\b/)
  await expect(error.getByRole('button')).toHaveCount(0)
  // The strip stands over the bottom edge, in the viewport, and the button in it takes a tap.
  await expect(dock.getByRole('button', { name: 'Try again' })).toBeInViewport()

  await dock.getByRole('button', { name: 'Try again' }).click()
  await expect(error).toHaveCount(0)
  await expect(page.locator('.dock')).toHaveCount(0)
})

test('the focus on «Try again» goes with it between the strip and the block', async ({ page }) => {
  const section = await states(page)
  await flip(section, 'An error of the screen')
  const inStrip = page.locator('.dock').getByRole('button', { name: 'Try again' })
  await inStrip.focus()
  expect(await focusedText(page)).toBe('Try again')

  await flip(section, 'As a section')
  const inCard = section
    .locator('.state.card', { hasText: 'The list did not load' })
    .getByRole('button', { name: 'Try again' })
  await expect(inCard).toBeFocused()
  await expect(page.locator('.dock')).toHaveCount(0)

  await flip(section, 'As a section')
  await expect(inStrip).toBeFocused()
})
