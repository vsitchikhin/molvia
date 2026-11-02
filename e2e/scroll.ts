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

/**
 * Waits until the elements and what is in them stand where they stay (MOL-355): «Вернуть» rises `--space-2` into
 * place by `appear` — 4 px low the frame `toBeVisible()` saw it, 7.3 at 80 ms, 8 at 210 — and stands on
 * `--dock-height`, which `useHeight` measures a frame behind the strip growing under it. So the finite animations of
 * each, then two frames for that measure; an endless animation, a breath, would hold it to the test's timeout
 * (MOL-306).
 */
export async function stillIn(...elements: Locator[]): Promise<void> {
  for (const element of elements)
    await element.evaluate((node) =>
      Promise.allSettled(
        node
          .getAnimations({ subtree: true })
          .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
          .map((animation) => animation.finished),
      ),
    )
  await elements[0]?.page().evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      }),
  )
}

export async function topOf(element: Locator): Promise<number> {
  return element.evaluate((node) => Math.round(node.getBoundingClientRect().top))
}
