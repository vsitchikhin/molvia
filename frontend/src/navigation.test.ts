import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createPinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, createWebHistory, RouterView } from 'vue-router'
import type { Router } from 'vue-router'
import { POLICY_VERSION } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import { ScreenNotLoaded } from '@/failures'
import {
  SCREEN_RELOAD_GAP_MS,
  SCREEN_RELOAD_KEY,
  afterStep,
  backTarget,
  lazyScreen,
  loadScreens,
  reloadOnStaleChunk,
  settleColdStart,
  stepBack as step,
  tabMove,
  upTarget,
  warmScreens,
} from '@/navigation'
import type { TabMove } from '@/navigation'
import type { RouteName, Tab } from '@/router'
import { routes } from '@/router'
import TabBar from '@/components/TabBar.vue'

// The test here past a second on CI carries a timeout of 25 s: the slowest took 2 225 ms there
// (MOL-266), its own wait — 2.1 s of it the test sets. Not work, so the rule of MOL-243 asks no
// timeout of it — the time reporter does, as it tells no wait from work. Ten times it.

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
// MOL-216, Е-9: «Данные и приватность» and «Условия» open without a session, and their parent is
// «Настройки», where nobody is let in. Behind the door the chevron is the door's.
describe('backTarget behind the door — a public screen leads back to the login', () => {
  const target = (router: Router, door = true) => {
    const found = backTarget(router, router.currentRoute.value, door)
    return found && { path: found.location.path, step: found.step, title: found.titleKey }
  }

  it('steps back onto the address the login stood at, named «Вход»', async () => {
    const router = await fresh('/money')
    await router.push('/privacy')
    expect(target(router)).toEqual({ path: '/money', step: true, title: 'login.title' })
  })

  it('with nothing of ours underneath, replaces onto home, where the door is drawn', async () => {
    const router = await fresh('/terms')
    expect(target(router)).toEqual({ path: '/', step: false, title: 'login.title' })
  })

  it('a public screen underneath is drawn as itself, and named by its own title', async () => {
    const router = await fresh('/terms')
    await router.push('/privacy')
    expect(target(router)).toEqual({ path: '/terms', step: true, title: undefined })
  })

  it('with the door open, the parent as ever: «‹ Настройки»', async () => {
    const router = await fresh('/money')
    await router.push('/privacy')
    expect(target(router, false)).toEqual({ path: '/settings', step: false, title: undefined })
  })

  it('a screen that is not public keeps its parent behind the door too', async () => {
    const router = await fresh('/purchases')
    await router.push('/purchases/manual')
    expect(target(router)).toEqual({ path: '/purchases', step: true, title: undefined })
  })
})

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

  // MOL-216, owner's В-1 «а»: a stranger who opened the privacy page by a link and went back signed in
  // onto «Настройки». Behind the door home is underneath; with it open, the chain as ever.
  it.each(['/privacy', '/terms'])('behind the door lays home under %s', async (path) => {
    const router = await fresh(path)
    await settleColdStart(router, () => true)
    expect(router.currentRoute.value.fullPath).toBe(path)
    expect(router.options.history.state.back).toBe('/')
  })

  it('with the door open lays «Настройки» under the privacy page', async () => {
    const router = await fresh('/privacy')
    await settleColdStart(router, () => false)
    expect(router.options.history.state.back).toBe('/settings')
  })

  it('behind the door a screen that is not public still gets its chain', async () => {
    const router = await fresh('/purchases/manual/add')
    await settleColdStart(router, () => true)
    expect(router.options.history.state.back).toBe('/purchases/manual')
  })

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
  }, 10_000)

  it('opened with no ancestor underneath, a tab acts from the screen`s section', async () => {
    const router = await fresh('/')
    await router.push('/purchases/manual')
    const tap = bar(router)

    await tap(PURCHASES)

    expect(router.currentRoute.value.fullPath).toBe('/purchases')
    expect(router.options.history.state.back).toBe('/')
  })

  // Review Р-24: a step that never landed — its pop eaten by a sheet's guard — left the tab
  // waiting for any later move off the record, and the tab then opened by itself.
  it('a step that never moved leaves nothing to fire on a later move', async () => {
    const router = await fresh('/')
    const tap = bar(router)
    await tap(PURCHASES)
    await router.push('/purchases/manual')
    const go = vi.spyOn(router, 'go').mockImplementation(() => undefined)

    const tabs = mount(TabBar, {
      global: { plugins: [router, createPinia(), createAppI18n('en')] },
    })
    await tabs.findAll('.tab')[HOME]?.trigger('click', { button: 0 })
    // The step's own timer, then the tab's deadline.
    await new Promise((resolve) => setTimeout(resolve, 2100))
    go.mockRestore()

    await router.push('/purchases/manual/add')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(router.currentRoute.value.name).toBe('item-search')
  }, 45_000)
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
    // Somebody on the device, claimed, who accepted this edition: the door is open, and the privacy page's
    // chevron is «‹ Настройки» (behind the door it is the door's, MOL-216).
    const owner = 'aaaaaaaa-0000-4000-8000-0000000000aa'
    localStorage.setItem('molvia.actor', owner)
    localStorage.setItem('molvia.login', JSON.stringify({ claimed: owner }))
    localStorage.setItem(`molvia.consent.${owner}`, String(POLICY_VERSION))
    onTestFinished(() => {
      localStorage.clear()
    })
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
  }, 10_000)

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

