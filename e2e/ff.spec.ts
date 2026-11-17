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
