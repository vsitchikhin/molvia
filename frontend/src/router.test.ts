import { afterEach, describe, expect, it, vi } from 'vitest'
import { START_LOCATION, createMemoryHistory, createRouter } from 'vue-router'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { routes, scrollBehavior } from '@/router'

function lookup(dictionary: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    return node !== null && typeof node === 'object'
      ? (node as Record<string, unknown>)[part]
      : undefined
  }, dictionary)
}

async function resolveAt(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  return router.currentRoute.value
}

const named = routes.flatMap((route) =>
  route.meta ? [{ name: route.name, meta: route.meta }] : [],
)

describe('routes', () => {
  it.each([
    ['/', 'advice', 'advice'],
    ['/purchases', 'purchases', 'purchases'],
    ['/verdicts', 'verdicts', 'verdicts'],
    ['/money', 'money', 'money'],
    ['/settings', 'settings', 'settings'],
  ])('%s is the %s section and shows the tab bar', async (path, name, tab) => {
    const route = await resolveAt(path)
    expect(route.name).toBe(name)
    expect(route.meta.tab).toBe(tab)
    expect(route.meta.parent).toBeUndefined()
  })

  it('«Data and privacy» is nested under the settings and is not a section (MOL-58)', async () => {
    const route = await resolveAt('/privacy')
    expect(route.name).toBe('privacy')
    expect(route.meta.parent).toBe('settings')
    expect(route.meta.tab).toBeUndefined()
    expect(route.meta.public).toBe(true)
  })

  it('no other route is drawn without a session (MOL-56, MOL-58)', () => {
    expect(named.filter((route) => route.meta.public).map((route) => route.name)).toEqual([
      'privacy',
    ])
  })

  it.each([
    ['/purchases/manual', 'purchase-manual', 'purchases'],
    ['/purchases/manual/add', 'item-search', 'purchase-manual'],
    ['/purchases/aaaaaaaa-0000-4000-8000-000000000012', 'purchase', 'purchases'],
    ['/purchases/aaaaaaaa-0000-4000-8000-000000000012/add', 'finished-search', 'purchase'],
  ])('%s is %s, nested under %s and not a section (MOL-128)', async (path, name, parent) => {
    const route = await resolveAt(path)
    expect(route.name).toBe(name)
    expect(route.meta.parent).toBe(parent)
    expect(route.meta.tab).toBeUndefined()
  })

  // «Что брать» became home and «Поход» became «Покупки» (MOL-128): a bookmark or the history of
  // an installed app still arrives, and the old address is not left in the history of its own.
  it.each([
    ['/advice', '/'],
    ['/trip', '/purchases'],
    ['/trip/add', '/purchases/manual/add'],
    ['/trip/history', '/purchases'],
    [
      '/trip/history/aaaaaaaa-0000-4000-8000-000000000012?from=money',
      '/purchases/aaaaaaaa-0000-4000-8000-000000000012?from=money',
    ],
    [
      '/trip/history/aaaaaaaa-0000-4000-8000-000000000012/add',
      '/purchases/aaaaaaaa-0000-4000-8000-000000000012/add',
    ],
  ])('the old address %s leads to %s', async (old, path) => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/money')
    await router.push(old)
    expect(router.currentRoute.value.fullPath).toBe(path)
    router.back()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(router.currentRoute.value.name).toBe('money')
  })

  it.each([
    ['/money/exchange', 'exchange'],
    ['/money/incomes', 'incomes'],
  ])('%s is nested under «Деньги», not under the settings (MOL-81)', async (path, name) => {
    const route = await resolveAt(path)
    expect(route.name).toBe(name)
    expect(route.meta.parent).toBe('money')
    expect(route.meta.tab).toBeUndefined()
  })

  // A bookmark or the history of an installed app from before the move still arrives, and the
  // old address is replaced rather than left in the history as a step of its own.
  it.each([
    ['/settings/exchange', 'exchange', '/money/exchange'],
    ['/settings/incomes', 'incomes', '/money/incomes'],
  ])(
    'the old address %s leads to the moved screen in one step (MOL-81)',
    async (old, name, path) => {
      const router = createRouter({ history: createMemoryHistory(), routes })
      await router.push('/money')
      await router.push(old)
      expect(router.currentRoute.value.name).toBe(name)
      expect(router.currentRoute.value.fullPath).toBe(path)
      router.back()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(router.currentRoute.value.name).toBe('money')
    },
  )

  // A mistyped link or a stale bookmark lands home, not on a blank page.
  it.each(['/nowhere', '/trip/add/extra', '/advice/extra', '/purchases/manual/add/extra'])(
    'an unknown path %s leads home',
    async (path) => {
      const route = await resolveAt(path)
      expect(route.name).toBe('advice')
      expect(route.fullPath).toBe('/')
    },
  )

  it('every parent names a route that exists', () => {
    const names = new Set(named.map((route) => route.name))
    for (const route of named) {
      if (route.meta.parent) expect(names).toContain(route.meta.parent)
    }
  })

  // The title key labels the heading, the back chevron and the document title; a key missing
  // from one language would print the key itself there.
  it.each(named.map((route) => [route.name, route.meta.titleKey]))(
    '%s has a title in both languages',
    (_name, key) => {
      expect(typeof lookup(ru, key)).toBe('string')
      expect(typeof lookup(en, key)).toBe('string')
    },
  )
})

