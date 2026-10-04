/// <reference lib="dom" />
// DOM for the code inside page.evaluate, which runs in the browser.
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { open } from './session'

/**
 * «Not now» of the kit in a real engine (MOL-174, Ф-6): `inactive` is `aria-disabled` and a cancelled
 * click, so what holds it is what the engine sends — a click for a radio's arrow, a click for Space
 * and for a tap on a label — and the component tests, which send their own events, cannot show it.
 * Run in the phone's Chromium and in the iPhone's WebKit (review 3).
 */

/** The kit's own section of chosen and inactive things. */
async function section(page: Page): Promise<Locator> {
  await open(page, '/_kit')
  const found = page.locator('section', {
    has: page.getByRole('heading', { name: 'Chosen and inactive' }),
  })
  await expect(found).toBeVisible()
  return found
}

/** Which radios of a group are checked, in order. */
const checked = (group: Locator): Promise<boolean[]> =>
  group
    .getByRole('radio')
    .evaluateAll((radios) => radios.map((radio) => (radio as HTMLInputElement).checked))

test('an inactive segmented control: the arrows walk every option, choosing none, and a tap moves nothing', async ({
  page,
}) => {
  const kit = await section(page)
  const group = kit.getByRole('group', { name: 'Unit · not now' })
  await expect(group.getByRole('radio', { name: 'l', exact: true })).toBeChecked()
  const before = await checked(group)

  // Every option is heard (adversarial А2): the focus goes round, the choice stays.
  await group.getByRole('radio', { name: 'l', exact: true }).focus()
  const reached = new Set<string>()
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft', 'ArrowDown']) {
    await page.keyboard.press(key)
    reached.add(await page.evaluate(() => (document.activeElement as HTMLInputElement).value))
  }
  expect([...reached].sort()).toEqual(['kg', 'l', 'piece'])
  expect(await checked(group)).toEqual(before)

  // A tap: Playwright itself counts the radio as disabled, so the tap is forced, as a finger would.
  await group.locator('label', { hasText: 'kg' }).click({ force: true })
  expect(await checked(group)).toEqual(before)

  // Control: the live group beside it answers.
  const live = kit.getByRole('group', { name: 'Unit · by the width of words' })
  await live.locator('label', { hasText: 'pc' }).click()
  await expect(live.getByRole('radio', { name: 'pc', exact: true })).toBeChecked()
})

test('an inactive switch takes the focus and holds against Space and a tap on its words', async ({
  page,
}) => {
  const kit = await section(page)
  const held = kit.getByRole('switch', { name: 'Not now · off' })
  await held.focus()
  await expect(held).toBeFocused()
  await expect(held).toBeDisabled()
  await page.keyboard.press('Space')
  await expect(held).not.toBeChecked()
  await kit.locator('label', { hasText: 'Not now · off' }).click({ force: true })
  await expect(held).not.toBeChecked()

  // Control: the live switch answers a tap on its words.
  await kit.locator('label', { hasText: /^\s*Off\s*$/ }).click()
  await expect(kit.getByRole('switch', { name: 'Off', exact: true })).toBeChecked()
})

// The phone profiles have no hover — `(hover: hover)` is false in both — so the pointer is a mouse
// here, in a context of its own, or the check would hold by the media query alone.
test('an inactive button takes the focus and does not light up under the pointer', async ({
  browser,
}, info) => {
  // The run's address, language and zone, and none of the phone's touch.
  const { baseURL = '', locale = 'en-US', timezoneId = 'Asia/Yerevan' } = info.project.use
  const context = await browser.newContext({
    baseURL,
    locale,
    timezoneId,
    hasTouch: false,
    isMobile: false,
  })
  const page = await context.newPage()
  expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(true)
  const kit = await section(page)
  const save = kit.getByRole('button', { name: 'Save', exact: true })
  const look = () =>
    save.evaluate((button) => {
      const style = getComputedStyle(button)
      return [style.backgroundColor, style.color, style.filter, style.opacity].join(' · ')
    })
  const rest = await look()
  await save.hover({ force: true })
  expect(await look()).toBe(rest)
  await save.focus()
  await expect(save).toBeFocused()
  await context.close()
})
