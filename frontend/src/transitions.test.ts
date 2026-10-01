import process from 'node:process'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import type { Router } from 'vue-router'
import en from '@/i18n/en.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import {
  direction,
  installArrival,
  installHeightHold,
  installViewTransitions,
  releaseHeightHold,
} from '@/transitions'

vi.mock('@/api', () => ({ api: { health: () => new Promise(() => undefined) } }))

function routerAt(): Router {
  return createRouter({ history: createMemoryHistory(), routes })
}

function reduceMotion(reduce: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({ matches: reduce && query.includes('reduce') }) as MediaQueryList,
  )
}

/** Records the calls and runs the update the way a browser would: after the snapshot. */
function stubViewTransitions() {
  const calls: string[] = []
  const start = vi.fn((update: () => Promise<void>) => {
    calls.push(document.documentElement.dataset.nav ?? '')
    const finished = Promise.resolve().then(update)
    return { finished, ready: Promise.resolve() } as unknown as ViewTransition
  })
  Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true })
  return { start, calls }
}

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'startViewTransition')
  delete document.documentElement.dataset.nav
})

describe('direction', () => {
  async function between(from: string, to: string) {
    const router = routerAt()
    await router.push(from)
    const a = router.currentRoute.value
    return direction(a, router.resolve(to))
  }

  it.each([
    ['/purchases', '/purchases/manual', 'push'],
    ['/purchases/manual', '/purchases', 'pop'],
    ['/', '/purchases', 'tab'],
    ['/verdicts', '/', 'tab'],
    ['/purchases', '/verdicts', 'tab'],
    // A recorded row opened from «Деньги» is pushed from there and popped back (MOL-82, С-3).
    ['/money?month=2026-08', '/purchases/aaaaaaaa-0000-4000-8000-000000000012?from=money', 'push'],
    ['/purchases/aaaaaaaa-0000-4000-8000-000000000012?from=money', '/money', 'pop'],
  ])('%s → %s is a %s', async (from, to, move) => {
    expect(await between(from, to)).toBe(move)
  })

  it('does not animate the first render', () => {
    const router = routerAt()
    expect(direction(router.currentRoute.value, router.resolve('/'))).toBeNull()
  })

  it('does not animate staying in place', async () => {
    expect(await between('/advice', '/advice')).toBeNull()
  })

  // A month, a period, a category: the screen's own state. The month of «Деньги» cross-faded as a
  // move between tabs, and the second quick tap on «‹» went into the transition (MOL-136, Д).
  it.each([
    ['/money', '/money?month=2026-08'],
    ['/money?month=2026-08', '/money?month=2026-07'],
    ['/money/charts', '/money/charts?period=12'],
  ])('does not animate a change of the query alone: %s → %s', async (from, to) => {
    expect(await between(from, to)).toBeNull()
  })

  it('must not fire: a section with a query to another section is still a tab', async () => {
    expect(await between('/money?month=2026-08', '/verdicts')).toBe('tab')
  })
})