// The kit is a page for development; a production build must not carry it.
describe('the kit page', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('is there in development, nested under home', async () => {
    const route = await resolveAt('/_kit')
    expect(route.name).toBe('kit')
    expect(route.meta.parent).toBe('advice')
  })

  it('must not fire: a production build has no such page', async () => {
    vi.stubEnv('DEV', false)
    vi.resetModules()
    const production = await import('@/router')
    const router = createRouter({ history: createMemoryHistory(), routes: production.routes })
    await router.push('/_kit')
    expect(router.currentRoute.value.fullPath).toBe('/')
    expect(production.routes.some((route) => route.path === '/_kit')).toBe(false)
  })
})

describe('scrollBehavior', () => {
  const saved = { left: 0, top: 2127 }

  // The same address is a sheet put away: the page under it never moved (MOL-63).
  it('does not scroll on a move to the same address, whatever was saved', async () => {
    const search = await resolveAt('/trip/add')
    const advice = await resolveAt('/advice')
    expect(scrollBehavior(search, search, saved)).toBe(false)
    expect(scrollBehavior(advice, advice, null)).toBe(false)
  })

  it('returns to where the person was on back and forward between screens', async () => {
    expect(scrollBehavior(await resolveAt('/'), await resolveAt('/trip/add'), saved)).toEqual(saved)
  })

  it('starts any other move at the top', async () => {
    expect(scrollBehavior(await resolveAt('/trip/add'), await resolveAt('/'), null)).toEqual({
      top: 0,
    })
  })

  // The category card is the third on «Графики»: a choice that took the page to the top took the
  // chart away from the person who asked for it (MOL-136).
  it('keeps the page where it is when only the query of the screen changes', async () => {
    const charts = await resolveAt('/money/charts')
    const rent = await resolveAt('/money/charts?category=0b5e2f64-8c39-4a4e-9d0f-6f1c7a2b3c4d')
    const year = await resolveAt('/money/charts?period=12')
    const month = await resolveAt('/money?month=2026-08')
    expect(scrollBehavior(rent, charts, null)).toBe(false)
    expect(scrollBehavior(year, rent, null)).toBe(false)
    expect(scrollBehavior(month, await resolveAt('/money'), null)).toBe(false)
    expect(scrollBehavior(await resolveAt('/money'), month, null)).toBe(false)
  })

  it('returns to where the person was on back and forward within the screen too', async () => {
    const month = await resolveAt('/money?month=2026-08')
    expect(scrollBehavior(month, await resolveAt('/money'), saved)).toEqual(saved)
  })

  it('must not fire: the same route with other params is another screen', async () => {
    const one = await resolveAt('/money/accounts/0b5e2f64-8c39-4a4e-9d0f-6f1c7a2b3c4d')
    const other = await resolveAt('/money/accounts/7d1a9c2e-4b6f-4e3a-8c5d-2f9e1b7a6c3d')
    expect(scrollBehavior(other, one, null)).toEqual({ top: 0 })
  })

  it('must not fire: another screen with a query starts at the top', async () => {
    const month = await resolveAt('/money?month=2026-08')
    expect(scrollBehavior(await resolveAt('/money/charts'), month, null)).toEqual({ top: 0 })
    expect(scrollBehavior(month, await resolveAt('/money/charts'), null)).toEqual({ top: 0 })
  })

  // `START_LOCATION` is at «/»: a trip opened with a query and nothing saved is not a query changed.
  it('must not fire: the first navigation with a query and nothing saved starts at the top', async () => {
    expect(scrollBehavior(await resolveAt('/?from=bot'), START_LOCATION, null)).toEqual({ top: 0 })
  })

  // `START_LOCATION` is at «/» too, and the trip is at «/»: read as the same address, a trip loaded
  // again threw away where the person was — and it alone of the screens (adversarial В1).
  it('returns the first navigation to where the person was, on the trip as elsewhere', async () => {
    const trip = await resolveAt('/')
    expect(scrollBehavior(trip, START_LOCATION, saved)).toEqual(saved)
    expect(scrollBehavior(trip, trip, saved)).toBe(false)
  })

  // Asked by the router itself: its first navigation, and a duplicate it refuses (adversarial Д1).
  it('is asked by the router for a duplicate too, and does not scroll it', async () => {
    const asked: { to: string; from: string; answer: unknown }[] = []
    const router = createRouter({
      history: createMemoryHistory(),
      routes,
      scrollBehavior: (to, from, position) => {
        const answer = scrollBehavior(to, from, position)
        asked.push({ to: to.fullPath, from: from.fullPath, answer })
        return answer
      },
    })
    await router.push('/')
    expect(await router.push('/')).toBeDefined()
    await vi.waitFor(() => {
      expect(asked).toHaveLength(2)
    })
    expect(asked).toEqual([
      { to: '/', from: '/', answer: { top: 0 } },
      { to: '/', from: '/', answer: false },
    ])
  })
})
