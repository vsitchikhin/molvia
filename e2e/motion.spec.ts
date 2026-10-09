import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import { actorCodec, settingsOf } from '@molvia/model'
import { asBrowser, signedIn } from './session'

// Motion as it is (MOL-151): what must not move does not, and what moves does it once. Born of the
// adversarial review of MOL-151 (А1–А5, Б1–Б6), each turned the other way round. А6 — a sheet's top lower
// before a later keyboard — is not held here: Chromium draws every frame, the iPhone one at most
// (adversarial round 2, У2), and the rule names the price.
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

/**
 * Waits for what moves rather than for a clock (review №8): the move between screens over and every
 * animation running in the page played out. A paused one — held on purpose by a test — is not
 * waited for. Where a test asks that nothing moves, there is nothing to wait for but the moment it
 * would have, and those waits stay what they are.
 */
async function settled(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.nav ?? null))
    .toBeNull()
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            Number(animation.effect?.getComputedTiming().endTime) !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  )
}

/**
 * Presses in a sheet once it takes the press: until it is up it takes none, for the floor of a
 * double tap after it opened (MOL-69) — a clock of the product, so pressed again rather than waited.
 */
async function pressInSheet(press: () => Promise<void>, took: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await press()
    await took()
  }).toPass({ intervals: [100] })
}

/** The month read again after the queue's answer: the last thing a removal changes. */
function reread(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      /\/api\/money\/months\/[^/]+$/.test(new URL(response.url()).pathname),
  )
}

/** «Деньги», then its journal «Траты» (MOL-159): the rows a test watches live there. */
async function openSpendings(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: /^Траты/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Траты')
}

function yerevanDay(days = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yerevan' }).format(
    new Date(Date.now() + days * 86_400_000),
  )
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
  await openSpendings(page)
  await expect(page.getByRole('button', { name: /Открыть трату/ })).toHaveCount(1)
}