describe('installViewTransitions', () => {
  beforeEach(() => {
    reduceMotion(false)
  })

  it('moves without an animation where the platform has none', async () => {
    const router = routerAt()
    installViewTransitions(router)
    await router.push('/purchases/manual')
    await router.push('/purchases/manual/add')
    expect(router.currentRoute.value.name).toBe('item-search')
    expect(document.documentElement.dataset.nav).toBeUndefined()
  })

  it('names the direction on <html> for the length of the transition, then clears it', async () => {
    const { start, calls } = stubViewTransitions()
    const router = routerAt()
    installViewTransitions(router)
    await router.push('/purchases/manual')
    expect(start).not.toHaveBeenCalled()

    await router.push('/purchases/manual/add')
    expect(router.currentRoute.value.name).toBe('item-search')
    await router.push('/purchases/manual')
    await router.push('/purchases')
    await router.push('/verdicts')
    expect(calls).toEqual(['push', 'pop', 'pop', 'tab'])
    await vi.waitFor(() => {
      expect(document.documentElement.dataset.nav).toBeUndefined()
    })
  })

  // The next transition cuts the running one short: the skipped one rejects `ready` and
  // finishes at once. Neither may leak — no unhandled rejection, and the direction stays with
  // the transition still on screen.
  it('lets a transition cut short go quietly, keeping the direction of the one that follows', async () => {
    const endings: (() => void)[] = []
    const start = vi.fn((update: () => Promise<void>) => {
      const ended = new Promise<void>((resolve) => endings.push(resolve))
      const finished = Promise.resolve()
        .then(update)
        .then(() => ended)
      const ready = Promise.reject(new DOMException('Transition was skipped', 'AbortError'))
      return { finished, ready } as unknown as ViewTransition
    })
    Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true })
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)

    const router = routerAt()
    installViewTransitions(router)
    await router.push('/purchases/manual')
    await router.push('/purchases/manual/add')
    await router.push('/purchases/manual')
    expect(document.documentElement.dataset.nav).toBe('pop')

    // The first, skipped, finishes now — the second is still running.
    endings[0]?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.documentElement.dataset.nav).toBe('pop')

    endings[1]?.()
    await vi.waitFor(() => {
      expect(document.documentElement.dataset.nav).toBeUndefined()
    })
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
  })

  // iOS edge swipe and Android predictive back animate the page themselves.
  it('does not play a pop the browser has already shown', async () => {
    const { start } = stubViewTransitions()
    const router = routerAt()
    installViewTransitions(router)
    await router.push('/purchases/manual')
    await router.push('/purchases/manual/add')
    start.mockClear()

    const event = new PopStateEvent('popstate', { state: null })
    Object.defineProperty(event, 'hasUAVisualTransition', { value: true })
    window.dispatchEvent(event)
    await router.push('/purchases/manual')
    expect(start).not.toHaveBeenCalled()

    // Only that one move: the next is animated again.
    await router.push('/purchases/manual/add')
    expect(start).toHaveBeenCalledOnce()
  })

  // A CSS animation of no length comes back half-way through once its length is back: what the
  // screen put in during the move faded in a second time after it (adversarial А4).
  it('cuts short at the end of a move what began to appear during it, and nothing else', async () => {
    class FakeCSSAnimation {
      constructor(
        readonly animationName: string,
        readonly startTime: number,
      ) {}
      cancel = vi.fn()
    }
    vi.stubGlobal('CSSAnimation', FakeCSSAnimation)
    const clock = { now: 100 }
    Object.defineProperty(document, 'timeline', {
      value: {
        get currentTime() {
          return clock.now
        },
      },
      configurable: true,
    })
    const during = new FakeCSSAnimation('appear', 150)
    const before = new FakeCSSAnimation('appear', 50)
    const other = new FakeCSSAnimation('pulse', 150)
    Object.defineProperty(document, 'getAnimations', {
      value: () => [during, before, other],
      configurable: true,
    })
    stubViewTransitions()
    const router = routerAt()
    installViewTransitions(router)
    await router.push('/purchases/manual')
    await router.push('/purchases/manual/add')
    await vi.waitFor(() => {
      expect(document.documentElement.dataset.nav).toBeUndefined()
    })
    expect(during.cancel).toHaveBeenCalledOnce()
    expect(before.cancel).not.toHaveBeenCalled()
    expect(other.cancel).not.toHaveBeenCalled()
    Reflect.deleteProperty(document, 'getAnimations')
    Reflect.deleteProperty(document, 'timeline')
  })

  // What the screen puts in while the browser shows the move must not fade in after it — the
  // arrival a second time (adversarial А5): the move is marked for its render, then let go.
  it('marks a move the browser shows itself for its render alone', async () => {
    stubViewTransitions()
    const router = routerAt()
    installViewTransitions(router)
    await router.push('/purchases/manual')
    await router.push('/purchases/manual/add')
    const seen: (string | undefined)[] = []
    router.afterEach(() => {
      seen.push(document.documentElement.dataset.nav)
    })

    const event = new PopStateEvent('popstate', { state: null })
    Object.defineProperty(event, 'hasUAVisualTransition', { value: true })
    window.dispatchEvent(event)
    await router.push('/purchases/manual')
    expect(seen).toEqual(['browser'])
    await vi.waitFor(() => {
      expect(document.documentElement.dataset.nav).toBeUndefined()
    })
  })

  it('does not animate at all when motion is reduced', async () => {
    reduceMotion(true)
    const { start } = stubViewTransitions()
    const router = routerAt()
    installViewTransitions(router)
    await router.push('/purchases/manual')
    await router.push('/purchases/manual/add')
    expect(start).not.toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('item-search')
  })
})

describe('installArrival', () => {
  async function app() {
    const router = routerAt()
    await router.push('/')
    const i18n = createAppI18n('en')
    installArrival(router, (key) => i18n.global.t(key))
    const view = mount(
      defineComponent(() => () => h(RouterView)),
      { global: { plugins: [router, createPinia(), i18n] }, attachTo: document.body },
    )
    return { router, view }
  }

  it('names the tab after the screen from the start', async () => {
    const { view } = await app()
    expect(document.title).toBe(`${en.advice.title} · ${en.app.name}`)
    view.unmount()
  })

  it('renames the tab and puts focus on the new heading after a move', async () => {
    const { router, view } = await app()
    await router.push('/purchases/manual/add')
    await vi.waitFor(() => {
      expect(document.activeElement?.tagName).toBe('H1')
    })
    expect(document.activeElement?.textContent).toBe(en.item.search_title)
    expect(document.title).toBe(`${en.item.search_title} · ${en.app.name}`)
    view.unmount()
  })
  // A sheet lays an entry at the same address and «back» takes it away. The router calls that a
  // move; nothing on the screen moved, and the button that opened the sheet keeps the focus.
  it('leaves focus and the title alone when «back» stays on the same address', async () => {
    const { router, view } = await app()
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    document.title = 'untouched'

    router.options.history.push('/', { sheet: true })
    const landed = new Promise<void>((resolve) => {
      const stop = router.afterEach(() => {
        stop()
        resolve()
      })
    })
    router.back()
    await landed
    await nextTick()

    expect(document.activeElement).toBe(opener)
    expect(document.title).toBe('untouched')
    opener.remove()
    view.unmount()
  })

  // The arrow of the month keeps the focus: taken to the heading, the second Enter on «‹» went into
  // the title and the month moved once (MOL-136, adversarial Ф).
  it('leaves focus and the title alone when only the query changes', async () => {
    const { router, view } = await app()
    const arrow = document.createElement('button')
    document.body.append(arrow)
    arrow.focus()
    document.title = 'untouched'

    await router.replace({ query: { month: '2026-08' } })
    await nextTick()
    await router.replace({ query: { month: '2026-07' } })
    await nextTick()

    expect(router.currentRoute.value.fullPath).toBe('/?month=2026-07')
    expect(document.activeElement).toBe(arrow)
    expect(document.title).toBe('untouched')
    arrow.remove()
    view.unmount()
  })
})

