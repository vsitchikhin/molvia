import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { createRouter, createWebHistory, RouterView } from 'vue-router'
import type { Router } from 'vue-router'
import { createAppI18n } from '@/i18n'
import {
  afterStep,
  backTarget,
  settleColdStart,
  stepBack as step,
  tabMove,
  upTarget,
} from '@/navigation'
import type { TabMove } from '@/navigation'
import type { RouteName, Tab } from '@/router'
import { routes } from '@/router'
import TabBar from '@/components/TabBar.vue'

// «What to buy» still asks the server whether it is up; here nothing needs the answer.
vi.mock('@/api', () => ({ api: { health: () => new Promise(() => undefined) } }))

describe('tabMove — «Что брать» is home (MOL-128)', () => {
  it.each<[Tab, Tab, RouteName | undefined, TabMove]>([
    // Leaving home pushes, so «back» returns to it.
    ['advice', 'purchases', undefined, 'push'],
    ['advice', 'verdicts', 'purchases', 'push'],
    // Between the other sections nothing piles up.
    ['purchases', 'verdicts', 'advice', 'replace'],
    ['verdicts', 'purchases', 'advice', 'replace'],
    ['purchases', 'verdicts', undefined, 'replace'],
    // Home again is a step back — when home is the entry underneath.
    ['purchases', 'advice', 'advice', 'back'],
    ['verdicts', 'advice', 'advice', 'back'],
    // Opened cold on a section: home is not underneath, and a step back would leave the app.
    ['verdicts', 'advice', undefined, 'replace'],
    ['purchases', 'advice', 'verdicts', 'replace'],
    // The section already open scrolls to its top.
    ['advice', 'advice', undefined, 'top'],
    ['purchases', 'purchases', 'advice', 'top'],
  ])('%s → %s with %s underneath: %s', (from, to, below, move) => {
    expect(tabMove(from, to, below)).toBe(move)
  })
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

describe('backTarget — the chevron agrees with the system button', () => {
  const TRIP = 'aaaaaaaa-0000-4000-8000-000000000012'
  const target = (router: Router) => {
    const found = backTarget(router, router.currentRoute.value)
    return found && { path: found.location.path, step: found.step }
  }

  it('steps back when the parent is underneath', async () => {
    const router = await fresh('/purchases')
    await router.push('/purchases/manual')
    expect(target(router)).toEqual({ path: '/purchases', step: true })
  })

  it('replaces onto the parent when nothing of ours is underneath, never leaving the app', async () => {
    const router = await fresh('/purchases/manual')
    expect(target(router)).toEqual({ path: '/purchases', step: false })
  })

  it('replaces onto the parent over a screen that is not an ancestor', async () => {
    const router = await fresh('/verdicts')
    await router.push(`/purchases/${TRIP}`)
    expect(target(router)).toEqual({ path: '/purchases', step: false })
  })

  // A screen opened from further up than its parent goes back there — both «back»s (MOL-77).
  it('steps back onto an ancestor further up: «Покупки» under the search of a record', async () => {
    const router = await fresh('/purchases')
    await router.push('/purchases/manual/add')
    expect(target(router)).toEqual({ path: '/purchases', step: true })
    expect(backTarget(router, router.currentRoute.value)?.location.meta.titleKey).toBe(
      'purchases.title',
    )
  })

  it('opened from «Покупки», a recorded row goes back to «Покупки»', async () => {
    const router = await fresh('/purchases')
    await router.push(`/purchases/${TRIP}`)
    expect(target(router)).toEqual({ path: '/purchases', step: true })
  })

  // Opened from «Деньги», a recorded row leads back to the month it was opened on (MOL-82, В-3).
  it('from «Деньги» the chevron says «Деньги» and steps back onto the same month', async () => {
    const router = await fresh('/money?month=2026-08')
    await router.push(`/purchases/${TRIP}?from=money`)
    expect(target(router)).toEqual({ path: '/money', step: true })
    expect(backTarget(router, router.currentRoute.value)?.location.meta.titleKey).toBe(
      'spending.title',
    )
  })

  it('a `from` the route does not list is not a parent: an address makes no screen one', async () => {
    const router = await fresh('/verdicts')
    await router.push(`/purchases/${TRIP}?from=advice`)
    expect(target(router)).toEqual({ path: '/purchases', step: false })
  })

  it('a section has no chevron at all', async () => {
    const router = await fresh('/')
    expect(backTarget(router, router.currentRoute.value)).toBeNull()
  })
})

// «Удалить» on an account leads to «Счета», where «Вернуть» stands — not to «Деньги» (review 32).
describe('upTarget — onto the parent itself', () => {
  const ACCOUNT = '/money/accounts/aaaaaaaa-0000-4000-8000-000000000031'
  const target = (router: Router) => {
    const found = upTarget(router, router.currentRoute.value)
    return found && { path: found.location.path, step: found.step }
  }

  it('steps back when «Счета» is underneath', async () => {
    const router = await fresh('/money')
    await router.push('/money/accounts')
    await router.push(ACCOUNT)
    expect(target(router)).toEqual({ path: '/money/accounts', step: true })
  })

  it('opened from a line of the card, replaces onto «Счета» instead of stepping to «Деньги»', async () => {
    const router = await fresh('/money')
    await router.push(ACCOUNT)
    expect(backTarget(router, router.currentRoute.value)?.step).toBe(true)
    expect(target(router)).toEqual({ path: '/money/accounts', step: false })
  })

  it('opened cold, «Счета» is laid underneath and is the step', async () => {
    const router = await openCold(ACCOUNT)
    expect(target(router)).toEqual({ path: '/money/accounts', step: true })
  })
})

describe('settleColdStart', () => {
  it('lays the chain underneath a nested screen opened cold', async () => {
    const router = await openCold('/purchases/manual/add')
    expect(router.currentRoute.value.fullPath).toBe('/purchases/manual/add')
    expect(router.options.history.state.back).toBe('/purchases/manual')
    expect(await stepBack(router)).toBe('/purchases/manual')
    expect(await stepBack(router)).toBe('/purchases')
  })

  it('lays the full chain under a cold search of a recorded row, keeping its id', async () => {
    const id = 'aaaaaaaa-0000-4000-8000-000000000012'
    const router = await openCold(`/purchases/${id}/add`)
    expect(await stepBack(router)).toBe(`/purchases/${id}`)
    expect(await stepBack(router)).toBe('/purchases')
  })

  it.each(['/', '/purchases', '/verdicts', '/settings'])(
    'leaves the section %s alone',
    async (path) => {
      const router = await openCold(path)
      expect(router.currentRoute.value.fullPath).toBe(path)
      expect(router.options.history.state.back).toBeNull()
    },
  )

  // A reload keeps the history state: the parent is already there and must not be doubled.
  it('lays «Деньги» under a recorded row opened cold from there', async () => {
    const router = await fresh(`/purchases/aaaaaaaa-0000-4000-8000-000000000012?from=money`)
    await settleColdStart(router)
    expect(router.options.history.state.back).toBe('/money')
  })

  it('adds nothing when the parent is already underneath', async () => {
    const router = await fresh('/purchases')
    await router.push('/purchases/manual')
    const push = vi.spyOn(router, 'push')
    const replace = vi.spyOn(router, 'replace')
    await settleColdStart(router)
    expect(push).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })
})

// A sheet is told it is closed from inside the pop that closed it, before that step has landed; a
// move made there was taken for a second tap and dropped (MOL-128: the record did not go up).
describe('afterStep — a move after a step waits for it to land', () => {
  it('runs at once with no step in flight', async () => {
    await fresh('/purchases')
    const ran: string[] = []
    afterStep(() => ran.push('now'))
    expect(ran).toEqual(['now'])
  })

  it('with a step in flight, runs once it has landed, not before', async () => {
    const router = await fresh('/purchases')
    // The step is held in the air: the browser answers `go` with a `popstate` later, never within.
    vi.spyOn(router, 'go').mockImplementation(() => undefined)
    const ran: string[] = []
    step(router)
    afterStep(() => ran.push('after'))
    expect(ran).toEqual([])

    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(ran).toEqual(['after'])
    vi.restoreAllMocks()
  })
})

// Adversarial Б (MOL-128): the record typed by hand is two levels under home, and a tab tapped
// there was decided as if from no section — every round of the shop left two more entries.
describe('a tab tapped on a nested screen', () => {
  const HOME = 0
  const PURCHASES = 1

  /** The tab bar alone — no screen under it, so no screen moves on its own. */
  function bar(router: Router) {
    const view = mount(TabBar, {
      global: { plugins: [router, createPinia(), createAppI18n('en')] },
    })
    return async (index: number): Promise<void> => {
      await view.findAll('.tab')[index]?.trigger('click', { button: 0 })
      await vi.waitFor(() => {
        expect(router.currentRoute.value.meta.tab).toBeDefined()
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  async function pressesToLeave(router: Router): Promise<string[]> {
    const walked: string[] = []
    while (router.options.history.state.back) walked.push(await stepBack(router))
    return walked
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('«Что брать» on the record is home, with nothing underneath', async () => {
    const router = await fresh('/')
    const tap = bar(router)
    await tap(PURCHASES)
    await router.push('/purchases/manual')

    await tap(HOME)

    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('advice')
    })
    expect(router.options.history.state.back).toBeNull()
  })

  it('«Покупки» on the record is the step up, not «Покупки» over «Покупки»', async () => {
    const router = await fresh('/')
    const tap = bar(router)
    await tap(PURCHASES)
    await router.push('/purchases/manual')

    await tap(PURCHASES)

    expect(router.currentRoute.value.fullPath).toBe('/purchases')
    expect(await pressesToLeave(router)).toEqual(['/'])
  })

  it('three rounds of the shop leave one press of «back» on home — out of the app', async () => {
    const router = await fresh('/')
    const tap = bar(router)
    for (let round = 0; round < 3; round += 1) {
      await tap(PURCHASES)
      await router.push('/purchases/manual')
      await router.push('/purchases/manual/add')
      await tap(HOME)
      expect(router.currentRoute.value.name).toBe('advice')
    }
    expect(router.options.history.state.back).toBeNull()
  })

  it('opened with no ancestor underneath, a tab acts from the screen`s section', async () => {
    const router = await fresh('/')
    await router.push('/purchases/manual')
    const tap = bar(router)

    await tap(PURCHASES)

    expect(router.currentRoute.value.fullPath).toBe('/purchases')
    expect(router.options.history.state.back).toBe('/')
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

  // Home is home whatever its address carries: a query from a shared link, a hash.
  it.each(['/?utm_source=telegram', '/#top'])(
    'arrived at %s: Purchases → What to buy is still the step back',
    async (entry) => {
      const { router, tap } = await app(entry)
      await tap(1)
      expect(router.currentRoute.value.name).toBe('purchases')
      const back = vi.spyOn(router, 'go')
      await tap(0)
      await vi.waitFor(() => {
        expect(router.currentRoute.value.name).toBe('advice')
      })
      expect(back).toHaveBeenCalledExactlyOnceWith(-1)
      expect(router.options.history.state.back).toBeNull()
    },
  )

  // Two taps before the history moves: the second must not step past home, out of the app.
  it('two taps on What to buy in one go take one step back', async () => {
    const { router } = await app('/')
    await router.push('/purchases')
    const view = mount(TabBar, {
      global: { plugins: [router, createPinia(), createAppI18n('en')] },
    })
    const back = vi.spyOn(router, 'go')
    const home = view.findAll('.tab')[0]
    void home?.trigger('click', { button: 0 })
    void home?.trigger('click', { button: 0 })
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('advice')
    })
    expect(back).toHaveBeenCalledExactlyOnceWith(-1)
  })

  it('two taps on the chevron in one go take one step back', async () => {
    const router = await fresh('/settings')
    await router.push('/privacy')
    const view = mount(
      defineComponent(() => () => h(RouterView)),
      { global: { plugins: [router, createPinia(), createAppI18n('en')] } },
    )
    const back = vi.spyOn(router, 'go')
    const chevron = view.get('.back')
    void chevron.trigger('click')
    void chevron.trigger('click')
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('settings')
    })
    expect(back).toHaveBeenCalledExactlyOnceWith(-1)
  })

  // The example the owner answered, with the new home: What to buy → Purchases → Ratings, «back».
  it('What to buy → Purchases → Ratings, back → What to buy', async () => {
    const { router, tap } = await app('/')
    await tap(1)
    expect(router.currentRoute.value.name).toBe('purchases')
    await tap(2)
    expect(router.currentRoute.value.name).toBe('verdicts')
    expect(router.options.history.state.back).toBe('/')
    expect(await stepBack(router)).toBe('/')
    expect(router.options.history.state.back).toBeNull()
  })

  it('a tap on What to buy from another section is that same step back', async () => {
    const { router, tap } = await app('/')
    await tap(1)
    await tap(2)
    await tap(0)
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('advice')
    })
    expect(router.options.history.state.back).toBeNull()
  })

  it('a tap on the open section scrolls to the top and writes nothing', async () => {
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const { router, tap } = await app('/purchases')
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
