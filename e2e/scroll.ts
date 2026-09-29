import type { Locator } from '@playwright/test'

/**
 * Where a control stands on the screen, which is what the eye and the thumb find — «the page stayed»
 * is taken by it, not by `scrollY` alone (MOL-63, MOL-136).
 */

/** Scrolls the page so that the top of the element stands this far below the top of the window. */
export async function standAt(element: Locator, below: number): Promise<void> {
  await element.evaluate((node, offset) => {
    window.scrollBy({ top: node.getBoundingClientRect().top - offset, behavior: 'instant' })
  }, below)
}

export async function topOf(element: Locator): Promise<number> {
  return element.evaluate((node) => Math.round(node.getBoundingClientRect().top))
}
