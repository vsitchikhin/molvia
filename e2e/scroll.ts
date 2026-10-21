import type { Locator, Page } from '@playwright/test'

/**
 * Where a control stands on the screen, which is what the eye and the thumb find — «the page stayed»
 * is taken by it, not by `scrollY` alone (MOL-63, MOL-136).
 */

/**
 * Waits for every face the page has asked for (MOL-63, MOL-267). A face is fetched when a glyph of its
 * range is first laid out — Onest 700 and ֏ come with an answer — and arriving after a measure it
 * rewraps lines and moves what was measured. The page is laid out first: until then nothing is asked
 * for, and `ready` is already resolved.
 */
export async function facesIn(page: Page): Promise<void> {
  await page.evaluate(async () => {
    document.documentElement.getBoundingClientRect()
    await document.fonts.ready
  })
}

/** Scrolls the page so that the top of the element stands this far below the top of the window. */
export async function standAt(element: Locator, below: number): Promise<void> {
  await element.evaluate((node, offset) => {
    window.scrollBy({ top: node.getBoundingClientRect().top - offset, behavior: 'instant' })
  }, below)
}

export async function topOf(element: Locator): Promise<number> {
  return element.evaluate((node) => Math.round(node.getBoundingClientRect().top))
}
