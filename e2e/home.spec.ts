import process from 'node:process'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Everything the screen's live region says, in order: the region speaks in turns — «Loading…»,
 * then the identity notice, then the state — so its text at one moment proves little.
 */
async function recordLiveRegion(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __said: string[] }
    w.__said = []
    new MutationObserver((records) => {
      for (const record of records) {
        const node = record.target instanceof Element ? record.target : record.target.parentElement
        const region = node?.closest('[role="status"]')
        if (region?.textContent) w.__said.push(region.textContent)
      }
    }).observe(document, { subtree: true, childList: true, characterData: true })
  })
  return () => page.evaluate(() => (window as unknown as { __said: string[] }).__said)
}

test('reaches the API and reports the version it answered with', async ({ page }) => {
  await page.goto('/advice')

  await expect(page.getByRole('heading', { name: 'What to buy' })).toBeVisible()
  await expect(page.getByText(/Server is up, version/)).toBeVisible()
})

// Offline is covered by the component test, which can pretend navigator.onLine is false.
// Here the point is the real round trip: a screen must never sit empty when the API is down.
test('reports a failure instead of an empty screen, and recovers on retry', async ({ page }) => {
  await page.route('**/api/health', (route) => route.abort())
  await page.goto('/advice')

  await expect(page.getByText('The server did not answer')).toBeVisible()

  await page.unroute('**/api/health')
  await page.getByRole('button', { name: 'Try again' }).click()

  await expect(page.getByText(/Server is up, version/)).toBeVisible()
})

test('the primary action is large enough to hit with a thumb', async ({ page }) => {
  await page.goto('/advice')

  const button = page.getByRole('button').first()
  await expect(button).toBeVisible()

  const box = await button.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})

// Loading is drawn as the content that is coming, and says so to a screen reader. The answer
// is held back rather than slowed down, so the check does not race a fast local API.
test('shows the skeleton while the answer is on its way', async ({ page }) => {
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/health', async (route) => {
    await held
    await route.continue()
  })
  const said = await recordLiveRegion(page)
  await page.goto('/advice')

  await expect(page.locator('.skeleton')).toBeVisible()
  await expect.poll(said).toContainEqual(expect.stringContaining('Loading…'))

  release()
  await expect(page.getByText(/Server is up, version/)).toBeVisible()
  await expect(page.locator('.skeleton')).toHaveCount(0)
})

test('the skeleton breathes, and stops for someone who asked for less motion', async ({ page }) => {
  await page.route('**/api/health', () => new Promise(() => undefined))
  const bars = page.locator('.skeleton .bars')
  const animation = () => bars.evaluate((element) => getComputedStyle(element).animationName)

  await page.goto('/advice')
  expect(await animation()).not.toBe('none')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await animation()).toBe('none')
})

// The commonest break at a shelf: the connection goes while the answer is on its way. It is
// offline, yellow and polite — not the red error the first cut of MOL-19 drew (A1).
test('a connection lost mid-request is offline, not an error', async ({ page, context }) => {
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/health', async (route) => {
    await held
    await route.abort('internetdisconnected')
  })
  await page.goto('/advice')
  await expect(page.locator('.skeleton')).toBeVisible()

  await context.setOffline(true)
  release()

  await expect(page.getByRole('heading', { name: 'No connection' })).toBeVisible()
  await expect(page.getByText('The server did not answer')).toHaveCount(0)
  await expect(page.locator('[role="alert"]').filter({ hasText: 'No connection' })).toHaveCount(0)
})

// Offline, one screen carries one «Try again» at most, and none here: the identity and the
// screen both come back by themselves when the connection does (A4, Р-1).
test('offline, nothing offers a second «Try again», and the screen comes back with the connection', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __online: boolean }
    w.__online = false
    Object.defineProperty(Navigator.prototype, 'onLine', { get: () => w.__online })
  })
  await page.goto(`/advice?c=${process.env.SIGNUP_CODE ?? ''}`)

  // One «No connection», the screen's: the identity notice names its own trouble (B3).
  await expect(page.getByRole('heading', { name: 'No connection' })).toHaveCount(1)
  await expect(
    page.getByRole('heading', { name: "This device isn't identified yet" }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)

  await page.evaluate(() => {
    ;(window as unknown as { __online: boolean }).__online = true
    window.dispatchEvent(new Event('online'))
  })
  await expect(page.getByText(/Server is up, version/)).toBeVisible()
})

// The screen's live region is there before its words: a region born with its words is often
// not read — VoiceOver on iOS skips it (MOL-19, П-2). The states hand their words over after.
test('the screen speaks through a live region that was there first', async ({ page }) => {
  const said = await recordLiveRegion(page)
  await page.route('**/api/health', (route) => route.abort())
  await page.goto(`/advice?c=${process.env.SIGNUP_CODE ?? ''}`)
  await expect(page.getByText('The server did not answer')).toBeVisible()

  expect(await said()).toContainEqual(expect.stringContaining('Loading…'))
  // The error interrupts on its own, as an alert, and is not said twice through the region.
  await expect(page.locator('[role="alert"]')).toHaveText(/The server did not answer/)
  expect(await said()).not.toContainEqual(expect.stringContaining('The server did not answer'))
})
