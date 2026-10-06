/// <reference lib="dom" />
// DOM for the code inside page.evaluate and addInitScript, which runs in the browser; the
// rest of the root project (playwright.config.ts, vitest.config.ts) runs in Node and keeps
// the lib it has.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { actorCodec, settingsOf } from '@molvia/model'
import { asBrowser, open } from './session'

/**
 * The shell through a real phone-sized browser: a real history, a real layout and real view
 * transitions. The component tests drive the same code with a pretend observer and a memory
 * of history; what they cannot show — that the system «back» and the chevron land in the same
 * place, that the title collapses at 24px and not at rest — is proved here.
 */

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Sections' })
const tab = (page: Page, name: string) => tabs(page).getByRole('link', { name })
const heading = (page: Page) => page.getByRole('heading', { level: 1 })
/** The chevron of the search under a record: «‹ Entry», read «Back Entry». */
const chevron = (page: Page) => page.getByRole('button', { name: 'Back Entry' })

async function expectOn(page: Page, path: string, title: string): Promise<void> {
  await expect(page).toHaveURL(path)
  await expect(heading(page)).toHaveText(title)
}

test.describe('sections', () => {
  for (const [path, title, label] of [
    ['/', 'What to buy', 'What to buy'],
    ['/purchases', 'Purchases', 'Purchases'],
    ['/verdicts', 'Ratings', 'Ratings'],
  ] as const) {
    test(`${path} opens cold on its own tab, with no chevron`, async ({ page }) => {
      await open(page, path)
      await expect(heading(page)).toHaveText(title)
      await expect(tab(page, label)).toHaveAttribute('aria-current', 'page')
      await expect(tabs(page).locator('[aria-current]')).toHaveCount(1)
      await expect(chevron(page)).toHaveCount(0)
      expect(await page.title()).toBe(`${title} · Molvia`)
    })
  }

  test('an unknown path leads home', async ({ page }) => {
    await open(page, '/nowhere')
    await expectOn(page, '/', 'What to buy')
  })

  // The addresses of «Поход» and of the old «Что брать» still arrive, for good (MOL-81, MOL-128).
  for (const [old, path, title] of [
    ['/advice', '/', 'What to buy'],
    ['/trip', '/purchases', 'Purchases'],
    ['/trip/history', '/purchases', 'Purchases'],
  ] as const) {
    test(`the old address ${old} leads to ${path}`, async ({ page }) => {
      await open(page, old)
      await expectOn(page, path, title)
    })
  }

  // The chain the owner answered (В-2), with the home of MOL-128: whatever was tapped in between,
  // «back» from a section goes to «Что брать», and from there out of the app.
  test('What to buy → Purchases → Ratings, then back: What to buy, then out', async ({ page }) => {
    await open(page, '/')
    await tab(page, 'Purchases').click()
    await expectOn(page, '/purchases', 'Purchases')
    await tab(page, 'Ratings').click()
    await expectOn(page, '/verdicts', 'Ratings')

    await page.goBack()
    await expectOn(page, '/', 'What to buy')

    await page.goBack()
    await expect(page).toHaveURL('about:blank')
  })

  test('a tap on What to buy from another section is the same step back', async ({ page }) => {
    await open(page, '/')
    await tab(page, 'Purchases').click()
    await tab(page, 'Ratings').click()
    await tab(page, 'What to buy').click()
    await expectOn(page, '/', 'What to buy')

    await page.goBack()
    await expect(page).toHaveURL('about:blank')
  })

  // Home is home whatever its address carries — a tracking tag on a shared link, a
  // hash. The invite link that used to arrive here is gone with the door (MOL-52), but what it
  // caught is not: a query rewritten behind the router's back left `/?c=…` remembered as where
  // it came from, and the way home stopped being a step back.
  for (const entry of ['/?utm_source=telegram', '/#top']) {
    test(`arriving at ${entry}, the way home is still a step back`, async ({ page }) => {
      await open(page, entry)
      await expect(heading(page)).toHaveText('What to buy')
      await tab(page, 'Purchases').click()
      await expectOn(page, '/purchases', 'Purchases')
      await tab(page, 'What to buy').click()
      await expect(heading(page)).toHaveText('What to buy')

      await page.goBack()
      await expect(page).toHaveURL('about:blank')
    })
  }

  test('each tab is a thumb-sized target', async ({ page }) => {
    await open(page, '/')
    for (const name of ['What to buy', 'Purchases', 'Ratings']) {
      const box = await tab(page, name).boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
    }
  })

  // Decided in review (О-5): a section opened cold — a link from the bot to «Ratings» — is its
  // own home. Laying home under it would be a push without a gesture, which Chrome may skip.
  for (const [path, label] of [
    ['/purchases', 'Purchases'],
    ['/verdicts', 'Ratings'],
  ] as const) {
    test(`${path} opened cold is its own home: «back» leaves the app`, async ({ page }) => {
      await open(page, path)
      await expect(tab(page, label)).toHaveAttribute('aria-current', 'page')
      await page.goBack()
      await expect(page).toHaveURL('about:blank')
    })
  }
})

