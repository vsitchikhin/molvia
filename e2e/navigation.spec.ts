/// <reference lib="dom" />
// DOM for the code inside page.evaluate and addInitScript, which runs in the browser; the
// rest of the root project (playwright.config.ts, vitest.config.ts) runs in Node and keeps
// the lib it has.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * The shell through a real phone-sized browser: a real history, a real layout and real view
 * transitions. The component tests drive the same code with a pretend observer and a memory
 * of history; what they cannot show — that the system «back» and the chevron land in the same
 * place, that the title collapses at 24px and not at rest — is proved here.
 */

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Sections' })
const tab = (page: Page, name: string) => tabs(page).getByRole('link', { name })
const heading = (page: Page) => page.getByRole('heading', { level: 1 })
const chevron = (page: Page) => page.getByRole('button', { name: 'Back Trip' })

async function expectOn(page: Page, path: string, title: string): Promise<void> {
  await expect(page).toHaveURL(path)
  await expect(heading(page)).toHaveText(title)
}

test.describe('sections', () => {
  for (const [path, title, label] of [
    ['/', 'Trip', 'Trip'],
    ['/advice', 'What to buy', 'What to buy'],
    ['/verdicts', 'Ratings', 'Ratings'],
  ] as const) {
    test(`${path} opens cold on its own tab, with no chevron`, async ({ page }) => {
      await page.goto(path)
      await expect(heading(page)).toHaveText(title)
      await expect(tab(page, label)).toHaveAttribute('aria-current', 'page')
      await expect(tabs(page).locator('[aria-current]')).toHaveCount(1)
      await expect(chevron(page)).toHaveCount(0)
      expect(await page.title()).toBe(`${title} · Molvia`)
    })
  }

  test('an unknown path leads to the trip', async ({ page }) => {
    await page.goto('/nowhere')
    await expectOn(page, '/', 'Trip')
  })

  // The chain the owner answered (В-2): whatever was tapped in between, «back» from a section
  // goes to the trip, and from the trip out of the app.
  test('Trip → What to buy → Ratings, then back: Trip, then out', async ({ page }) => {
    await page.goto('/')
    await tab(page, 'What to buy').click()
    await expectOn(page, '/advice', 'What to buy')
    await tab(page, 'Ratings').click()
    await expectOn(page, '/verdicts', 'Ratings')

    await page.goBack()
    await expectOn(page, '/', 'Trip')

    await page.goBack()
    await expect(page).toHaveURL('about:blank')
  })

  test('a tap on Trip from another section is the same step back', async ({ page }) => {
    await page.goto('/')
    await tab(page, 'What to buy').click()
    await tab(page, 'Ratings').click()
    await tab(page, 'Trip').click()
    await expectOn(page, '/', 'Trip')

    await page.goBack()
    await expect(page).toHaveURL('about:blank')
  })

  // The trip is the trip whatever its address carries — a tracking tag on a shared link, a
  // hash. The invite link that used to arrive here is gone with the door (MOL-52), but what it
  // caught is not: a query rewritten behind the router's back left `/?c=…` remembered as where
  // it came from, and the way home stopped being a step back.
  for (const entry of ['/?utm_source=telegram', '/#top']) {
    test(`arriving at ${entry}, the way home is still a step back`, async ({ page }) => {
      await page.goto(entry)
      await expect(heading(page)).toHaveText('Trip')
      await tab(page, 'What to buy').click()
      await expectOn(page, '/advice', 'What to buy')
      await tab(page, 'Trip').click()
      await expect(heading(page)).toHaveText('Trip')

      await page.goBack()
      await expect(page).toHaveURL('about:blank')
    })
  }

  test('each tab is a thumb-sized target', async ({ page }) => {
    await page.goto('/')
    for (const name of ['Trip', 'What to buy', 'Ratings']) {
      const box = await tab(page, name).boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
    }
  })

  // Decided in review (О-5): a section opened cold — a link from the bot to «Ratings» — is its
  // own home. Laying the trip under it would be a push without a gesture, which Chrome may skip.
  for (const [path, label] of [
    ['/advice', 'What to buy'],
    ['/verdicts', 'Ratings'],
  ] as const) {
    test(`${path} opened cold is its own home: «back» leaves the app`, async ({ page }) => {
      await page.goto(path)
      await expect(tab(page, label)).toHaveAttribute('aria-current', 'page')
      await page.goBack()
      await expect(page).toHaveURL('about:blank')
    })
  }
})

