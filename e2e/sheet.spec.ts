/// <reference lib="dom" />
// DOM for the code inside page.evaluate, which runs in the browser.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * The sheet in a real browser and a real history — what the component tests cannot show: that
 * the platform's `<dialog>` traps focus and hands it back, that «back» closes the sheet and not
 * the screen, and that the page under it stays where it was scrolled (MOL-18). Driven on the
 * development-only kit page, before any screen uses the sheet.
 */

const opener = (page: Page) => page.getByRole('button', { name: 'Open the sheet' })
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Milk «Ashkhar»' })
const heading = (page: Page) => page.getByRole('heading', { level: 1 })

async function expectOn(page: Page, path: string, title: string): Promise<void> {
  await expect(page).toHaveURL(path)
  await expect(heading(page)).toHaveText(title)
}

async function historyLength(page: Page): Promise<number> {
  return page.evaluate(() => window.history.length)
}

async function scrollY(page: Page): Promise<number> {
  return page.evaluate(() => Math.round(window.scrollY))
}

/** Opens the kit scrolled down to the opener — the list above it is long on purpose. */
async function openSheet(page: Page): Promise<{ scrolled: number; length: number }> {
  await page.goto('/_kit')
  await expect(heading(page)).toHaveText('Kit')
  await opener(page).scrollIntoViewIfNeeded()
  const scrolled = await scrollY(page)
  expect(scrolled).toBeGreaterThan(200)
  const length = await historyLength(page)
  await opener(page).click()
  await expect(sheet(page)).toBeVisible()
  // Until it has come up the sheet takes no tap — the second of a double tap (Б-5).
  await page.waitForTimeout(400)
  return { scrolled, length }
}

/** Closed, on the same screen, at the same scroll, with focus back on what opened it. */
async function expectPutAway(page: Page, scrolled: number): Promise<void> {
  await expect(sheet(page)).toBeHidden()
  await expect(page).toHaveURL('/_kit')
  await expect(heading(page)).toHaveText('Kit')
  await expect(opener(page)).toBeFocused()
  expect(await scrollY(page)).toBe(scrolled)
}

