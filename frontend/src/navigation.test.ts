import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { createRouter, createWebHistory, RouterView } from 'vue-router'
import type { Router } from 'vue-router'
import { createAppI18n } from '@/i18n'
import { backMove, settleColdStart, tabMove } from '@/navigation'
import type { TabMove } from '@/navigation'
import type { RouteName, Tab } from '@/router'
import { routes } from '@/router'
import TabBar from '@/components/TabBar.vue'

// «What to buy» still asks the server whether it is up; here nothing needs the answer.
vi.mock('@/api', () => ({ api: { health: () => new Promise(() => undefined) } }))

describe('tabMove — «Trip» is home', () => {
  it.each<[Tab, Tab, RouteName | undefined, TabMove]>([
    // Leaving home pushes, so «back» returns to it.
    ['trip', 'advice', undefined, 'push'],
    ['trip', 'verdicts', 'advice', 'push'],
    // Between the other sections nothing piles up.
    ['advice', 'verdicts', 'trip', 'replace'],
    ['verdicts', 'advice', 'trip', 'replace'],
    ['advice', 'verdicts', undefined, 'replace'],
    // Home again is a step back — when home is the entry underneath.
    ['advice', 'trip', 'trip', 'back'],
    ['verdicts', 'trip', 'trip', 'back'],
    // Opened cold on a section: home is not underneath, and a step back would leave the app.
    ['verdicts', 'trip', undefined, 'replace'],
    ['advice', 'trip', 'verdicts', 'replace'],
    // The section already open scrolls to its top.
    ['trip', 'trip', undefined, 'top'],
    ['advice', 'advice', 'trip', 'top'],
  ])('%s → %s with %s underneath: %s', (from, to, below, move) => {
    expect(tabMove(from, to, below)).toBe(move)
  })
})

describe('backMove — the chevron agrees with the system button', () => {
  it('steps back when the parent is underneath', () => {
    expect(backMove('trip', 'trip')).toBe('back')
  })

  it.each<RouteName | undefined>([undefined, 'advice', 'verdicts'])(
    'replaces onto the parent when %s is underneath, never leaving the app',
    (below) => {
      expect(backMove('trip', below)).toEqual({ replace: 'trip' })
    },
  )
})

/**
 * A web history, not a memory one: the entry underneath is what `history.state.back` says, and
 * only the web history writes it. The document's own state is cleared first — the history of
 * the test runner's window outlives each test, and a stale `back` would read as ours.
 */
async function fresh(path: string): Promise<Router> {
  window.history.replaceState(null, '', path)
  const router = createRouter({ history: createWebHistory(), routes })
  await router.push(path)
  await router.isReady()
  return router
}

async function openCold(path: string): Promise<Router> {
  const router = await fresh(path)
  await settleColdStart(router)
  return router
}

async function stepBack(router: Router): Promise<string> {
  const before = router.currentRoute.value.fullPath
  router.back()
  await vi.waitFor(() => {
    expect(router.currentRoute.value.fullPath).not.toBe(before)
  })
  return router.currentRoute.value.fullPath
}

