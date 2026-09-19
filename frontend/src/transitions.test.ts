import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { defineComponent, h } from 'vue'
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
    return { finished } as unknown as ViewTransition
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
})
