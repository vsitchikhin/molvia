import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { ffOff, open } from './session'

// The «фф» reach the phone through the dev server's proxy, as through Caddy (MOL-382): the run's API has
// every one on, and `ffOff` is how a feature's spec sees its «off».

function kept(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem('molvia.ff'))
}

test('the phone hears every фф the API has on, and keeps them on the device', async ({ page }) => {
  await open(page)
  await expect.poll(() => kept(page)).toBe('venues,payments')
})

test('ffOff takes the named фф off the answers the phone hears', async ({ page }) => {
  await ffOff(page, ['venues'])
  await open(page)
  await expect.poll(() => kept(page)).toBe('payments')
})

// A spec holds an answer back and lets it go on — `route.continue()`, laid after `ffOff` — as fourteen
// do: the answer skips every route laid before, and the phone must still hear the feature off
// (adversarial А4).
test('ffOff holds past a route that lets an answer go on', async ({ page }) => {
  await page.addInitScript(() => {
    const heard: string[] = []
    ;(window as unknown as { heardFf: string[] }).heardFf = heard
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called below with the storage it is written to
    const set = Storage.prototype.setItem
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'molvia.ff') heard.push(value)
      set.call(this, key, value)
    }
  })
  await ffOff(page, ['venues'])
  await page.route('**/api/actors/me', (route) => route.continue())
  await open(page)
  await expect.poll(() => kept(page)).toBe('payments')
  // every list the phone wrote, not only the last: one answer with the feature on is a screen showing it
  const heard = await page.evaluate(() => (window as unknown as { heardFf: string[] }).heardFf)
  expect(heard).not.toContain('venues,payments')
})