describe('settleColdStart', () => {
  it('lays the parent underneath a nested screen opened cold', async () => {
    const router = await openCold('/trip/add')
    expect(router.currentRoute.value.fullPath).toBe('/trip/add')
    expect(router.options.history.state.back).toBe('/')
    expect(await stepBack(router)).toBe('/')
  })

  it('lays the full chain under a cold history search, keeping the trip id', async () => {
    const id = 'aaaaaaaa-0000-4000-8000-000000000012'
    const router = await openCold(`/trip/history/${id}/add`)
    expect(await stepBack(router)).toBe(`/trip/history/${id}`)
    expect(await stepBack(router)).toBe('/trip/history')
    expect(await stepBack(router)).toBe('/')
  })

  it.each(['/', '/advice', '/verdicts'])('leaves the section %s alone', async (path) => {
    const router = await openCold(path)
    expect(router.currentRoute.value.fullPath).toBe(path)
    expect(router.options.history.state.back).toBeNull()
  })

  // A reload keeps the history state: the parent is already there and must not be doubled.
  it('adds nothing when the parent is already underneath', async () => {
    const router = await fresh('/')
    await router.push('/trip/add')
    const push = vi.spyOn(router, 'push')
    const replace = vi.spyOn(router, 'replace')
    await settleColdStart(router)
    expect(push).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('the tab bar walks the history as В-2 decided', () => {
  async function app(path: string) {
    const router = await fresh(path)
    const view = mount(
      defineComponent(() => () => [h(RouterView), h(TabBar)]),
      { global: { plugins: [router, createPinia(), createAppI18n('en')] } },
    )
    const tap = async (index: number): Promise<void> => {
      await view.findAll('.tab')[index]?.trigger('click', { button: 0 })
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return { router, tap }
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // The trip is the trip whatever its address carries: a query from a shared link, a hash.
  it.each(['/?utm_source=telegram', '/#top'])(
    'arrived at %s: What to buy → Trip is still the step back',
    async (entry) => {
      const { router, tap } = await app(entry)
      await tap(1)
      expect(router.currentRoute.value.name).toBe('advice')
      const back = vi.spyOn(router, 'go')
      await tap(0)
      await vi.waitFor(() => {
        expect(router.currentRoute.value.name).toBe('trip')
      })
      expect(back).toHaveBeenCalledExactlyOnceWith(-1)
      expect(router.options.history.state.back).toBeNull()
    },
  )

  // Two taps before the history moves: the second must not step past the trip, out of the app.
  it('two taps on Trip in one go take one step back', async () => {
    const { router } = await app('/')
    await router.push('/advice')
    const view = mount(TabBar, {
      global: { plugins: [router, createPinia(), createAppI18n('en')] },
    })
    const back = vi.spyOn(router, 'go')
    const trip = view.findAll('.tab')[0]
    void trip?.trigger('click', { button: 0 })
    void trip?.trigger('click', { button: 0 })
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('trip')
    })
    expect(back).toHaveBeenCalledExactlyOnceWith(-1)
  })

  it('two taps on the chevron in one go take one step back', async () => {
    const router = await fresh('/')
    await router.push('/trip/add')
    const view = mount(
      defineComponent(() => () => h(RouterView)),
      { global: { plugins: [router, createPinia(), createAppI18n('en')] } },
    )
    const back = vi.spyOn(router, 'go')
    const chevron = view.get('.back')
    void chevron.trigger('click')
    void chevron.trigger('click')
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('trip')
    })
    expect(back).toHaveBeenCalledExactlyOnceWith(-1)
  })

  // The example the owner answered: Trip → What to buy → Ratings, then «back».
  it('Trip → What to buy → Ratings, back → Trip', async () => {
    const { router, tap } = await app('/')
    await tap(1)
    expect(router.currentRoute.value.name).toBe('advice')
    await tap(2)
    expect(router.currentRoute.value.name).toBe('verdicts')
    expect(router.options.history.state.back).toBe('/')
    expect(await stepBack(router)).toBe('/')
    expect(router.options.history.state.back).toBeNull()
  })

  it('a tap on Trip from another section is that same step back', async () => {
    const { router, tap } = await app('/')
    await tap(1)
    await tap(2)
    await tap(0)
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('trip')
    })
    expect(router.options.history.state.back).toBeNull()
  })

  it('a tap on the open section scrolls to the top and writes nothing', async () => {
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const { router, tap } = await app('/advice')
    const push = vi.spyOn(router, 'push')
    const replace = vi.spyOn(router, 'replace')
    await tap(1)
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }))
    expect(push).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  // A modified click opens the link the browser's way; the app does not take it over. The
  // document stops the browser's own navigation here only because the test runner has no
  // second window to open.
  it('leaves a modified click to the browser', async () => {
    const { router } = await app('/')
    const push = vi.spyOn(router, 'push')
    let takenOver: boolean | undefined
    const stop = (event: Event): void => {
      takenOver = event.defaultPrevented
      event.preventDefault()
    }
    document.addEventListener('click', stop)
    const view = mount(TabBar, {
      global: { plugins: [router, createPinia(), createAppI18n('en')] },
      attachTo: document.body,
    })
    await view.findAll('.tab')[1]?.trigger('click', { button: 0, ctrlKey: true })
    document.removeEventListener('click', stop)
    view.unmount()
    expect(takenOver).toBe(false)
    expect(push).not.toHaveBeenCalled()
  })
})
