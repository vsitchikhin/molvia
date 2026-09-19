import process from 'node:process'
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

  // The invite link is how everyone arrives. Its code is scrubbed from the address on start;
  // done behind the router's back, the router remembered `/?c=…` as where it came from, and the
  // way home stopped being a step back — «back» from the trip then landed on the trip again.
  test('arriving by an invite link, the way home is still a step back', async ({ page }) => {
    const code = process.env.SIGNUP_CODE
    test.skip(!code, 'SIGNUP_CODE is not set')
    await page.goto(`/?c=${code ?? ''}`)
    await expect(page).toHaveURL('/')
    await tab(page, 'What to buy').click()
    await expectOn(page, '/advice', 'What to buy')
    await tab(page, 'Trip').click()
    await expectOn(page, '/', 'Trip')

    await page.goBack()
    await expect(page).toHaveURL('about:blank')
  })

  test('each tab is a thumb-sized target', async ({ page }) => {
    await page.goto('/')
    for (const name of ['Trip', 'What to buy', 'Ratings']) {
      const box = await tab(page, name).boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
    }
  })
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

  test('focus lands on the new heading after a move', async ({ page }) => {
    await page.goto('/')
    await tab(page, 'Ratings').click()
    await expect(heading(page)).toBeFocused()
  })
})
