import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { asBrowser, signedIn } from './session'

// Motion as it is (MOL-151): what must not move does not, and what moves does it once. Born of the
// adversarial review of MOL-151 (А1–А6), each turned the other way round.
test.use({ locale: 'ru-RU', reducedMotion: 'no-preference' })

interface Played {
  target: Element
  frames: Keyframe[]
  animation: Animation
}

/** Every `animate()` the page asks for, kept with its element; `hold` pauses a chosen one. */
async function recordAnimate(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const played: unknown[] = []
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called through .call(this)
    const original = Element.prototype.animate
    Element.prototype.animate = function (this: Element, frames, options) {
      const animation = original.call(this, frames, options)
      played.push({ target: this, frames, animation })
      const hold = (window as unknown as { hold?: (t: Element, f: unknown, a: Animation) => void })
        .hold
      hold?.(this, frames, animation)
      return animation
    }
    Object.assign(window, { played })
  })
}

function yerevanDay(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yerevan' }).format(new Date())
}

function lastMonthDay(day: number): string {
  const date = new Date(`${yerevanDay().slice(0, 7)}-${String(day).padStart(2, '0')}T12:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() - 1)
  return date.toISOString().slice(0, 10)
}

/** Last month: the 15th and the 14th, one spending each; this month: one, today. */
async function seed(page: Page): Promise<void> {
  await signedIn(page)
  const headers = await asBrowser(page)
  const { categories } = (await (
    await page.request.get('/api/spending-categories', { headers })
  ).json()) as { categories: { id: string }[] }
  const spend = async (amount: string, spentOn: string, note: string) => {
    const response = await page.request.post('/api/spendings', {
      headers,
      data: {
        id: randomUUID(),
        spentOn,
        amount: { amount, currency: 'AMD' },
        categoryId: categories[0]?.id,
        note,
      },
    })
    expect(response.status(), await response.text()).toBe(201)
  }
  await spend('1500', lastMonthDay(15), 'Пятнадцатое')
  await spend('1400', lastMonthDay(14), 'Четырнадцатое')
  await spend('1000', yerevanDay(), 'Сегодня')
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await expect(page.getByRole('button', { name: /Открыть трату/ })).toHaveCount(1)
}

async function toLastMonth(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
  await expect(page.getByRole('button', { name: /Открыть трату/ })).toHaveCount(2)
  await page.waitForTimeout(600)
}

test('another month the phone keeps is just there: no day grows or shrinks (MOL-136, А1)', async ({
  page,
}) => {
  await recordAnimate(page)
  await seed(page)
  await toLastMonth(page)

  await page.evaluate(() => {
    ;(window as unknown as { played: unknown[] }).played.length = 0
  })
  await page.getByRole('button', { name: 'Следующий месяц' }).click()
  await expect(page.getByRole('button', { name: /Открыть трату/ })).toHaveCount(1)
  await page.waitForTimeout(600)

  const days = await page.evaluate(() =>
    (window as unknown as { played: Played[] }).played
      .filter((one) => one.target.matches('section.day'))
      .map((one) => (one.frames[0]?.height === '0px' ? 'grows' : 'shrinks')),
  )
  expect(days).toEqual([])
})

test('a day removed takes the gap of the column with it: its neighbour does not jump (А2)', async ({
  page,
}) => {
  await recordAnimate(page)
  await seed(page)
  await toLastMonth(page)

  // The day's shrinking is held a moment before its end, where it is no height and still in the page.
  await page.evaluate(() => {
    const held: { target: Element; animation: Animation }[] = []
    Object.assign(window, {
      held,
      hold(target: Element, frames: Keyframe[], animation: Animation) {
        if (!target.matches('section.day') || frames[0]?.height === '0px') return
        const end = Number(animation.effect?.getComputedTiming().endTime ?? 0)
        animation.pause()
        animation.currentTime = end - 0.01
        held.push({ target, animation })
      },
    })
  })

  await page.getByRole('button', { name: /Открыть трату: Пятнадцатое/ }).click()
  const sheet = page.locator('dialog[open]')
  await page.waitForTimeout(400)
  await sheet.getByRole('button', { name: 'Удалить трату' }).click()
  await expect(sheet).toBeHidden()
  await page.waitForTimeout(1500)

  const jump = await page.evaluate(async () => {
    const all = (window as unknown as { held: { target: HTMLElement; animation: Animation }[] })
      .held
    const last = all.filter((one) => one.target.isConnected).at(-1)
    if (!last) throw new Error('no day shrinking in the page')
    const { target, animation } = last
    const container = target.parentElement!
    const neighbour = [...container.querySelectorAll<HTMLElement>(':scope > section.day')].find(
      (day) => day !== target,
    )
    const caption = container.querySelector<HTMLElement>(':scope > h2')
    if (!neighbour || !caption) throw new Error('no neighbouring day or caption')
    window.scrollTo(0, 0)
    const leftHeight = target.getBoundingClientRect().height
    const before = neighbour.getBoundingClientRect().top - caption.getBoundingClientRect().top
    animation.play()
    await animation.finished
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    return {
      leftHeight,
      gap: getComputedStyle(container).rowGap,
      removed: !target.isConnected,
      moved: before - (neighbour.getBoundingClientRect().top - caption.getBoundingClientRect().top),
    }
  })
  expect(jump.leftHeight).toBeLessThan(1)
  expect(jump.removed).toBe(true)
  expect(jump.gap).toBe('12px')
  expect(Math.abs(jump.moved)).toBeLessThan(1)
})

test('a day removed shrinks once, and does not come back before the month is read again (А3)', async ({
  page,
}) => {
  await recordAnimate(page)
  await seed(page)
  await toLastMonth(page)
  await page.evaluate(() => {
    ;(window as unknown as { played: unknown[] }).played.length = 0
  })

  await page.getByRole('button', { name: /Открыть трату: Пятнадцатое/ }).click()
  const sheet = page.locator('dialog[open]')
  await page.waitForTimeout(400)
  await sheet.getByRole('button', { name: 'Удалить трату' }).click()
  await expect(sheet).toBeHidden()
  await page.waitForTimeout(1500)

  const moves = await page.evaluate(() =>
    (window as unknown as { played: Played[] }).played
      .filter(
        (one) =>
          one.target.matches('section.day') &&
          (one.target as HTMLElement).innerText.includes('Пятнадцатое'),
      )
      .map((one) => (one.frames[0]?.height === '0px' ? 'grows' : 'shrinks')),
  )
  expect(moves).toEqual(['shrinks'])
  await expect(page.getByRole('button', { name: /Открыть трату: Пятнадцатое/ })).toHaveCount(0)
})

test('an answer come at the end of a move does not fade in a second time after it (А4)', async ({
  page,
}) => {
  await signedIn(page)
  await page.getByRole('link', { name: 'Настройки', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Настройки')
  await page.waitForTimeout(500)
  // The move held for a second, so that an answer let go near its end lands inside it even on a
  // busy machine: the 220 ms of the app left too narrow a window, and the answer came after it.
  await page.addStyleTag({
    content:
      '::view-transition-group(root), ::view-transition-old(root), ::view-transition-new(root) { animation-duration: 1s !important; }',
  })

  // Every frame: whether the move is on, and how opaque the answer of «Устройства» is.
  await page.evaluate(() => {
    const frames: { nav: boolean; opacity: number | null; at: number }[] = []
    const navSince: { at: number | null; ended: boolean } = { at: null, ended: false }
    new MutationObserver(() => {
      const on = document.documentElement.dataset.nav !== undefined
      if (!on && navSince.at !== null) navSince.ended = true
      navSince.at = on ? performance.now() : null
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-nav'] })
    const look = () => {
      const list = document.querySelector('section.list')
      frames.push({
        nav: document.documentElement.dataset.nav !== undefined,
        opacity: list ? Number(getComputedStyle(list).opacity) : null,
        at: performance.now(),
      })
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
    Object.assign(window, { frames, navSince })
  })
  // The answer is held until 850 ms of the move's second have gone: it comes at the very end, within
  // the 220 ms of `appear` before the move is over.
  await page.route('**/api/sessions', async (route) => {
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const { at, ended } = (
              window as unknown as { navSince: { at: number | null; ended: boolean } }
            ).navSince
            // Let go once the move is over too: the test must fail, not hang.
            return ended || (at !== null && performance.now() - at > 850)
          }),
        { intervals: [5] },
      )
      .toBe(true)
    await route.continue()
  })

  await page.getByRole('link', { name: 'Устройства', exact: true }).click()
  await expect(page.locator('section.list')).toBeVisible()
  await page.waitForTimeout(1200)

  const frames = await page.evaluate(
    () => (window as unknown as { frames: { nav: boolean; opacity: number | null }[] }).frames,
  )
  // Never dimmer than a frame before: shown during the move it stays shown, and an answer come after
  // it fades in once. The defect was shown whole, then dimmed to half and come in again. A run where
  // the answer came after the move proves less, never wrongly: the end-of-move cut is held exactly
  // by `transitions.test.ts`.
  const seen = frames.flatMap((frame) => (frame.opacity === null ? [] : [frame.opacity]))
  expect(seen.length).toBeGreaterThan(0)
  const dimmed = seen.some(
    (opacity, index) => index > 0 && opacity < (seen[index - 1] ?? 0) - 0.001,
  )
  expect(dimmed).toBe(false)
})

test('a move back the browser shows itself plays no arrival after it (А5)', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(PopStateEvent.prototype, 'hasUAVisualTransition', { get: () => true })
  })
  await signedIn(page)
  await page.getByRole('link', { name: 'Настройки', exact: true }).click()
  await page.getByRole('link', { name: 'Устройства', exact: true }).click()
  await expect(page.locator('section.list')).toBeVisible()
  await page.waitForTimeout(600)

  // When the mark of the browser's move comes and goes, by the animations' own clock.
  await page.evaluate(() => {
    const move: { marked: boolean; over: number | null } = { marked: false, over: null }
    new MutationObserver(() => {
      if (document.documentElement.dataset.nav === 'browser') move.marked = true
      else if (move.marked && move.over === null) move.over = Number(document.timeline.currentTime)
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-nav'] })
    Object.assign(window, { move })
  })
  await page.goBack()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Настройки')
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.nav ?? null))
    .toBeNull()
  // Only what the screen put in during the browser's move: an answer come after it fades in, as
  // anything that comes does.
  const arrival = await page.evaluate(() => {
    const { marked, over } = (window as unknown as { move: { marked: boolean; over: number } }).move
    return {
      marked,
      running: document.getAnimations().filter(
        (animation): animation is CSSAnimation =>
          animation instanceof CSSAnimation &&
          animation.animationName === 'appear' &&
          animation.playState === 'running' &&
          // Begun in the very frame the mark went is after it: a float a hair below it too.
          Number(animation.startTime) < over - 1 &&
          Number(animation.effect?.getComputedTiming().duration) > 0,
      ).length,
    }
  })
  expect(arrival.marked).toBe(true)
  expect(arrival.running).toBe(0)
})

/**
 * The iOS keyboard, as `money.spec.ts` stands in for it: the keys cover the bottom `covered` px.
 */
async function fakeKeyboard(page: Page): Promise<(covered: number) => Promise<void>> {
  await page.addInitScript(() => {
    const events = new EventTarget()
    const state = { covered: 0 }
    const viewport = {
      get height() {
        return window.innerHeight - state.covered
      },
      get width() {
        return window.innerWidth
      },
      get offsetTop() {
        return state.covered
      },
      get pageTop() {
        return window.scrollY + state.covered
      },
      offsetLeft: 0,
      pageLeft: 0,
      scale: 1,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    }
    Object.defineProperty(window, 'visualViewport', { get: () => viewport, configurable: true })
    Object.assign(window, {
      keyboard(covered: number) {
        state.covered = covered
        events.dispatchEvent(new Event('resize'))
        events.dispatchEvent(new Event('scroll'))
      },
    })
  })
  return async (covered) => {
    await page.evaluate((c) => {
      ;(window as unknown as { keyboard: (c: number) => void }).keyboard(c)
    }, covered)
  }
}

test('a field tapped in an open sheet: its top does not drop before the keys come (А6)', async ({
  page,
}) => {
  const keyboard = await fakeKeyboard(page)
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
  const { decimal, text } = await page.evaluate(() => {
    const kept = {
      [`decimal ${String(innerHeight)}x${String(innerWidth)}`]: Math.round(innerHeight * 0.55),
      [`text ${String(innerHeight)}x${String(innerWidth)}`]: Math.round(innerHeight * 0.5),
    }
    localStorage.setItem('molvia.keyboard', JSON.stringify(kept))
    return {
      decimal: innerHeight - Math.round(innerHeight * 0.55),
      text: innerHeight - Math.round(innerHeight * 0.5),
    }
  })

  await page.getByRole('button', { name: 'Добавить трату' }).click()
  const sheet = page.locator('dialog[open]')
  await expect(sheet.getByLabel('Сумма')).toBeFocused()
  await page.waitForTimeout(400)
  await keyboard(decimal)
  await page.waitForTimeout(200)
  // «✓» over the keys: the field lets the focus go, the keys go down.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await keyboard(0)
  await page.waitForTimeout(300)
  const rest = await sheet.evaluate((dialog) => Math.round(dialog.getBoundingClientRect().top))

  await page.evaluate(() => {
    const tops: number[] = []
    const look = () => {
      const dialog = document.querySelector('dialog[open]')
      if (dialog) tops.push(Math.round(dialog.getBoundingClientRect().top))
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
    Object.assign(window, { tops })
  })
  await sheet.getByLabel(/Что это/).tap()
  // The page's second keyboard: 128–212 ms after the focus on the owner's iPhone.
  await page.waitForTimeout(150)
  const beforeKeys = await page.evaluate(() => [...(window as unknown as { tops: number[] }).tops])
  await keyboard(text)
  await page.waitForTimeout(200)
  const landed = await sheet.evaluate((dialog) => Math.round(dialog.getBoundingClientRect().top))

  expect(beforeKeys.length).toBeGreaterThan(3)
  expect(Math.max(...beforeKeys)).toBeLessThanOrEqual(rest)
  expect(landed).toBeLessThanOrEqual(rest)
})