test.describe('the nested search', () => {
  test('has a chevron to the record and no tab bar', async ({ page }) => {
    await open(page, '/purchases/manual/add')
    await expect(heading(page)).toHaveText('What did you pick up?')
    await expect(chevron(page)).toBeVisible()
    await expect(tabs(page)).toHaveCount(0)

    const box = await chevron(page).boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  })

  // Opened cold — a reload, a restored tab, a link — the record and «Покупки» are laid underneath
  // (В-3), so the system button does what the chevron promises instead of leaving the app. With no
  // record open, the record goes up to «Покупки» by itself (MOL-128).
  test('the system «back» leads to «Покупки», not out of the app', async ({ page }) => {
    await open(page, '/purchases/manual/add')
    await page.goBack()
    await expectOn(page, '/purchases', 'Purchases')
  })

  test('the chevron takes that same step, leaving nothing behind to return to', async ({
    page,
  }) => {
    await open(page, '/purchases/manual/add')
    await chevron(page).click()
    await expectOn(page, '/purchases', 'Purchases')

    await page.goBack()
    await expect(page).toHaveURL('about:blank')
  })

  test('a reload keeps the chain underneath without laying a second one', async ({ page }) => {
    await open(page, '/purchases/manual/add')
    await page.reload()
    await expect(heading(page)).toHaveText('What did you pick up?')
    await page.goBack()
    await expectOn(page, '/purchases', 'Purchases')
    await page.goBack()
    await expect(page).toHaveURL('about:blank')
  })
})

