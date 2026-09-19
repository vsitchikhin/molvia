import { expect, test } from '@playwright/test'

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
  await page.goto('/advice')

  await expect(page.getByRole('status').filter({ hasText: 'Loading…' })).toBeAttached()
  await expect(page.locator('[aria-busy="true"]')).toBeVisible()

  release()
  await expect(page.getByText(/Server is up, version/)).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
})

test('the skeleton breathes, and stops for someone who asked for less motion', async ({ page }) => {
  await page.route('**/api/health', () => new Promise(() => undefined))
  const bars = page.locator('[aria-busy="true"] [aria-hidden="true"]').first()
  const animation = () => bars.evaluate((element) => getComputedStyle(element).animationName)

  await page.goto('/advice')
  expect(await animation()).not.toBe('none')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await animation()).toBe('none')
})
