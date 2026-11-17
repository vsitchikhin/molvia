import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

/** The store as a new page loads it: what the device kept is read once, at import. */
async function freshPage() {
  vi.resetModules()
  return { ff: await import('@/stores/ff') }
}

/** The same with the app's router, whose screens take seconds to import on a busy runner. */
async function freshRouter() {
  vi.resetModules()
  return { ff: await import('@/stores/ff'), router: await import('@/router') }
}

// A first import pays for the transform: 728 ms here for the store, 3.2 s once for the router with
// every screen, so those tests take their own timeout — a busy runner multiplies it nearly fivefold
// (MOL-243).

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('the фф the phone heard (MOL-382)', () => {
  it('are all off with nothing heard and nothing kept', async () => {
    const { ff } = await freshPage()
    expect(ff.ffOn('venues')).toBe(false)
    expect(ff.useFf('payments').value).toBe(false)
  }, 15_000)

  it('follow every answer, with no reload', async () => {
    const { ff } = await freshPage()
    const venues = ff.useFf('venues')
    ff.hearFf(new Set(['venues']))
    await nextTick()
    expect(venues.value).toBe(true)
    // empty is an answer: none is on
    ff.hearFf(new Set())
    await nextTick()
    expect(venues.value).toBe(false)
  })

  it('are kept on the device for the next launch, offline', async () => {
    const first = await freshPage()
    first.ff.hearFf(new Set(['payments', 'venues']))
    expect(localStorage.getItem('molvia.ff')).toBe('venues,payments')

    const next = await freshPage()
    expect(next.ff.ffOn('venues')).toBe(true)
    expect(next.ff.ffOn('payments')).toBe(true)
  })

  it('keep an empty list heard over a fuller one kept', async () => {
    localStorage.setItem('molvia.ff', 'venues')
    const first = await freshPage()
    expect(first.ff.ffOn('venues')).toBe(true)
    first.ff.hearFf(new Set())

    const next = await freshPage()
    expect(next.ff.ffOn('venues')).toBe(false)
  })

  it('write the device only when the list changes', async () => {
    const { ff } = await freshPage()
    ff.hearFf(new Set(['venues']))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    try {
      ff.hearFf(new Set(['venues']))
      ff.hearFf(new Set(['venues']))
      expect(setItem).not.toHaveBeenCalled()
    } finally {
      setItem.mockRestore()
    }
  })

  it('read past a name a later build kept', async () => {
    localStorage.setItem('molvia.ff', 'tips,payments')
    const { ff } = await freshPage()
    expect(ff.ffOn('payments')).toBe(true)
  })

  it('are not the person’s: no sweep of an owner takes them', async () => {
    const { ff } = await freshPage()
    ff.hearFf(new Set(['venues']))
    const { forgetOwner } = await import('@/stores/identity')
    forgetOwner('9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f')
    expect(localStorage.getItem('molvia.ff')).toBe('venues')
  })
})

describe('a screen under an фф', () => {
  async function routerAt(on: readonly ('venues' | 'payments')[]) {
    const page = await freshRouter()
    page.ff.hearFf(new Set(on))
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        ...page.router.routes,
        {
          path: '/venues-probe',
          name: 'venues-probe',
          component: { render: () => null },
          meta: { titleKey: 'advice.title', parent: 'advice', ff: 'venues' },
        },
      ],
    })
    router.beforeEach(page.router.closedByFf)
    await router.push('/settings')
    return router
  }

  it('is home while its фф is off, the move an unknown address makes', async () => {
    const off = await routerAt([])
    await off.push('/venues-probe')
    const unknown = await routerAt([])
    await unknown.push('/nowhere')
    expect(off.currentRoute.value.path).toBe('/')
    expect(off.currentRoute.value.fullPath).toBe(unknown.currentRoute.value.fullPath)
    // «back» from home leads where the person was, never to the closed screen
    off.back()
    await vi.waitFor(() => {
      expect(off.currentRoute.value.name).toBe('settings')
    })
  }, 60_000)

  it('opens while its фф is on', async () => {
    const router = await routerAt(['venues'])
    await router.push('/venues-probe')
    expect(router.currentRoute.value.name).toBe('venues-probe')
  }, 60_000)

  it('leaves every screen without an фф alone', async () => {
    const router = await routerAt([])
    await router.push('/money')
    expect(router.currentRoute.value.name).toBe('money')
  }, 60_000)
})
