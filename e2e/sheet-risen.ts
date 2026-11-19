import type { Page } from '@playwright/test'

/**
 * Until it has risen a sheet takes no tap at all (MOL-69): the top open sheet's rise, then the double-tap floor. One
 * copy for every spec that taps inside a sheet just opened (MOL-276, review №7).
 */
export async function risen(page: Page): Promise<void> {
  await page
    .locator('dialog[open]')
    .last()
    .evaluate((dialog) =>
      Promise.allSettled(dialog.getAnimations().map((animation) => animation.finished)),
    )
  await page.waitForTimeout(350)
}
