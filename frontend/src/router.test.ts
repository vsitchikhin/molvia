import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { RouteLocationNormalized } from 'vue-router'
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
  ])('%s is the %s section and shows the tab bar', async (path, name, tab) => {
    const route = await resolveAt(path)
    expect(route.name).toBe(name)
    expect(route.meta.tab).toBe(tab)
    expect(route.meta.parent).toBeUndefined()
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

describe('scrollBehavior', () => {
  const at = (fullPath: string) => ({ fullPath }) as RouteLocationNormalized

  it('starts a new screen at the top', () => {
    expect(scrollBehavior(at('/trip/add'), at('/'), null)).toEqual({ top: 0 })
  })

  it('returns to the saved position on back and forward', () => {
    expect(scrollBehavior(at('/'), at('/trip/add'), { left: 0, top: 600 })).toEqual({
      left: 0,
      top: 600,
    })
  })

  // A sheet closed by «back» pops an entry at the same address; the list under it stays put.
  it('does not touch the scroll when the address stays the same', () => {
    expect(scrollBehavior(at('/'), at('/'), null)).toBe(false)
  })

  it('must not fire: a query that changed is a different place', () => {
    expect(scrollBehavior(at('/?x=1'), at('/'), null)).toEqual({ top: 0 })
  })
})