async function toLastMonth(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
  await expect(page.getByRole('button', { name: /Открыть трату/ })).toHaveCount(2)
  await settled(page)
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
  await settled(page)

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
  await settled(page)
  const read = reread(page)
  await pressInSheet(
    () => sheet.getByRole('button', { name: 'Удалить трату' }).click(),
    () => expect(sheet).toBeHidden({ timeout: 300 }),
  )
  await read
  await settled(page)

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
    // The line of the month's count and sum heads the days on «Траты» (MOL-159), over their column
    // (MOL-184).
    const caption = document.querySelector<HTMLElement>('.content > .total')
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
  expect(jump.gap).toBe('24px')
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
  await settled(page)
  const read = reread(page)
  await pressInSheet(
    () => sheet.getByRole('button', { name: 'Удалить трату' }).click(),
    () => expect(sheet).toBeHidden({ timeout: 300 }),
  )
  await read
  await settled(page)

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
  await settled(page)
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
  await settled(page)

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
  await settled(page)

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

test('a spending removed while its month was being read does not come back with that read (Б1)', async ({
  page,
}) => {
  await seed(page)
  await toLastMonth(page)
  await page.getByRole('button', { name: 'Следующий месяц' }).click()
  await expect(page.getByRole('button', { name: /Открыть трату/ })).toHaveCount(1)

  // The month the phone keeps comes from its memory at once; the read of it is on a slow network:
  // the server reads it now, the phone has the answer seconds later — after the removal landed.
  const september = lastMonthDay(15).slice(0, 7)
  let slow = true
  await page.route(`**/api/money/months/${september}*`, async (route) => {
    const response = await route.fetch()
    if (slow) {
      slow = false
      await new Promise((done) => setTimeout(done, 2500))
    }
    await route.fulfill({ response })
  })
  const months = (n: number) => {
    let left = n
    return page.waitForResponse((response) => {
      if (!new URL(response.url()).pathname.endsWith(`/money/months/${september}`)) return false
      left -= 1
      return left === 0
    })
  }
  const both = months(2)
  await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
  await page.getByRole('button', { name: /Открыть трату: Пятнадцатое/ }).click()
  const sheet = page.locator('dialog[open]')
  await settled(page)
  // Every frame: whether the 15th stands in the list — not the day going, which is inert.
  await page.evaluate(() => {
    const seen: boolean[] = []
    const look = () => {
      seen.push(
        [...document.querySelectorAll<HTMLElement>('section.day')].some(
          (day) => !day.inert && day.innerText.includes('Пятнадцатое'),
        ),
      )
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
    Object.assign(window, { seen })
  })
  await pressInSheet(
    () => sheet.getByRole('button', { name: 'Удалить трату' }).click(),
    () => expect(sheet).toBeHidden({ timeout: 300 }),
  )
  await both
  await settled(page)

  const seen = await page.evaluate(() => (window as unknown as { seen: boolean[] }).seen)
  const gone = seen.indexOf(false)
  expect(gone).toBeGreaterThanOrEqual(0)
  expect(seen.slice(gone)).not.toContain(true)
})

test('a block going from a field takes the field’s gap with it: nothing below jumps (Б2)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const held: { target: Element; animation: Animation }[] = []
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called through .call(this)
    const original = Element.prototype.animate
    Element.prototype.animate = function (this: Element, frames, options) {
      const animation = original.call(this, frames, options)
      const first = (frames as Keyframe[] | null)?.[0]
      // The line going is held a moment before its end, where it is no height and still there.
      if (this.matches('p.conversion') && first?.height !== '0px') {
        const end = Number(animation.effect?.getComputedTiming().endTime ?? 0)
        animation.pause()
        animation.currentTime = end - 0.01
        held.push({ target: this, animation })
      }
      return animation
    }
    Object.assign(window, { held })
  })
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  const sheet = page.locator('dialog[open]')
  await settled(page)
  await pressInSheet(
    () => sheet.locator('label.segment', { hasText: 'Доллары' }).click(),
    () => expect(sheet.getByRole('radio', { name: 'Доллары' })).toBeChecked({ timeout: 300 }),
  )
  await sheet.getByLabel('Сумма').fill('10')
  await expect(sheet.locator('p.conversion')).toBeVisible()
  await settled(page)
  await sheet.getByLabel('Сумма').fill('')
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { held: unknown[] }).held.length))
    .toBe(1)

  const jump = await page.evaluate(async () => {
    const { target, animation } = (
      window as unknown as { held: { target: HTMLElement; animation: Animation }[] }
    ).held[0] as { target: HTMLElement; animation: Animation }
    const field = target.parentElement
    const below = field?.nextElementSibling
    if (!field || !(below instanceof HTMLElement)) throw new Error('no field or nothing below it')
    const distance = () => below.getBoundingClientRect().top - field.getBoundingClientRect().top
    const before = distance()
    animation.play()
    await animation.finished
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    return { removed: !target.isConnected, moved: before - distance() }
  })
  expect(jump.removed).toBe(true)
  expect(Math.abs(jump.moved)).toBeLessThan(1)
})