describe('installHeightHold', () => {
  const hold = () => document.documentElement.style.getPropertyValue('--page-hold')
  let screen: HTMLElement

  /** The window at `scrollY` and `innerHeight`, over a screen ending at `bottom` on the page. */
  function geometry(scrollY: number, innerHeight: number, bottom: number): void {
    vi.stubGlobal('scrollY', scrollY)
    vi.stubGlobal('innerHeight', innerHeight)
    screen.getBoundingClientRect = () => ({ bottom: bottom - scrollY }) as DOMRect
  }

  async function held(start = '/money') {
    const router = routerAt()
    installHeightHold(router)
    await router.push(start)
    return router
  }

  beforeEach(() => {
    const app = document.createElement('div')
    app.id = 'app'
    screen = document.createElement('div')
    // The tab bar floats over the screen at the bottom of the window: not where the screen ends.
    const tabs = document.createElement('nav')
    tabs.style.position = 'fixed'
    tabs.getBoundingClientRect = () => ({ bottom: 10_000 }) as DOMRect
    app.append(screen, tabs)
    document.body.append(app)
    geometry(400, 800, 2000)
  })

  afterEach(() => {
    // Takes the scroll listener of this test's hold away with it: left, it answered the next test's
    // scrolls for a router already gone (review С-4).
    releaseHeightHold()
    document.getElementById('app')?.remove()
  })

  it('holds the page down to the bottom of the window when only the query changes', async () => {
    const router = await held()
    await router.replace({ query: { month: '2026-08' } })
    expect(hold()).toBe('1200px')
  })

  it('holds from where the window is at each change', async () => {
    const router = await held()
    await router.replace({ query: { month: '2026-08' } })
    geometry(250, 800, 1400)
    await router.replace({ query: { month: '2026-07' } })
    expect(hold()).toBe('1050px')
  })

  it('is not set by the first navigation, a move to another screen, or the same address', async () => {
    const router = await held('/money?month=2026-08')
    expect(hold()).toBe('')

    await router.push('/money/charts')
    expect(hold()).toBe('')

    // A sheet put away by «back»: the same address, nothing on the screen redrawn.
    router.options.history.push('/money/charts', { sheet: true })
    const landed = new Promise<void>((resolve) => {
      const stop = router.afterEach(() => {
        stop()
        resolve()
      })
    })
    router.back()
    await landed
    expect(hold()).toBe('')
  })

  it('stays while the empty room is in view, and goes once the window is within the screen', async () => {
    const router = await held()
    await router.replace({ query: { month: '2026-08' } })

    // The skeleton: the screen ends at 900, the window at 1200.
    geometry(400, 800, 900)
    window.dispatchEvent(new Event('scroll'))
    expect(hold()).toBe('1200px')

    geometry(100, 800, 900)
    window.dispatchEvent(new Event('scroll'))
    expect(hold()).toBe('')
  })

  it('goes once a longer answer reaches below the window, at the next scroll', async () => {
    const router = await held()
    await router.replace({ query: { period: '12' } })
    geometry(401, 800, 2400)
    window.dispatchEvent(new Event('scroll'))
    expect(hold()).toBe('')
  })

  it('goes when the login takes the screen, with no move of the router', async () => {
    const router = await held()
    await router.replace({ query: { month: '2026-08' } })
    releaseHeightHold()
    expect(hold()).toBe('')
    geometry(400, 800, 900)
    window.dispatchEvent(new Event('scroll'))
    expect(hold()).toBe('')
  })

  it('goes with a move to another screen, and stays when that move failed', async () => {
    const router = await held()
    await router.replace({ query: { month: '2026-08' } })
    const refuse = router.beforeEach((to) => to.path !== '/money/charts')
    await router.push('/money/charts')
    expect(hold()).toBe('1200px')

    refuse()
    await router.push('/money/charts')
    expect(hold()).toBe('')
  })
})