// MOL-337: every screen but home is a chunk of its own.
describe('a screen loaded when first opened', () => {
  /** A chunk that did not come, as Chromium says it (MOL-337, adversarial А1 — probed). */
  const notCome = () =>
    Promise.reject(
      new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1/assets/a.js'),
    )
  const HOME_SCREEN = defineComponent({ render: () => h('p', 'home') })
  const SCREEN = defineComponent({ render: () => h('p', 'screen') })

  function screens(loads: Record<string, () => Promise<unknown>>): Router {
    return createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'home', component: HOME_SCREEN },
        ...Object.entries(loads).map(([name, load]) => ({
          path: `/${name}`,
          name,
          component: load as () => Promise<typeof SCREEN>,
        })),
        { path: '/old', redirect: '/' },
      ],
    })
  }

  describe('warmScreens', () => {
    it('loads every lazy screen once, one after another, and nothing else', async () => {
      const order: string[] = []
      let running = 0
      const load = (name: string) =>
        vi.fn(async () => {
          running += 1
          expect(running).toBe(1)
          order.push(name)
          await Promise.resolve()
          running -= 1
          return SCREEN
        })
      const loads = { a: load('a'), b: load('b'), c: load('c') }
      await warmScreens(screens(loads), () => Promise.resolve())
      expect(order).toEqual(['a', 'b', 'c'])
      for (const one of Object.values(loads)) expect(one).toHaveBeenCalledTimes(1)
    })

    it('keeps each screen it loaded in its record, so a move to it waits on no import', async () => {
      const load = vi.fn(() => Promise.resolve({ default: SCREEN }))
      const router = screens({ a: load })
      await warmScreens(router, () => Promise.resolve())
      expect(router.getRoutes().find((record) => record.name === 'a')?.components?.default).toBe(
        SCREEN,
      )
      await router.push('/a')
      expect(load).toHaveBeenCalledTimes(1)
    })

    it('must not fire: a screen that does not come stops none after it and throws nothing', async () => {
      const after = vi.fn(() => Promise.resolve(SCREEN))
      const router = screens({
        gone: lazyScreen(notCome),
        after,
      })
      await expect(warmScreens(router, () => Promise.resolve())).resolves.toBeUndefined()
      expect(after).toHaveBeenCalledTimes(1)
    })

    it('a module that came and threw is reported, and the warming goes on; a chunk that did not come is not (adversarial А12)', async () => {
      const report = vi.fn()
      const thrown = new TypeError('Object.hasOwn is not a function')
      const after = vi.fn(() => Promise.resolve(SCREEN))
      const router = screens({
        threw: lazyScreen(() => Promise.reject(thrown)),
        gone: lazyScreen(notCome),
        after,
      })
      await warmScreens(router, () => Promise.resolve(), report)
      expect(report.mock.calls).toEqual([[thrown]])
      expect(after).toHaveBeenCalledTimes(1)
    })

    it('pauses before each screen, so the page draws in between', async () => {
      const pause = vi.fn(() => Promise.resolve())
      await warmScreens(
        screens({ a: () => Promise.resolve(SCREEN), b: () => Promise.resolve(SCREEN) }),
        pause,
      )
      expect(pause).toHaveBeenCalledTimes(2)
    })
  })

  describe('loadScreens — the dev server’s start, which has no precache', () => {
    it('asks for every screen at once, and a screen that does not come holds back none', async () => {
      const after = vi.fn(() => Promise.resolve(SCREEN))
      // How many times the screen after it was asked for by the moment the slow one came.
      let askedMeanwhile = -1
      const slow = vi.fn(
        () =>
          new Promise<typeof SCREEN>((resolve) => {
            setTimeout(() => {
              askedMeanwhile = after.mock.calls.length
              resolve(SCREEN)
            }, 0)
          }),
      )
      const router = screens({
        slow,
        gone: lazyScreen(notCome),
        after,
      })
      await expect(loadScreens(router)).resolves.toBeUndefined()
      expect(slow).toHaveBeenCalledTimes(1)
      expect(after).toHaveBeenCalledTimes(1)
      expect(askedMeanwhile).toBe(1)
    })
  })

  describe('reloadOnStaleChunk (owner’s В-2 «а»)', () => {
    function stale(online = true, now = 1_000_000) {
      const assign = vi.fn()
      const report = vi.fn()
      const router = screens({
        gone: lazyScreen(notCome),
        here: () => Promise.resolve(SCREEN),
        throws: lazyScreen(() => Promise.reject(new TypeError('Object.hasOwn is not a function'))),
      })
      reloadOnStaleChunk(router, { online: () => online, assign, now: () => now, report })
      return { router, assign, report }
    }

    afterEach(() => {
      sessionStorage.clear()
      localStorage.clear()
    })

    it('with a connection, opens the screen by a full load of its address, query and all', async () => {
      const { router, assign } = stale()
      await router.push('/').catch(() => undefined)
      await router.push('/gone?month=2026-10').catch(() => undefined)
      expect(assign).toHaveBeenCalledWith('/gone?month=2026-10')
      expect(router.currentRoute.value.name).toBe('home')
    })

    it('must not fire offline: the move is cancelled and the page stays', async () => {
      const { router, assign } = stale(false)
      await router.push('/')
      await expect(router.push('/gone')).rejects.toBeInstanceOf(ScreenNotLoaded)
      expect(assign).not.toHaveBeenCalled()
      expect(router.currentRoute.value.name).toBe('home')
    })

    it('must not fire twice within the gap, so a chunk missing from the new version too cannot loop', async () => {
      sessionStorage.setItem(SCREEN_RELOAD_KEY, String(1_000_000 - SCREEN_RELOAD_GAP_MS + 1))
      const { router, assign } = stale(true, 1_000_000)
      await router.push('/').catch(() => undefined)
      await router.push('/gone').catch(() => undefined)
      expect(assign).not.toHaveBeenCalled()
    })

    it('a mark ahead of the clock — a clock set back since — guards nothing (adversarial А13)', async () => {
      sessionStorage.setItem(SCREEN_RELOAD_KEY, String(1_000_000 + 60 * 60 * 1000))
      const { router, assign } = stale(true, 1_000_000)
      await router.push('/').catch(() => undefined)
      await router.push('/gone').catch(() => undefined)
      expect(assign).toHaveBeenCalledTimes(1)
    })

    it('loads again once the gap is over, and marks the moment on this tab alone', async () => {
      sessionStorage.setItem(SCREEN_RELOAD_KEY, String(1_000_000 - SCREEN_RELOAD_GAP_MS))
      const { router, assign } = stale(true, 1_000_000)
      await router.push('/').catch(() => undefined)
      await router.push('/gone').catch(() => undefined)
      expect(assign).toHaveBeenCalledTimes(1)
      expect(sessionStorage.getItem(SCREEN_RELOAD_KEY)).toBe('1000000')
      expect(localStorage.getItem(SCREEN_RELOAD_KEY)).toBeNull()
    })

    it('must not fire for any other failure of a move: a guard’s error is no stale chunk, and is heard', async () => {
      const { router, assign, report } = stale()
      const thrown = new TypeError("Cannot read properties of undefined (reading 'meta')")
      router.beforeEach((to) => {
        if (to.name === 'here') throw thrown
      })
      await router.push('/').catch(() => undefined)
      await router.push('/here').catch(() => undefined)
      expect(assign).not.toHaveBeenCalled()
      expect(report).toHaveBeenCalledWith(thrown)
    })

    it('a screen whose module came and threw as it ran is our defect: heard, never reloaded (adversarial А1)', async () => {
      const { router, assign, report } = stale()
      await router.push('/')
      const failure: unknown = await router.push('/throws').catch((error: unknown) => error)
      expect(failure).not.toBeInstanceOf(ScreenNotLoaded)
      expect(failure).toBeInstanceOf(TypeError)
      expect(report).toHaveBeenCalledWith(failure)
      expect(assign).not.toHaveBeenCalled()
    })

    it.each([
      'Failed to fetch dynamically imported module: http://127.0.0.1/assets/a.js',
      'Importing a module script failed.',
      "'text/html' is not a valid JavaScript MIME type for module script 'http://127.0.0.1/assets/a.js'.",
      'error loading dynamically imported module: http://127.0.0.1/assets/a.js',
    ])('an engine’s «%s» is a chunk that did not come', async (message) => {
      await expect(
        lazyScreen(() => Promise.reject(new TypeError(message)))(),
      ).rejects.toBeInstanceOf(ScreenNotLoaded)
    })

    it('must not fire where the tab cannot keep its mark: no load rather than a loop (adversarial А6)', async () => {
      const { router, assign } = stale()
      // On the instance, as `useLocale.test.ts` does: happy-dom's storages carry their own methods.
      const original = sessionStorage.setItem.bind(sessionStorage)
      Object.defineProperty(sessionStorage, 'setItem', {
        configurable: true,
        writable: true,
        value: (): never => {
          throw new DOMException('quota', 'QuotaExceededError')
        },
      })
      try {
        await router.push('/').catch(() => undefined)
        await router.push('/gone').catch(() => undefined)
        expect(assign).not.toHaveBeenCalled()
      } finally {
        Object.defineProperty(sessionStorage, 'setItem', {
          configurable: true,
          writable: true,
          value: original,
        })
      }
    })

    it('a cold start whose parent did not come loads the screen opened, never the parent (adversarial А4)', async () => {
      const assign = vi.fn()
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: '/', name: 'advice', component: HOME_SCREEN },
          {
            path: '/money',
            name: 'money',
            component: lazyScreen(notCome),
            meta: { titleKey: 'x', tab: 'money' },
          },
          {
            path: '/money/accounts/:accountId',
            name: 'money-account',
            component: SCREEN,
            meta: { titleKey: 'x', parent: 'money' },
          },
        ],
      })
      reloadOnStaleChunk(router, {
        online: () => true,
        assign,
        now: () => 1_000_000,
        report: vi.fn(),
      })
      await router.push('/money/accounts/a1')
      await settleColdStart(router).catch(() => undefined)
      expect(assign).toHaveBeenCalledWith('/money/accounts/a1')
    })
  })
})
