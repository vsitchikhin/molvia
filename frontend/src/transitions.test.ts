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
import { direction, installArrival, installViewTransitions } from '@/transitions'

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
    ['/', '/trip/add', 'push'],
    ['/trip/add', '/', 'pop'],
    ['/', '/advice', 'tab'],
    ['/verdicts', '/', 'tab'],
    ['/advice', '/verdicts', 'tab'],
    // A finished trip opened from «Деньги» is pushed from there and popped back (MOL-82, С-3).
    [
      '/money?month=2026-08',
      '/trip/history/aaaaaaaa-0000-4000-8000-000000000012?from=money',
      'push',
    ],
    ['/trip/history/aaaaaaaa-0000-4000-8000-000000000012?from=money', '/money', 'pop'],
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
    expect(await between('/money?month=2026-08', '/advice')).toBe('tab')
  })
})

describe('installViewTransitions', () => {
  beforeEach(() => {
    reduceMotion(false)
  })

  it('moves without an animation where the platform has none', async () => {
    const router = routerAt()
    installViewTransitions(router)
    await router.push('/')
    await router.push('/trip/add')
    expect(router.currentRoute.value.name).toBe('item-search')
    expect(document.documentElement.dataset.nav).toBeUndefined()
  })

  it('names the direction on <html> for the length of the transition, then clears it', async () => {
    const { start, calls } = stubViewTransitions()
    const router = routerAt()
    installViewTransitions(router)
    await router.push('/')
    expect(start).not.toHaveBeenCalled()

    await router.push('/trip/add')
    expect(router.currentRoute.value.name).toBe('item-search')
    await router.push('/')
    await router.push('/advice')
    expect(calls).toEqual(['push', 'pop', 'tab'])
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
    await router.push('/')
    await router.push('/trip/add')
    await router.push('/')
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
    await router.push('/')
    await router.push('/trip/add')
    start.mockClear()

    const event = new PopStateEvent('popstate', { state: null })
    Object.defineProperty(event, 'hasUAVisualTransition', { value: true })
    window.dispatchEvent(event)
    await router.push('/')
    expect(start).not.toHaveBeenCalled()

    // Only that one move: the next is animated again.
    await router.push('/trip/add')
    expect(start).toHaveBeenCalledOnce()
  })

  it('does not animate at all when motion is reduced', async () => {
    reduceMotion(true)
    const { start } = stubViewTransitions()
    const router = routerAt()
    installViewTransitions(router)
    await router.push('/')
    await router.push('/trip/add')
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
    expect(document.title).toBe(`${en.trip.title} · ${en.app.name}`)
    view.unmount()
  })

  it('renames the tab and puts focus on the new heading after a move', async () => {
    const { router, view } = await app()
    await router.push('/trip/add')
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