test.describe('the nested search', () => {
  test('has a chevron to the trip and no tab bar', async ({ page }) => {
    await page.goto('/trip/add')
    await expect(heading(page)).toHaveText('What did you pick up?')
    await expect(chevron(page)).toBeVisible()
    await expect(tabs(page)).toHaveCount(0)

    const box = await chevron(page).boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  })

  // Opened cold — a reload, a restored tab, a link — the trip is laid underneath (В-3), so the
  // system button does what the chevron promises instead of leaving the app.
  test('the system «back» leads to the trip, not out of the app', async ({ page }) => {
    await page.goto('/trip/add')
    await page.goBack()
    await expectOn(page, '/', 'Trip')
  })

  test('the chevron takes that same step, leaving nothing behind to return to', async ({
    page,
  }) => {
    await page.goto('/trip/add')
    await chevron(page).click()
    await expectOn(page, '/', 'Trip')

    await page.goBack()
    await expect(page).toHaveURL('about:blank')
  })

  test('a reload keeps the trip underneath without laying a second one', async ({ page }) => {
    await page.goto('/trip/add')
    await page.reload()
    await expect(heading(page)).toHaveText('What did you pick up?')
    await page.goBack()
    await expectOn(page, '/', 'Trip')
    await page.goBack()
    await expect(page).toHaveURL('about:blank')
  })
})

test.describe('the large title', () => {
  /** The placeholders are short; a tall block gives the page something to scroll. */
  async function makeScrollable(page: Page): Promise<void> {
    await page.evaluate(() => {
      const filler = document.createElement('div')
      filler.style.height = '3000px'
      document.querySelector('.content')?.append(filler)
    })
  }

  async function scrollTo(page: Page, y: number): Promise<void> {
    await page.evaluate((top) => {
      window.scrollTo({ top, behavior: 'instant' })
    }, y)
  }

  const screen = (page: Page) => page.locator('.screen')

  for (const path of ['/', '/trip/add']) {
    test(`on ${path} collapses past 24px and opens again, the row never changing height`, async ({
      page,
    }) => {
      await page.goto(path)
      await makeScrollable(page)
      const bar = page.locator('header.bar')
      const rest = (await bar.boundingBox())?.height

      await scrollTo(page, 23)
      await page.waitForTimeout(100)
      await expect(screen(page)).not.toHaveClass(/collapsed/)

      await scrollTo(page, 25)
      await expect(screen(page)).toHaveClass(/collapsed/)
      expect((await bar.boundingBox())?.height).toBe(rest)

      await scrollTo(page, 0)
      await expect(screen(page)).not.toHaveClass(/collapsed/)
    })
  }

  test('a tap on the open tab scrolls back to the top', async ({ page }) => {
    await page.goto('/advice')
    await makeScrollable(page)
    await scrollTo(page, 800)
    await tab(page, 'What to buy').click()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    await expect(page).toHaveURL('/advice')
  })
})

/**
 * The notch and the home indicator, set through the engine rather than faked in a token:
 * `Emulation.setSafeAreaInsetsOverride` gives `env(safe-area-inset-*)` real values in the same
 * Chromium that runs Chrome on Android. No phone is needed for the geometry.
 */
test.describe('safe areas', () => {
  interface Insets {
    top: number
    bottom: number
    left: number
    right: number
  }
  const portrait: Insets = { top: 47, bottom: 34, left: 0, right: 0 }
  const landscape: Insets = { top: 0, bottom: 21, left: 47, right: 47 }

  async function insets(page: Page, value: Insets): Promise<void> {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send(
      'Emulation.setSafeAreaInsetsOverride' as never,
      {
        insets: {
          top: value.top,
          topMax: value.top,
          bottom: value.bottom,
          bottomMax: value.bottom,
          left: value.left,
          leftMax: value.left,
          right: value.right,
          rightMax: value.right,
        },
      } as never,
    )
  }

  const bar = (page: Page) => page.locator('header.bar')
  const screen = (page: Page) => page.locator('.screen')

  test('the pinned row grows by the notch, and the tab bar by the indicator', async ({ page }) => {
    await insets(page, portrait)
    await page.goto('/')
    await expect(page.locator('nav.tabbar')).toHaveJSProperty('offsetHeight', 74 + 34)
    await page.goto('/trip/add')
    await expect(bar(page)).toHaveJSProperty('offsetHeight', 44 + 47)
  })

  // Turned, the notch leaves the top and the row shrinks: the line under it follows, so the
  // screen is not collapsed at rest.
  test('turning the phone keeps the title open at rest', async ({ page }) => {
    await insets(page, portrait)
    await page.goto('/trip/add')
    await expect(bar(page)).toHaveJSProperty('offsetHeight', 91)

    await page.setViewportSize({ width: 915, height: 412 })
    await insets(page, landscape)
    await expect(bar(page)).toHaveJSProperty('offsetHeight', 44)
    await page.waitForTimeout(150)
    await expect(screen(page)).not.toHaveClass(/collapsed/)
  })

  test('turned the other way, it still collapses past 24px', async ({ page }) => {
    await page.setViewportSize({ width: 915, height: 412 })
    await insets(page, landscape)
    await page.goto('/trip/add')
    await page.setViewportSize({ width: 412, height: 915 })
    await insets(page, portrait)
    await expect(bar(page)).toHaveJSProperty('offsetHeight', 91)
    await page.evaluate(() => {
      const filler = document.createElement('div')
      filler.style.height = '3000px'
      document.querySelector('.content')?.append(filler)
      window.scrollTo({ top: 25, behavior: 'instant' })
    })
    await expect(screen(page)).toHaveClass(/collapsed/)
  })

  // A nested screen has no tab bar to carry the indicator: its own content has to.
  for (const [name, size, bottom, side] of [
    ['upright', { width: 412, height: 915 }, 34, 0],
    ['sideways', { width: 915, height: 412 }, 21, 47],
  ] as const) {
    test(`the search, ${name}: its last row stays above the home indicator`, async ({ page }) => {
      await page.setViewportSize(size)
      await insets(page, { top: side ? 0 : 47, bottom, left: side, right: side })
      await page.goto('/trip/add')
      await expect(heading(page)).toHaveText('What did you pick up?')
      const { lastRow, height } = await page.evaluate(() => {
        const filler = document.createElement('div')
        filler.style.height = '3000px'
        const last = document.createElement('p')
        last.textContent = 'last'
        last.style.margin = '0'
        document.querySelector('.content')?.append(filler, last)
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
        return { lastRow: last.getBoundingClientRect().bottom, height: window.innerHeight }
      })
      expect(lastRow).toBeLessThanOrEqual(height - bottom)
    })
  }

  test('held sideways, nothing starts under the notch', async ({ page }) => {
    await page.setViewportSize({ width: 915, height: 412 })
    await insets(page, landscape)
    await page.goto('/trip/add')
    const back = await chevron(page).boundingBox()
    const title = await heading(page).boundingBox()
    expect(back?.x ?? 0).toBeGreaterThanOrEqual(landscape.left)
    expect(title?.x ?? 0).toBeGreaterThanOrEqual(landscape.left)
    expect((title?.x ?? 0) + (title?.width ?? 0)).toBeLessThanOrEqual(915 - landscape.right)
  })
})

