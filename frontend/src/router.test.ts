import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { routes } from '@/router'

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
