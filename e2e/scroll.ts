import { expect } from '@playwright/test'
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

/**
 * Scrolls the page so that the top of the element stands this far below the top of the window — once
 * the faces have come, so that what is measured after is the page that stays.
 */
export async function standAt(element: Locator, below: number): Promise<void> {
  await facesIn(element.page())
  await element.evaluate((node, offset) => {
    window.scrollBy({ top: node.getBoundingClientRect().top - offset, behavior: 'instant' })
  }, below)
}

/** Scrolls to the very end of the page, once the faces have come, and says how far that is. */
export async function toTheEnd(page: Page): Promise<number> {
  await facesIn(page)
  await page.evaluate(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
  })
  const scrolled = await page.evaluate(() => window.scrollY)
  expect(scrolled).toBeGreaterThan(0)
  return scrolled
}

export async function topOf(element: Locator): Promise<number> {
  return element.evaluate((node) => Math.round(node.getBoundingClientRect().top))
}
