import { expect, test } from '@playwright/test'

test('reaches the API and reports the version it answered with', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'What to buy' })).toBeVisible()
  await expect(page.getByText(/Server is up, version/)).toBeVisible()
})

// Offline is covered by the component test, which can pretend navigator.onLine is false.
// Here the point is the real round trip: a screen must never sit empty when the API is down.
test('reports a failure instead of an empty screen, and recovers on retry', async ({ page }) => {
  await page.route('**/api/health', (route) => route.abort())
  await page.goto('/')

  await expect(page.getByText('The server did not answer')).toBeVisible()

  await page.unroute('**/api/health')
  await page.getByRole('button', { name: 'Try again' }).click()

  await expect(page.getByText(/Server is up, version/)).toBeVisible()
})

test('the primary action is large enough to hit with a thumb', async ({ page }) => {
  await page.goto('/')

  const button = page.getByRole('button').first()
  await expect(button).toBeVisible()

  const box = await button.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})
