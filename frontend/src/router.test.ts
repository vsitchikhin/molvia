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
    ['/', 'trip', 'trip'],
    ['/advice', 'advice', 'advice'],
    ['/verdicts', 'verdicts', 'verdicts'],
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

  it('the catalogue search is nested under the trip and is not a section', async () => {
    const route = await resolveAt('/trip/add')
    expect(route.name).toBe('item-search')
    expect(route.meta.parent).toBe('trip')
    expect(route.meta.tab).toBeUndefined()
  })

  // A mistyped link or a stale bookmark lands on the main scenario, not on a blank page.
  it.each(['/nowhere', '/trip/add/extra', '/advice/extra'])(
    'an unknown path %s leads home',
    async (path) => {
      const route = await resolveAt(path)
      expect(route.name).toBe('trip')
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

  it('is there in development, nested under the trip', async () => {
    const route = await resolveAt('/_kit')
    expect(route.name).toBe('kit')
    expect(route.meta.parent).toBe('trip')
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
