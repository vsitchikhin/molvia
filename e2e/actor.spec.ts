import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * The identity through a real browser: storage that survives a reload, and a header on the
 * requests that follow. Neither can be proved with a mocked fetch — the component test
 * pretends the storage, and this one has the browser's own.
 */
const KEY = 'molvia.actor'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function storedIdentity(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), KEY)
}

test('keeps the identity across a reload and carries it in the header', async ({ page }) => {
  const sent: string[] = []
  page.on('request', (request) => {
    const header = request.headers()['x-molvia-actor']
    if (header) sent.push(header)
  })

  await page.goto('/')

  // The first visit happens after the first paint, so the identity appears a moment later.
  await expect.poll(() => storedIdentity(page)).toMatch(UUID)
  const id = await storedIdentity(page)

  await page.reload()

  expect(await storedIdentity(page)).toBe(id)
  // The reload asked the API who it is, and did so as the same person: without this the
  // identity would be stored and never used, which no unit test would notice.
  await expect.poll(() => sent).toContain(id)
})

/**
 * Everything the app's live region says, in order: each announcement is a node of its own, and
 * an added node is what a screen reader reads — so the region's text at one moment proves
 * little, and its additions are what is recorded.
 */
async function recordLiveRegion(page: Page): Promise<() => Promise<string[]>> {
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

// The identity's error is polite, so the region is its only way to a screen reader. «Try again»
// failing the same way must be heard again, not swallowed as «no change» (MOL-19, C1).
test('the same answer after «Try again» is said again', async ({ page }) => {
  const said = await recordLiveRegion(page)
  await page.route('**/api/dev/actors**', (route) => route.fulfill({ status: 500, body: '{}' }))
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'This device could not be identified' }),
  ).toBeVisible()
  await expect
    .poll(async () => (await said()).filter((text) => text.includes('could not be identified')))
    .toHaveLength(1)

  await page.getByRole('button', { name: 'Try again' }).click()
  await expect
    .poll(async () => (await said()).filter((text) => text.includes('could not be identified')))
    .toHaveLength(2)
})
