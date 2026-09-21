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