test.describe('what the shell leaves alone', () => {
  // Swipe from the edge and the Android «back» belong to the browser. The shell registers no
  // touch handler anywhere to fight them with.
  test('no touch listener is registered', async ({ page }) => {
    await page.addInitScript(() => {
      const seen: string[] = []
      ;(window as unknown as { touchListeners: string[] }).touchListeners = seen
      const prototype = EventTarget.prototype
      // eslint-disable-next-line @typescript-eslint/unbound-method -- applied to its own `this` below
      const original = prototype.addEventListener
      prototype.addEventListener = function (
        this: EventTarget,
        ...args: Parameters<EventTarget['addEventListener']>
      ) {
        if (args[0].startsWith('touch')) seen.push(args[0])
        original.apply(this, args)
      }
    })
    await page.goto('/')
    await tab(page, 'What to buy').click()
    await page.goto('/trip/add')
    await chevron(page).click()
    await expectOn(page, '/', 'Trip')
    expect(
      await page.evaluate(() => (window as unknown as { touchListeners: string[] }).touchListeners),
    ).toEqual([])
  })
})

test.describe('moves', () => {
  async function countTransitions(page: Page): Promise<void> {
    await page.addInitScript(() => {
      const counter = window as unknown as { transitions: number }
      counter.transitions = 0
      const original = document.startViewTransition.bind(document)
      document.startViewTransition = (update?: ViewTransitionUpdateCallback) => {
        counter.transitions += 1
        return original(update)
      }
    })
  }

  const transitions = (page: Page) =>
    page.evaluate(() => (window as unknown as { transitions: number }).transitions)

  test('a change of section is animated where the platform can', async ({ page }) => {
    await countTransitions(page)
    await page.goto('/')
    await tab(page, 'What to buy').click()
    await expectOn(page, '/advice', 'What to buy')
    expect(await transitions(page)).toBe(1)
  })

  test('nothing is animated when motion is reduced, and the move still happens', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await countTransitions(page)
    await page.goto('/')
    await tab(page, 'What to buy').click()
    await expectOn(page, '/advice', 'What to buy')
    expect(await transitions(page)).toBe(0)
  })

  test('the title collapses without motion when motion is reduced', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/trip/add')
    const durations = await page.evaluate(() =>
      ['.bar', '.small'].map((selector) => {
        const node = document.querySelector(selector)
        return node ? getComputedStyle(node).transitionDuration : 'missing'
      }),
    )
    expect(durations).toEqual(['0s', '0s'])
  })

  // iOS edge swipe and Android predictive back animate the page themselves and say so on the
  // event. Playwright cannot swipe, so every popstate here claims the browser animated it.
  test('a back the browser animated is not animated again, and the next move is', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(PopStateEvent.prototype, 'hasUAVisualTransition', { get: () => true })
    })
    await countTransitions(page)
    await page.goto('/')
    await tab(page, 'Ratings').click()
    await expectOn(page, '/verdicts', 'Ratings')
    expect(await transitions(page)).toBe(1)

    await page.goBack()
    await expectOn(page, '/', 'Trip')
    expect(await transitions(page)).toBe(1)

    await tab(page, 'What to buy').click()
    await expectOn(page, '/advice', 'What to buy')
    expect(await transitions(page)).toBe(2)
  })

  test('focus lands on the new heading after a move', async ({ page }) => {
    await page.goto('/')
    await tab(page, 'Ratings').click()
    await expect(heading(page)).toBeFocused()
  })
})