test('the swipe back from an account opened from «Счета» plays no arrival (Б3)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(PopStateEvent.prototype, 'hasUAVisualTransition', { get: () => true })
  })
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  // The card of accounts left «Деньги» for «Счета» (MOL-159).
  await page.getByRole('link', { name: /^Счета/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Счета')
  await page.getByRole('button', { name: 'Добавить счёт' }).click()
  const sheet = page.locator('dialog[open]').last()
  await expect(sheet).toContainText('Новый счёт')
  await settled(page)
  await sheet.getByLabel('Имя').fill('Наличные')
  await sheet.getByLabel('Остаток').fill('10000')
  await sheet.getByLabel('На день').fill(yerevanDay(-1))
  // Pressed again only if nothing closed for long: a second «Сохранить» that went through would make
  // a second account.
  await pressInSheet(
    () => sheet.getByRole('button', { name: 'Сохранить' }).click(),
    () => expect(sheet).toBeHidden({ timeout: 5000 }),
  )
  await page
    .getByRole('link', { name: /Наличные/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/money\/accounts\//)
  await settled(page)

  // What is still coming in at the very moment the browser's move is over: put in during it, it
  // must have been cut short; an answer come after it fades in as anything that comes does.
  await page.evaluate(() => {
    const move: { marked: boolean; left: number | null } = { marked: false, left: null }
    new MutationObserver(() => {
      if (document.documentElement.dataset.nav === 'browser') move.marked = true
      else if (move.marked && move.left === null)
        move.left = document
          .getAnimations()
          .filter(
            (animation) =>
              animation instanceof CSSAnimation &&
              animation.animationName === 'appear' &&
              animation.playState === 'running',
          ).length
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-nav'] })
    Object.assign(window, { move })
  })
  await page.goBack()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Счета')
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.nav ?? null))
    .toBeNull()
  const move = await page.evaluate(
    () => (window as unknown as { move: { marked: boolean; left: number | null } }).move,
  )
  expect(move.marked).toBe(true)
  expect(move.left).toBe(0)
})

/** A finished record of «Покупки» with only a receipt sum: a trip line of today in «Траты». */
async function tripWithReceipt(page: Page, place: string): Promise<string> {
  const headers = await asBrowser(page)
  const me = actorCodec.parse(await (await page.request.get('/api/actors/me', { headers })).json())
  const id = randomUUID()
  const started = await page.request.post('/api/trips', {
    headers,
    data: { id, context: settingsOf(me), place: { kind: 'store', name: place } },
  })
  expect(started.status(), await started.text()).toBe(201)
  const receipt = await page.request.put(`/api/trips/${id}/receipt`, {
    headers,
    data: { receipt: { amount: '5000', currency: 'AMD' } },
  })
  expect(receipt.status(), await receipt.text()).toBeLessThan(300)
  const finished = await page.request.post(`/api/trips/${id}/finish`, {
    headers,
    data: { finishedOnDeviceAt: new Date().toISOString() },
  })
  expect(finished.status()).toBe(204)
  return id
}

test('a record of «Покупки» removed from «Траты» does not grow back there (Б4)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const moves: string[] = []
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called through .call(this)
    const original = Element.prototype.animate
    Element.prototype.animate = function (this: Element, frames, options) {
      const animation = original.call(this, frames, options)
      const text = (this as HTMLElement).innerText
      // The record's own line, not the day it shares with a spending.
      if (text.includes('Ереван Сити') && !text.includes('Сегодня'))
        moves.push((frames as Keyframe[] | null)?.[0]?.height === '0px' ? 'grows' : 'shrinks')
      return animation
    }
    Object.assign(window, { moves })
  })
  await signedIn(page)
  const headers = await asBrowser(page)
  const { categories } = (await (
    await page.request.get('/api/spending-categories', { headers })
  ).json()) as { categories: { id: string }[] }
  const spent = await page.request.post('/api/spendings', {
    headers,
    data: {
      id: randomUUID(),
      spentOn: yerevanDay(),
      amount: { amount: '1000', currency: 'AMD' },
      categoryId: categories[0]?.id,
      note: 'Сегодня',
    },
  })
  expect(spent.status()).toBe(201)
  await tripWithReceipt(page, 'Ереван Сити')

  await openSpendings(page)
  const row = page.getByRole('button', { name: /Ереван Сити/ })
  await expect(row).toBeVisible()
  await settled(page)
  await row.click()
  const sheet = page.locator('dialog[open]')
  await pressInSheet(
    () => sheet.getByRole('button', { name: 'Открыть в «Покупках»' }).click(),
    () => expect(page).toHaveURL(/\/purchases\/[0-9a-f-]+\?from=money/, { timeout: 300 }),
  )
  await settled(page)
  await page.evaluate(() => {
    ;(window as unknown as { moves: string[] }).moves.length = 0
  })
  // A slow network: the server removes at once, its answer comes after the move back to «Траты»,
  // and the fresh month after that — until then the month on screen is the one the phone keeps.
  const slow = (ms: number) => async (route: Route) => {
    const response = await route.fetch()
    await new Promise((done) => setTimeout(done, ms))
    await route.fulfill({ response })
  }
  await page.route(
    (url) => /\/api\/trips\/[0-9a-f-]+$/.test(url.pathname),
    async (route) => (route.request().method() === 'DELETE' ? slow(500)(route) : route.fallback()),
  )
  await page.route('**/api/money/months/*', slow(1500))
  const fresh = reread(page)
  await page.getByRole('button', { name: 'Удалить запись' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Траты')
  await fresh
  await settled(page)

  const moves = await page.evaluate(() => (window as unknown as { moves: string[] }).moves)
  expect(moves).toEqual([])
  await expect(row).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Открыть трату: Сегодня/ })).toBeVisible()
  // A read still on its slow way is nothing this test waits for.
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('a spending removed before a read that failed stays gone after a reload (Б5)', async ({
  page,
}) => {
  await signedIn(page)
  const headers = await asBrowser(page)
  const { categories } = (await (
    await page.request.get('/api/spending-categories', { headers })
  ).json()) as { categories: { id: string }[] }
  for (const [amount, note] of [
    ['1500', 'Удаляемая'],
    ['1000', 'Остаётся'],
  ] as const) {
    const response = await page.request.post('/api/spendings', {
      headers,
      data: {
        id: randomUUID(),
        spentOn: yerevanDay(),
        amount: { amount, currency: 'AMD' },
        categoryId: categories[0]?.id,
        note,
      },
    })
    expect(response.status(), await response.text()).toBe(201)
  }
  await openSpendings(page)
  await expect(page.getByRole('button', { name: /Открыть трату/ })).toHaveCount(2)
  await settled(page)

  // From now on every read of the month fails — the signal at the shelf. The removal gets through.
  await page.route('**/api/money/months/**', (route) => route.abort('internetdisconnected'))
  const removed = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' && response.url().includes('/spendings/'),
  )
  await page.getByRole('button', { name: /Открыть трату: Удаляемая/ }).click()
  const sheet = page.locator('dialog[open]')
  await pressInSheet(
    () => sheet.getByRole('button', { name: 'Удалить трату' }).click(),
    () => expect(sheet).toBeHidden({ timeout: 300 }),
  )
  expect((await removed).status()).toBeLessThan(300)
  await expect(page.getByRole('button', { name: /Открыть трату: Удаляемая/ })).toHaveCount(0)

  // The app put away and opened again: the month comes from the phone, and the read of it fails.
  const failed = page.waitForEvent('requestfailed', (request) =>
    request.url().includes('/api/money/months/'),
  )
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Траты')
  await expect(page.getByRole('button', { name: /Открыть трату: Остаётся/ })).toBeVisible()
  await failed
  await expect(page.getByRole('button', { name: /Открыть трату: Удаляемая/ })).toHaveCount(0)
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('a read that set out before a removal does not bring it back after a reload (Б6)', async ({
  page,
}) => {
  await signedIn(page)
  const headers = await asBrowser(page)
  const { categories } = (await (
    await page.request.get('/api/spending-categories', { headers })
  ).json()) as { categories: { id: string }[] }
  for (const [amount, note] of [
    ['1500', 'Удаляемая'],
    ['1000', 'Остаётся'],
  ] as const) {
    const response = await page.request.post('/api/spendings', {
      headers,
      data: {
        id: randomUUID(),
        spentOn: yerevanDay(),
        amount: { amount, currency: 'AMD' },
        categoryId: categories[0]?.id,
        note,
      },
    })
    expect(response.status(), await response.text()).toBe(201)
  }
  await openSpendings(page)
  await expect(page.getByRole('button', { name: /Открыть трату/ })).toHaveCount(2)
  // Last month, so this one comes back from the phone's memory with a read on its way.
  await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
  await expect(page.getByRole('button', { name: /Открыть трату/ })).toHaveCount(0)
  await settled(page)

  // The first read of this month is slow — the server reads it at once, the phone has it after the
  // removal landed, and keeps it; every read after it fails, the signal at the shelf.
  const month = yerevanDay().slice(0, 7)
  let reads = 0
  await page.route(`**/api/money/months/${month}*`, async (route) => {
    reads += 1
    if (reads > 1) {
      await route.abort('internetdisconnected')
      return
    }
    const response = await route.fetch()
    await new Promise((done) => setTimeout(done, 2500))
    await route.fulfill({ response })
  })
  const slowRead = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith(`/money/months/${month}`),
  )
  await page.getByRole('button', { name: 'Следующий месяц' }).click()
  const row = page.getByRole('button', { name: /Открыть трату: Удаляемая/ })
  await row.click()
  const sheet = page.locator('dialog[open]')
  const removed = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' && response.url().includes('/spendings/'),
  )
  await pressInSheet(
    () => sheet.getByRole('button', { name: 'Удалить трату' }).click(),
    () => expect(sheet).toBeHidden({ timeout: 300 }),
  )
  expect((await removed).status()).toBeLessThan(300)
  await slowRead
  await expect(row).toHaveCount(0)

  // The app put away and opened again: the month is the one that slow read left on the phone.
  const failed = page.waitForEvent('requestfailed', (request) =>
    request.url().includes(`/api/money/months/${month}`),
  )
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Траты')
  await expect(page.getByRole('button', { name: /Открыть трату: Остаётся/ })).toBeVisible()
  await failed
  await expect(row).toHaveCount(0)
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})
