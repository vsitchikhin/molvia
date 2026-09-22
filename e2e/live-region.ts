import type { Page } from '@playwright/test'

/**
 * Everything the app's live region says, in order: each announcement is a node of its own, and
 * an added node is what a screen reader reads — so the region's text at one moment proves
 * little, and its additions are what is recorded.
 *
 * Shared by the specs that need it rather than copied into each: the two copies this module
 * replaces were added in one commit, knowing that the next change would have to find both
 * (MOL-32, МР-10). A spec that only needs one of these imports the one.
 */
export async function recordLiveRegion(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __said: string[] }
    w.__said = []
    new MutationObserver((records) => {
      for (const record of records) {
        if (!(record.target instanceof Element) || !record.target.matches('[role="status"]'))
          continue
        for (const node of record.addedNodes) {
          if (node.textContent) w.__said.push(node.textContent)
        }
      }
    }).observe(document, { subtree: true, childList: true })
  })
  return () => page.evaluate(() => (window as unknown as { __said: string[] }).__said)
}

/** What the app's live region holds now — what browse mode would still find in it. */
export async function liveRegion(page: Page): Promise<string> {
  return (await page.locator('.announcer').textContent()) ?? ''
}
