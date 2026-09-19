/// <reference lib="dom" />
// DOM for the code inside page.evaluate, which runs in the browser.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * The sheet in a real browser and a real history — what the component tests cannot show: that
 * the platform's `<dialog>` traps focus and hands it back, that «back» closes the sheet and not
 * the screen, and that the page under it stays where it was scrolled (MOL-18). Driven on the
 * development-only kit page, before any screen uses the sheet.
 */

const opener = (page: Page) => page.getByRole('button', { name: 'Open the sheet' })
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Milk «Ashkhar»' })
const heading = (page: Page) => page.getByRole('heading', { level: 1 })

async function expectOn(page: Page, path: string, title: string): Promise<void> {
  await expect(page).toHaveURL(path)
  await expect(heading(page)).toHaveText(title)
}

async function historyLength(page: Page): Promise<number> {
  return page.evaluate(() => window.history.length)
}

async function scrollY(page: Page): Promise<number> {
  return page.evaluate(() => Math.round(window.scrollY))
}

/** Opens the kit scrolled down to the opener — the list above it is long on purpose. */
async function openSheet(page: Page): Promise<{ scrolled: number; length: number }> {
  await page.goto('/_kit')
  await expect(heading(page)).toHaveText('Kit')
  await opener(page).scrollIntoViewIfNeeded()
  const scrolled = await scrollY(page)
  expect(scrolled).toBeGreaterThan(200)
  const length = await historyLength(page)
  await opener(page).click()
  await expect(sheet(page)).toBeVisible()
  return { scrolled, length }
}

/** Closed, on the same screen, at the same scroll, with focus back on what opened it. */
async function expectPutAway(page: Page, scrolled: number): Promise<void> {
  await expect(sheet(page)).toBeHidden()
  await expect(page).toHaveURL('/_kit')
  await expect(heading(page)).toHaveText('Kit')
  await expect(opener(page)).toBeFocused()
  expect(await scrollY(page)).toBe(scrolled)
}