test.describe('the sheet', () => {
  test('opens with one entry in the history and the first field focused', async ({ page }) => {
    const { length } = await openSheet(page)
    expect(await historyLength(page)).toBe(length + 1)
    await expect(page).toHaveURL('/_kit')
    await expect(sheet(page).getByLabel('How much')).toBeFocused()
  })

  test('holds the page under it still', async ({ page }) => {
    await openSheet(page)
    const overflow = await page.evaluate(() => getComputedStyle(document.documentElement).overflow)
    expect(overflow).toBe('hidden')
  })

  test('Esc closes it and takes its entry away', async ({ page }) => {
    const { scrolled } = await openSheet(page)
    await page.keyboard.press('Escape')
    await expectPutAway(page, scrolled)
  })

  // The browser's «back» and the iOS edge swipe are a pop: the sheet goes, the screen stays.
  test('«back» closes the sheet, not the screen, and the list stays where it was', async ({
    page,
  }) => {
    const { scrolled } = await openSheet(page)
    await page.goBack()
    await expectPutAway(page, scrolled)
  })

  test('× closes it', async ({ page }) => {
    const { scrolled } = await openSheet(page)
    await sheet(page).getByRole('button', { name: 'Close' }).click()
    await expectPutAway(page, scrolled)
  })

  test('a tap on the scrim closes it', async ({ page }) => {
    const { scrolled } = await openSheet(page)
    await page.mouse.click(12, 12)
    await expectPutAway(page, scrolled)
  })

  test('a tap inside the sheet does not', async ({ page }) => {
    await openSheet(page)
    await sheet(page).getByRole('heading', { name: 'Milk «Ashkhar»' }).click()
    await expect(sheet(page)).toBeVisible()
  })

  test('its main action closes it through the same step', async ({ page }) => {
    const { scrolled } = await openSheet(page)
    await sheet(page).getByRole('button', { name: 'Add to the trip' }).click()
    await expectPutAway(page, scrolled)
  })

  // One entry laid, one taken: the «back» after a closed sheet leaves the screen for the trip
  // laid under it, instead of «closing» a sheet that is already gone.
  test('«back» after it closed leaves the screen', async ({ page }) => {
    await openSheet(page)
    await page.keyboard.press('Escape')
    await expect(sheet(page)).toBeHidden()
    await page.goBack()
    await expect(page).toHaveURL('/')
    await expect(heading(page)).toHaveText('Trip')
  })

  test('Tab keeps to the sheet', async ({ page }) => {
    await openSheet(page)
    for (let press = 0; press < 12; press += 1) {
      await page.keyboard.press('Tab')
      const inside = await page.evaluate(
        () =>
          document.activeElement === document.body ||
          document.activeElement?.closest('dialog') !== null,
      )
      expect(inside, `Tab ${String(press + 1)}`).toBe(true)
    }
  })

  // An entry is not an address: a reload on it opens no sheet and breaks nothing, and the start
  // steps off the entry no sheet holds — the first «back» leaves the screen, as without a sheet.
  test('a reload on its entry opens no sheet and breaks nothing', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await openSheet(page)
    await page.reload()
    await expect(heading(page)).toHaveText('Kit')
    await expect(sheet(page)).toBeHidden()

    await page.goBack()
    await expectOn(page, '/', 'Trip')
    expect(errors).toEqual([])
  })

  // An entry left from a reload carries the same flag; the close of a sheet opened again stepped
  // back onto it and took it for its own — the sheet stayed open (adversarial А-1, А-2).
  test('after a reload on its entry, a sheet opened again closes on the first ×', async ({
    page,
  }) => {
    await openSheet(page)
    await page.reload()
    await expect(heading(page)).toHaveText('Kit')
    await opener(page).scrollIntoViewIfNeeded()
    await opener(page).click()
    await expect(sheet(page)).toBeVisible()
    await page.waitForTimeout(400)
    await sheet(page).getByRole('button', { name: 'Close' }).click()
    await expect(sheet(page)).toBeHidden()
  })

  test('after «forward» onto its old entry, a sheet opened again closes on the first Esc', async ({
    page,
  }) => {
    await openSheet(page)
    await page.keyboard.press('Escape')
    await expect(sheet(page)).toBeHidden()
    await page.goForward()
    await expect(page).toHaveURL('/_kit')
    await opener(page).click()
    await expect(sheet(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet(page)).toBeHidden()
  })

  // The dead entry is the screen's address twice; the rules of «back» read the screen under
  // itself, and the chevron replaced instead of stepping back (adversarial А-3).
  test('after a reload on its entry, the chevron and «back» keep the rules of MOL-17', async ({
    page,
  }) => {
    await openSheet(page)
    await page.reload()
    await expect(heading(page)).toHaveText('Kit')
    await page.getByRole('button', { name: 'Back Trip' }).click()
    await expectOn(page, '/', 'Trip')
    await page.goBack()
    await expect(page).not.toHaveURL(/_kit/)
  })

  // Left by a push with the sheet open: the entry stays behind, and «back» steps over it — one
  // «back» to the screen, one more off it, as without a sheet (adversarial А-4).
  test('a push away from an open sheet leaves no extra «back» behind', async ({ page }) => {
    await openSheet(page)
    await page.evaluate(async () => {
      const root = document.querySelector('#app') as unknown as {
        __vue_app__: {
          config: { globalProperties: { $router: { push: (to: string) => Promise<unknown> } } }
        }
      }
      await root.__vue_app__.config.globalProperties.$router.push('/verdicts')
    })
    await expect(page).toHaveURL('/verdicts')
    await page.goBack()
    await expectOn(page, '/_kit', 'Kit')
    await expect(sheet(page)).toBeHidden()
    await page.goBack()
    await expectOn(page, '/', 'Trip')
  })

  /** The opener in the middle of the screen, so a second tap there lands on the scrim. */
  async function centreOpener(page: Page): Promise<{ x: number; y: number }> {
    await page.goto('/_kit')
    await expect(heading(page)).toHaveText('Kit')
    await opener(page).evaluate((element) => {
      element.scrollIntoView({ block: 'center', behavior: 'instant' })
    })
    const box = await opener(page).boundingBox()
    if (!box) throw new Error('no opener')
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  // The second tap of a double tap lands where the scrim now is, while the sheet is still coming
  // up; it closed the sheet before it was seen (adversarial Б-5).
  test('a double tap on the opener leaves the sheet open', async ({ page }) => {
    const { x, y } = await centreOpener(page)
    await page.mouse.dblclick(x, y)
    await page.waitForTimeout(600)
    await expect(sheet(page)).toBeVisible()
  })

  test('two quick taps of a finger on the opener leave the sheet open', async ({ page }) => {
    const { x, y } = await centreOpener(page)
    await page.touchscreen.tap(x, y)
    await page.waitForTimeout(80)
    await page.touchscreen.tap(x, y)
    await page.waitForTimeout(600)
    await expect(sheet(page)).toBeVisible()
  })

  // A selection that began in a field and overshot onto the scrim is clicked on the dialog, their
  // common ancestor; it closed the sheet and threw away what was typed (adversarial Б-4).
  test('a drag from a field out onto the scrim keeps the sheet and what was typed', async ({
    page,
  }) => {
    await openSheet(page)
    const field = sheet(page).getByLabel('How much')
    await field.fill('1.5')
    await page.waitForTimeout(500)
    const box = await field.boundingBox()
    if (!box) throw new Error('no field')
    await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 4, box.y - 40, { steps: 5 })
    await page.mouse.move(12, 12, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(600)
    await expect(sheet(page)).toBeVisible()
    await expect(field).toHaveValue('1.5')
  })

  // The share is of what is visible above the keyboard (review Р-2).
  test('takes its share of what the keyboard leaves visible', async ({ page }) => {
    await openSheet(page)
    const { maxHeight, expected } = await page.evaluate(() => {
      const dialog = document.querySelector('dialog')!
      dialog.style.setProperty('--keyboard-inset', '300px')
      return {
        maxHeight: Number.parseFloat(getComputedStyle(dialog).maxHeight),
        expected: (window.innerHeight - 300) * 0.82,
      }
    })
    expect(maxHeight).toBeCloseTo(expected, 0)
  })
})

// The segment looks as in the handoff and still answers a thumb over the whole 44px (review Р-3).
test('a segment answers a tap anywhere over the track’s 44px', async ({ page }) => {
  await page.goto('/_kit')
  const segment = page
    .getByRole('group', { name: 'Unit' })
    .first()
    .locator('label', { hasText: 'kg' })
  await segment.scrollIntoViewIfNeeded()
  const track = await segment.locator('..').boundingBox()
  if (!track) throw new Error('no track')
  expect(track.height).toBeGreaterThanOrEqual(44)
  const box = await segment.boundingBox()
  if (!box) throw new Error('no segment')
  await page.mouse.click(box.x + box.width / 2, track.y + 1)
  await expect(page.getByRole('group', { name: 'Unit' }).first().getByLabel('kg')).toBeChecked()
})

/** The app's router, reached the way a development build exposes it. */
interface DevRouter {
  push: (to: string) => Promise<unknown>
  addRoute: (route: unknown) => void
  getRoutes: () => { name?: unknown; components?: { default: unknown } | null }[]
}

/** Kit → sheet → push to a screen nested under the kit: the sheet's dead entry lies under it. */
async function childOverDeadEntry(page: Page): Promise<void> {
  await openSheet(page)
  await page.evaluate(async () => {
    const root = document.querySelector('#app') as unknown as {
      __vue_app__: { config: { globalProperties: { $router: DevRouter } } }
    }
    const router = root.__vue_app__.config.globalProperties.$router
    const view = router.getRoutes().find((route) => route.name === 'item-search')
      ?.components?.default
    router.addRoute({
      path: '/_kit/child',
      name: 'kit-child',
      component: view,
      meta: { titleKey: 'item.search_title', parent: 'kit' },
    })
    await router.push('/_kit/child')
  })
  await expect(page).toHaveURL('/_kit/child')
}

// The guard's step over the dead entry runs inside the chevron's pop. Stepping outside the block
// of «a step in flight», it let a second tap on the chevron through between the two pops, and the
// person asked for the kit and got the trip (adversarial В-3).
test('a double tap on the chevron over a dead entry still takes one step', async ({ page }) => {
  await childOverDeadEntry(page)
  // The second tap comes in the window the defect had: inside the chevron's pop, after its own
  // landing has run and before the guard's step lands. Registered after the first tap, the
  // listener runs after the block's own — every time, not by the luck of a timer.
  await page.evaluate(() => {
    const chevron = () => document.querySelector<HTMLButtonElement>('button.back')
    chevron()?.click()
    window.addEventListener(
      'popstate',
      () => {
        chevron()?.click()
      },
      { once: true },
    )
  })
  await page.waitForTimeout(1500)
  await expectOn(page, '/_kit', 'Kit')
  await page.goBack()
  await expectOn(page, '/', 'Trip')
})

// Arrived at a dead entry by «forward», the guard goes on forward; stepping back cut the screen
// beyond off from «forward» for good (adversarial В-4).
test('«forward» passes over the dead entry a push left', async ({ page }) => {
  await openSheet(page)
  await page.evaluate(async () => {
    const root = document.querySelector('#app') as unknown as {
      __vue_app__: { config: { globalProperties: { $router: DevRouter } } }
    }
    await root.__vue_app__.config.globalProperties.$router.push('/verdicts')
  })
  await expect(page).toHaveURL('/verdicts')
  await page.goBack()
  await expectOn(page, '/_kit', 'Kit')
  await page.goForward()
  await expectOn(page, '/verdicts', 'Ratings')
})

// The kit's own `v-model:open`, made one microtask late — as a screen with an `await` before the
// write would be. The sheet came back up after × (adversarial Г-1).
test('× closes the sheet of a screen that writes its false late', async ({ page }) => {
  await openSheet(page)
  await page.evaluate(() => {
    interface Instance {
      vnode: { props: Record<string, unknown> }
    }
    const dialog = document.querySelector('dialog') as unknown as { __vueParentComponent: Instance }
    const props = dialog.__vueParentComponent.vnode.props
    const write = props['onUpdate:open'] as (open: boolean) => void
    props['onUpdate:open'] = (open: boolean) => {
      void Promise.resolve().then(() => {
        write(open)
      })
    }
  })
  const length = await historyLength(page)
  await sheet(page).getByRole('button', { name: 'Close' }).click()
  await page.waitForTimeout(1000)
  await expect(sheet(page)).toBeHidden()
  expect(await historyLength(page)).toBe(length)
})