// Review Р-19: the chain with a record open — the case the bug of `afterStep` hid in, since
// happy-dom never showed it.
test('a record open, its search opened cold: the record, «Покупки», then out', async ({ page }) => {
  await open(page, '/purchases/manual/add')
  const headers = await asBrowser(page)
  const context = settingsOf(
    actorCodec.parse(await (await page.request.get('/api/actors/me', { headers })).json()),
  )
  const started = await page.request.post('/api/trips', {
    headers,
    data: { context, id: randomUUID(), place: { kind: 'store', name: 'Рынок' } },
  })
  expect(started.status()).toBe(201)
  await page.reload()

  await chevron(page).click()
  await expectOn(page, '/purchases/manual', 'Рынок')
  await page.goBack()
  await expectOn(page, '/purchases', 'Purchases')
  await expect(page.locator('.open')).toContainText('Рынок')
  await page.goBack()
  await expect(page).toHaveURL('about:blank')
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

  for (const path of ['/', '/purchases/manual/add']) {
    test(`on ${path} collapses past 24px and opens again, the row never changing height`, async ({
      page,
    }) => {
      await open(page, path)
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
    await open(page, '/purchases')
    await makeScrollable(page)
    await scrollTo(page, 800)
    await tab(page, 'Purchases').click()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    await expect(page).toHaveURL('/purchases')
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
    await open(page, '/')
    await expect(page.locator('nav.tabbar')).toHaveJSProperty('offsetHeight', 74 + 34)
    await open(page, '/purchases/manual/add')
    await expect(bar(page)).toHaveJSProperty('offsetHeight', 44 + 47)
  })

  // Turned, the notch leaves the top and the row shrinks: the line under it follows, so the
  // screen is not collapsed at rest.
  test('turning the phone keeps the title open at rest', async ({ page }) => {
    await insets(page, portrait)
    await open(page, '/purchases/manual/add')
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
    await open(page, '/purchases/manual/add')
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
      await open(page, '/purchases/manual/add')
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

  // К-9: the docked strip keeps its own margins — 12 over and under its column, on top of the tab
  // bar that holds the indicator — whatever the screen puts in it.
  test('the docked strip stands on the tab bar, 12 around its column', async ({ page }) => {
    await insets(page, portrait)
    await open(page, '/settings')
    const save = page.locator('.dock > button')
    await expect(save).toBeVisible()
    // Measured where it stands, not while it slides in from under the edge.
    await page
      .locator('.dock')
      .evaluate((node) =>
        Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)),
      )
    const [dock, button, tabs] = await Promise.all([
      page.locator('.dock').boundingBox(),
      save.boundingBox(),
      page.locator('nav.tabbar').boundingBox(),
    ])
    expect(Math.round((dock?.y ?? 0) + (dock?.height ?? 0))).toBe(Math.round(tabs?.y ?? -1))
    expect(Math.round((tabs?.y ?? 0) - ((button?.y ?? 0) + (button?.height ?? 0)))).toBe(12)
    // Opaque (Ф-18): nothing of the page shows through the strip or the tab bar.
    for (const bar of ['.dock', 'nav.tabbar', 'header.bar']) {
      const style = await page
        .locator(bar)
        .evaluate((node) => [
          getComputedStyle(node).backgroundColor,
          getComputedStyle(node).backdropFilter,
        ])
      expect(style[0]).toMatch(/^rgb\(/)
      expect(style[1]).toBe('none')
    }
  })

  // Ф-29, К-10: «Вернуть» 8 over the strip on a section — the strip over the tab bar that holds the
  // indicator — and the list ending over it (adversarial А1), a removed record on «Покупки».
  test('«Вернуть» on a section stands 8 over the strip, and the list ends over it', async ({
    page,
  }) => {
    await insets(page, portrait)
    await open(page, '/purchases')
    const headers = await asBrowser(page)
    const me = actorCodec.parse(
      await (await page.request.get('/api/actors/me', { headers })).json(),
    )
    const trip = async (name: string) => {
      const created = await page.request.post('/api/trips', {
        headers,
        data: { context: settingsOf(me), id: randomUUID(), place: { name, kind: 'store' } },
      })
      expect(created.status()).toBe(201)
      const id = ((await created.json()) as { id: string }).id
      const finished = await page.request.post(`/api/trips/${id}/finish`, {
        headers,
        data: { finishedOnDeviceAt: new Date().toISOString() },
      })
      expect(finished.status()).toBe(204)
      return id
    }
    for (let i = 1; i <= 6; i += 1) await trip(`Shop ${String(i)}`)
    const removed = await trip('Removed shop')
    // With a purchase in it, so that removing it asks first (an empty one goes at once).
    const item = await page.request.post('/api/catalogue/items', {
      headers,
      data: { kind: 'product', name: `Removed ${randomUUID()}`, defaultUnit: 'piece' },
    })
    const expense = await page.request.post(`/api/trips/${removed}/expenses`, {
      headers,
      data: { id: randomUUID(), itemId: ((await item.json()) as { id: string }).id },
    })
    expect(expense.status()).toBe(201)
    await open(page, '/purchases')
    await page.locator('.recorded .purchase-row').filter({ hasText: 'Removed shop' }).click()
    await expect(page).toHaveURL(new RegExp(`/purchases/${removed}$`))
    await page.getByRole('button', { name: 'Delete the entry' }).click()
    await page.waitForTimeout(400)
    await page.locator('dialog[open]').getByRole('button', { name: 'Delete the entry' }).click()
    await expect(page).toHaveURL(/\/purchases$/)
    const strip = page.locator('.undo-strip')
    await expect(strip).toBeVisible()
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-nav'))
    await strip.locator('.text').hover()
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight)
    })
    await page.waitForTimeout(300)
    const [undo, dock, last] = await Promise.all([
      strip.boundingBox(),
      page.locator('.dock').boundingBox(),
      page.locator('.recorded .purchase-row').last().boundingBox(),
    ])
    expect(Math.round((dock?.y ?? 0) - ((undo?.y ?? 0) + (undo?.height ?? 0)))).toBe(8)
    expect((last?.y ?? 0) + (last?.height ?? 0)).toBeLessThanOrEqual(undo?.y ?? 0)
    // Reached through `:deep`, not `:slotted` (adversarial А2, А2′): «Photograph a receipt» and «Add
    // by hand» render a button and its sheet — two roots and no slot attribute — and still fade in;
    // the strip in the place of «Вернуть» takes the tap, whatever it is made of.
    const style = (selector: string, property: 'animationName' | 'pointerEvents') =>
      page
        .locator(selector)
        .evaluateAll((nodes, name) => nodes.map((node) => getComputedStyle(node)[name]), property)
    expect(await style('.dock > button', 'animationName')).toEqual(['appear', 'appear'])
    expect(await style('.undo-place > *', 'pointerEvents')).toEqual(['auto'])
  })

  // On a nested screen with no strip — «Счета» — «Вернуть» stands 8 over the home indicator.
  test.describe('in Russian', () => {
    test.use({ locale: 'ru-RU' })

    test('«Вернуть» on a nested screen with no strip stands 8 over the indicator', async ({
      page,
    }) => {
      await insets(page, portrait)
      await open(page, '/money/accounts')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Счета')
      await page.getByRole('button', { name: 'Добавить счёт' }).click()
      const sheet = page.locator('dialog[open]').last()
      await page.waitForTimeout(400)
      await sheet.getByLabel('Имя').fill('Лишний')
      await sheet.getByLabel('Остаток').fill('0')
      await sheet
        .getByLabel('На день')
        .fill(
          new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yerevan' }).format(
            new Date(Date.now() - 24 * 60 * 60 * 1000),
          ),
        )
      await sheet.getByRole('button', { name: 'Сохранить' }).click()
      await expect(sheet).toBeHidden()
      await page.getByRole('link', { name: /Лишний/ }).click()
      await page.getByRole('button', { name: 'Править' }).click()
      await page.waitForTimeout(400)
      await page
        .locator('dialog[open]')
        .last()
        .getByRole('button', { name: 'Удалить счёт' })
        .click()
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Счета')
      const strip = page.locator('.undo-strip')
      await expect(strip).toBeVisible()
      await strip.locator('.text').hover()
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-nav'))
      const box = await strip.boundingBox()
      const height = await page.evaluate(() => window.innerHeight)
      expect(Math.round(height - ((box?.y ?? 0) + (box?.height ?? 0)))).toBe(portrait.bottom + 8)
    })
  })

  test('held sideways, nothing starts under the notch', async ({ page }) => {
    await page.setViewportSize({ width: 915, height: 412 })
    await insets(page, landscape)
    await open(page, '/purchases/manual/add')
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
    await open(page, '/')
    await tab(page, 'Purchases').click()
    await open(page, '/purchases/manual/add')
    await chevron(page).click()
    await expectOn(page, '/purchases', 'Purchases')
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
    await open(page, '/')
    await tab(page, 'Purchases').click()
    await expectOn(page, '/purchases', 'Purchases')
    expect(await transitions(page)).toBe(1)
  })

  test('nothing is animated when motion is reduced, and the move still happens', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await countTransitions(page)
    await open(page, '/')
    await tab(page, 'Purchases').click()
    await expectOn(page, '/purchases', 'Purchases')
    expect(await transitions(page)).toBe(0)
  })

  test('the title collapses without motion when motion is reduced', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await open(page, '/purchases/manual/add')
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
    await open(page, '/')
    await tab(page, 'Ratings').click()
    await expectOn(page, '/verdicts', 'Ratings')
    expect(await transitions(page)).toBe(1)

    await page.goBack()
    await expectOn(page, '/', 'What to buy')
    expect(await transitions(page)).toBe(1)

    await tab(page, 'Purchases').click()
    await expectOn(page, '/purchases', 'Purchases')
    expect(await transitions(page)).toBe(2)
  })

  test('focus lands on the new heading after a move', async ({ page }) => {
    await open(page, '/')
    await tab(page, 'Ratings').click()
    await expect(heading(page)).toBeFocused()
  })
})