test.describe('the sheet', () => {
  test('opens with one entry in the history and the first field focused', async ({ page }) => {
    const { length } = await openSheet(page)
    expect(await historyLength(page)).toBe(length + 1)
    await expect(page).toHaveURL('/_kit')
    await expect(sheet(page).getByLabel('How much')).toBeFocused()
  })

  test('holds the page under it still', async ({ page }) => {
    await openSheet(page)
    const overflow = await page.evaluate(() => getComputedStyle(document.documentElement).overflow)
    expect(overflow).toBe('hidden')
  })

  test('Esc closes it and takes its entry away', async ({ page }) => {
    const { scrolled } = await openSheet(page)
    await page.keyboard.press('Escape')
    await expectPutAway(page, scrolled)
  })

  // The browser's «back» and the iOS edge swipe are a pop: the sheet goes, the screen stays.
  test('«back» closes the sheet, not the screen, and the list stays where it was', async ({
    page,
  }) => {
    const { scrolled } = await openSheet(page)
    await page.goBack()
    await expectPutAway(page, scrolled)
  })

  test('× closes it', async ({ page }) => {
    const { scrolled } = await openSheet(page)
    await sheet(page).getByRole('button', { name: 'Close' }).click()
    await expectPutAway(page, scrolled)
  })

  test('a tap on the scrim closes it', async ({ page }) => {
    const { scrolled } = await openSheet(page)
    await page.mouse.click(12, 12)
    await expectPutAway(page, scrolled)
  })

  test('a tap inside the sheet does not', async ({ page }) => {
    await openSheet(page)
    await sheet(page).getByRole('heading', { name: 'Milk «Ashkhar»' }).click()
    await expect(sheet(page)).toBeVisible()
  })

  test('its main action closes it through the same step', async ({ page }) => {
    const { scrolled } = await openSheet(page)
    await sheet(page).getByRole('button', { name: 'Add to the trip' }).click()
    await expectPutAway(page, scrolled)
  })

  // One entry laid, one taken: the «back» after a closed sheet leaves the screen for the trip
  // laid under it, instead of «closing» a sheet that is already gone.
  test('«back» after it closed leaves the screen', async ({ page }) => {
    await openSheet(page)
    await page.keyboard.press('Escape')
    await expect(sheet(page)).toBeHidden()
    await page.goBack()
    await expect(page).toHaveURL('/')
    await expect(heading(page)).toHaveText('Trip')
  })

  test('Tab keeps to the sheet', async ({ page }) => {
    await openSheet(page)
    for (let press = 0; press < 12; press += 1) {
      await page.keyboard.press('Tab')
      const inside = await page.evaluate(
        () =>
          document.activeElement === document.body ||
          document.activeElement?.closest('dialog') !== null,
      )
      expect(inside, `Tab ${String(press + 1)}`).toBe(true)
    }
  })

  // An entry is not an address: a reload on it opens no sheet and breaks nothing, and the start
  // steps off the entry no sheet holds — the first «back» leaves the screen, as without a sheet.
  test('a reload on its entry opens no sheet and breaks nothing', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await openSheet(page)
    await page.reload()
    await expect(heading(page)).toHaveText('Kit')
    await expect(sheet(page)).toBeHidden()

    await page.goBack()
    await expectOn(page, '/', 'Trip')
    expect(errors).toEqual([])
  })

  // An entry left from a reload carries the same flag; the close of a sheet opened again stepped
  // back onto it and took it for its own — the sheet stayed open (adversarial А-1, А-2).
  test('after a reload on its entry, a sheet opened again closes on the first ×', async ({
    page,
  }) => {
    await openSheet(page)
    await page.reload()
    await expect(heading(page)).toHaveText('Kit')
    await opener(page).scrollIntoViewIfNeeded()
    await opener(page).click()
    await expect(sheet(page)).toBeVisible()
    await sheet(page).getByRole('button', { name: 'Close' }).click()
    await expect(sheet(page)).toBeHidden()
  })

  test('after «forward» onto its old entry, a sheet opened again closes on the first Esc', async ({
    page,
  }) => {
    await openSheet(page)
    await page.keyboard.press('Escape')
    await expect(sheet(page)).toBeHidden()
    await page.goForward()
    await expect(page).toHaveURL('/_kit')
    await opener(page).click()
    await expect(sheet(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet(page)).toBeHidden()
  })

  // The dead entry is the screen's address twice; the rules of «back» read the screen under
  // itself, and the chevron replaced instead of stepping back (adversarial А-3).
  test('after a reload on its entry, the chevron and «back» keep the rules of MOL-17', async ({
    page,
  }) => {
    await openSheet(page)
    await page.reload()
    await expect(heading(page)).toHaveText('Kit')
    await page.getByRole('button', { name: 'Back Trip' }).click()
    await expectOn(page, '/', 'Trip')
    await page.goBack()
    await expect(page).not.toHaveURL(/_kit/)
  })

  // Left by a push with the sheet open: the entry stays behind, and «back» steps over it — one
  // «back» to the screen, one more off it, as without a sheet (adversarial А-4).
  test('a push away from an open sheet leaves no extra «back» behind', async ({ page }) => {
    await openSheet(page)
    await page.evaluate(async () => {
      const root = document.querySelector('#app') as unknown as {
        __vue_app__: {
          config: { globalProperties: { $router: { push: (to: string) => Promise<unknown> } } }
        }
      }
      await root.__vue_app__.config.globalProperties.$router.push('/verdicts')
    })
    await expect(page).toHaveURL('/verdicts')
    await page.goBack()
    await expectOn(page, '/_kit', 'Kit')
    await expect(sheet(page)).toBeHidden()
    await page.goBack()
    await expectOn(page, '/', 'Trip')
  })
})
