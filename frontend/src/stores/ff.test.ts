import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, createWebHistory } from 'vue-router'
import type { FfName } from '@molvia/model'

/** The store as a new page loads it: what the device kept is read once, at import. */
async function freshPage() {
  vi.resetModules()
  return { ff: await import('@/stores/ff') }
}

/** The same with the app's router, whose screens take seconds to import on a busy runner. */
async function freshRouter() {
  vi.resetModules()
  return {
    ff: await import('@/stores/ff'),
    router: await import('@/router'),
    navigation: await import('@/navigation'),
    sheets: await import('@/composables/useSheetHistory'),
  }
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

  // Another window wrote an older list since this one last changed its own (adversarial А3).
  it('write the list heard over another window’s older one', async () => {
    const a = await freshPage()
    const b = await freshPage()
    a.ff.hearFf(new Set(['venues']))
    b.ff.hearFf(new Set(['venues']))
    a.ff.hearFf(new Set())
    b.ff.hearFf(new Set(['venues']))
    expect(localStorage.getItem('molvia.ff')).toBe('venues')
  })

  // In a browser each tab has its own `sessionStorage`: the device's word is the shared shelf, and the
  // tab's own may be older — another window wrote «off» there since (adversarial А3).
  it('take the shared shelf’s empty list over the tab’s own older one', async () => {
    localStorage.setItem('molvia.ff', '')
    sessionStorage.setItem('molvia.ff', 'venues')
    const { ff } = await freshPage()
    expect(ff.ffOn('venues')).toBe(false)
  })

  it('write the shared shelf over another window’s word though this tab’s own agrees', async () => {
    const { ff } = await freshPage()
    ff.hearFf(new Set(['venues']))
    // another window heard «off» and wrote the shared shelf, never this tab's own
    localStorage.setItem('molvia.ff', '')
    ff.hearFf(new Set(['venues']))
    expect(localStorage.getItem('molvia.ff')).toBe('venues')
  })

  // Safari's private mode, a full quota: the shared shelf refuses and still holds its older list, which
  // the next launch would read first (review 1).
  it('take the older list off a shelf that refuses the new one', async () => {
    localStorage.setItem('molvia.ff', 'venues')
    const { ff } = await freshPage()
    const refusing = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    try {
      ff.hearFf(new Set())
    } finally {
      refusing.mockRestore()
    }
    expect(localStorage.getItem('molvia.ff')).toBeNull()
    const next = await freshPage()
    expect(next.ff.ffOn('venues')).toBe(false)
  })

  it('write «none is on» once, however often it is heard', async () => {
    const { ff } = await freshPage()
    ff.hearFf(new Set())
    expect(localStorage.getItem('molvia.ff')).toBe('')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    try {
      ff.hearFf(new Set())
      ff.hearFf(new Set())
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
  const probe = {
    path: '/venues-probe',
    name: 'venues-probe',
    component: { render: () => null },
    meta: { titleKey: 'advice.title', parent: 'advice', ff: 'venues' },
  } as const

  /**
   * The app's router at «Настройки», by the device's `on`. A web history where the entry underneath is
   * read — only it writes `history.state.back`, as the app's does.
   */
  async function routerAt(on: readonly FfName[], web = false) {
    const page = await freshRouter()
    page.ff.hearFf(new Set(on))
    if (web) window.history.replaceState(null, '', '/settings')
    const router = createRouter({
      history: web ? createWebHistory() : createMemoryHistory(),
      routes: [...page.router.routes, probe],
    })
    router.beforeEach(page.router.closedByFf(router))
    await router.push('/settings')
    return { router, ff: page.ff, sheets: page.sheets }
  }

  it('is home while its фф is off, the move an unknown address makes', async () => {
    const { router: off } = await routerAt([])
    await off.push('/venues-probe')
    const { router: unknown } = await routerAt([])
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
    const { router } = await routerAt(['venues'])
    await router.push('/venues-probe')
    expect(router.currentRoute.value.name).toBe('venues-probe')
  }, 60_000)

  it('leaves every screen without an фф alone', async () => {
    const { router } = await routerAt([])
    await router.push('/money')
    expect(router.currentRoute.value.name).toBe('money')
  }, 60_000)

  // A link opened cold is judged by what the device kept, before any answer (adversarial А2).
  it('opens once the next answer names its фф on, the person still home', async () => {
    const { router, ff } = await routerAt([], true)
    await router.push('/venues-probe?from=bot')
    expect(router.currentRoute.value.path).toBe('/')
    ff.hearFf(new Set(['venues']))
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/venues-probe?from=bot')
    })
    // in place of home: «back» leads where the person was before the link
    router.back()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('settings')
    })
  }, 60_000)

  it('stays home when the next answer names it off, and a later one does not reopen it', async () => {
    const { router, ff } = await routerAt([])
    await router.push('/venues-probe')
    const replace = vi.spyOn(router, 'replace')
    ff.hearFf(new Set())
    ff.hearFf(new Set(['venues']))
    // the answer's listener runs as it is heard: a move not asked for by then is never asked for
    expect(replace).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/')
  }, 60_000)

  // The answer may come minutes after the tap, once the connection is back; a sheet holds what was typed
  // in memory only, and a move of the router closes it (adversarial Б1).
  it('does not move a person with a sheet open, though still home', async () => {
    const { router, ff, sheets } = await routerAt([])
    await router.push('/venues-probe')
    let closed = 0
    const Sheet = defineComponent({
      setup() {
        sheets
          .useSheetHistory(() => {
            closed += 1
          })
          .lay()
        return () => h('div')
      },
    })
    const wrapper = mount(Sheet, { global: { plugins: [router] } })
    try {
      const replace = vi.spyOn(router, 'replace')
      ff.hearFf(new Set(['venues']))
      expect(replace).not.toHaveBeenCalled()
      expect(router.currentRoute.value.path).toBe('/')
      expect(closed).toBe(0)
    } finally {
      wrapper.unmount()
    }
  }, 60_000)

  // A cold link has nothing of the app under home: the screen takes home's entry, and home is laid under
  // it as under any screen opened cold, so the system «back» stays in the app (adversarial Б2).
  it('opened cold by the next answer, has its parent underneath', async () => {
    const page = await freshRouter()
    window.history.replaceState(null, '', '/venues-probe')
    const router = createRouter({
      history: createWebHistory(),
      routes: [...page.router.routes, probe],
    })
    router.beforeEach(page.router.closedByFf(router))
    await router.push('/venues-probe')
    await page.navigation.settleColdStart(router)
    expect(router.currentRoute.value.path).toBe('/')

    page.ff.hearFf(new Set(['venues']))
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/venues-probe')
      expect(router.options.history.state.back).toBe('/')
    })
    expect(page.navigation.backTarget(router, router.currentRoute.value)).toMatchObject({
      step: true,
    })
  }, 60_000)

  it('does not take a person who has moved on since', async () => {
    const { router, ff } = await routerAt([])
    await router.push('/venues-probe')
    await router.push('/money')
    const replace = vi.spyOn(router, 'replace')
    ff.hearFf(new Set(['venues']))
    expect(replace).not.toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('money')
  }, 60_000)
})
