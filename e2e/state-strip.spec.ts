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

/**
 * A block of a sheet that goes with the focus on its button hands it to the sheet's own title (MOL-317):
 * the page under a modal sheet is inert, the screen's title took no focus, and it fell to the body —
 * the next Tab started the sheet over and a screen reader lost its place. Pressed by the keyboard: Safari
 * focuses no tapped button, and a focus never on the button would prove nothing here.
 */
test.describe('a block of a sheet that goes with the focus', () => {
  async function statesSheet(page: Page): Promise<Locator> {
    await open(page, '/_kit')
    await page.getByRole('button', { name: 'Open a sheet of states' }).click()
    const sheet = page.getByRole('dialog', { name: 'States in a sheet' })
    await expect(sheet).toBeVisible()
    // Until it has risen a sheet takes no press at all (MOL-69): its rise, then the double tap's floor.
    await sheet.evaluate(async (dialog) => {
      await Promise.allSettled(dialog.getAnimations().map((animation) => animation.finished))
    })
    await page.waitForTimeout(400)
    return sheet
  }

  async function pressAndExpectTitle(page: Page, sheet: Locator, retry: Locator): Promise<void> {
    await retry.focus()
    await expect(retry).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(retry).toHaveCount(0)
    const title = sheet.getByRole('heading', { name: 'States in a sheet' })
    await expect(title).toBeFocused()
    // The next Tab goes on from the title — to × — and the title is text again. Not in WebKit, whose
    // Tab reaches fields only, and the sheet has none: the focus left the title is held by a script.
    if (test.info().project.name === 'iphone') {
      await sheet.getByRole('button', { name: 'Close' }).focus()
    } else {
      await page.keyboard.press('Tab')
      await expect(sheet.getByRole('button', { name: 'Close' })).toBeFocused()
    }
    await expect(title).not.toHaveAttribute('tabindex')
  }

  test('the quiet card’s «Try again»', async ({ page }) => {
    const sheet = await statesSheet(page)
    const card = sheet.locator('.state.card', { hasText: 'The server did not answer' })
    await pressAndExpectTitle(page, sheet, card.getByRole('button', { name: 'Try again' }))
  })

  test('a full error’s «Try again» in the footer', async ({ page }) => {
    const sheet = await statesSheet(page)
    const retry = sheet.locator('.footer').getByRole('button', { name: 'Try again' })
    await expect(retry).toBeVisible()
    await pressAndExpectTitle(page, sheet, retry)
  })

  // The window put away — another app, the notification shade — blurs the focused title and moves no
  // focus: its `tabindex` taken off then, the engine handed the focus to <body> (adversarial А1). A real
  // loss of the window does not happen headless, so the event is the window's own, sent by hand.
  test('a blur that moves no focus leaves it on the title', async ({ page }) => {
    const sheet = await statesSheet(page)
    const retry = sheet
      .locator('.state.card', { hasText: 'The server did not answer' })
      .getByRole('button', { name: 'Try again' })
    await retry.focus()
    await page.keyboard.press('Enter')
    const title = sheet.getByRole('heading', { name: 'States in a sheet' })
    await expect(title).toBeFocused()

    await title.evaluate((element) => element.dispatchEvent(new FocusEvent('blur')))
    await page.waitForTimeout(100)
    await expect(title).toBeFocused()
    await expect(title).toHaveAttribute('tabindex', '-1')
  })

  test('the strip’s «Try again», the strip staying offline', async ({ page }) => {
    const sheet = await statesSheet(page)
    const strip = sheet.locator('.strip')
    await pressAndExpectTitle(page, sheet, strip.getByRole('button', { name: 'Try again' }))
    await expect(strip).toHaveClass(/\boffline\b/)
  })
})
