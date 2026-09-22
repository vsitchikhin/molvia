import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ERROR } from '@molvia/model'
import type { ActorView } from '@molvia/model'
// Nothing is imported from the store or the identity module at the top on purpose: every
// test loads them through `freshStore`, and a module captured here would be a second copy
// with its own in-memory identifier — the assertions would then read a value the code under
// test never wrote.

const devLogin = vi.fn<() => Promise<ActorView>>()
const me = vi.fn<() => Promise<ActorView>>()
vi.mock('@/api', () => ({
  api: {
    devLogin: () => devLogin(),
    me: () => me(),
  },
}))

const KEY = 'molvia.actor'

function actorWith(id: string): ActorView {
  return {
    id,
    country: 'AM',
    city: 'Гюмри',
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    createdAt: new Date('2026-09-16T10:00:00.000Z'),
    updatedAt: new Date('2026-09-16T10:00:00.000Z'),
  }
}

const FIRST = actorWith('9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f')
const SECOND = actorWith('2c4e6a80-1111-4222-8333-444455556666')

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

/**
 * Private mode: `localStorage.setItem` throws. Overridden as an own property because that is
 * where happy-dom keeps it — a `vi.spyOn(Storage.prototype, …)` stops intercepting after the
 * first `restoreAllMocks`, which is how the earlier version of this test ended up proving an
 * ordinary first visit instead (adversarial О-18).
 */
function withBrokenLocalStorage(run: () => Promise<void>): Promise<void> {
  const working = localStorage.setItem.bind(localStorage)
  const define = (value: Storage['setItem']) =>
    Object.defineProperty(localStorage, 'setItem', { configurable: true, writable: true, value })

  define(() => {
    throw new Error('QuotaExceededError')
  })
  return run().finally(() => {
    define(working)
  })
}

/**
 * A fresh module graph, so the identity module's in-memory value does not leak between
 * tests — and `ApiError` from that same graph.
 *
 * The class matters: the store decides that a session is gone with `error instanceof
 * ApiError`, and after `vi.resetModules()` a class imported at the top of this file is a
 * different one from the class the store compares against. A rejection built with it would
 * be read as an ordinary failure, and every test about a refused code or a dead session
 * would prove the opposite of what it says.
 */
async function freshStore() {
  vi.resetModules()
  setActivePinia(createPinia())
  const { useActorStore: fresh } = await import('@/stores/actor')
  const identity = await import('@/stores/identity')
  const { ApiError } = await import('@molvia/client')
  return { store: fresh(), identity, ApiError }
}

/** The rejection the client hands the store when the server does not recognise a request. */
async function refusal(): Promise<Error> {
  const { ApiError } = await import('@molvia/client')
  return new ApiError(ERROR.NO_ACTOR)
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  sessionStorage.clear()
  devLogin.mockReset()
  me.mockReset()
  online(true)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('the first launch', () => {
  it('asks who it is first, and signs in only when the answer is «nobody»', async () => {
    // The cookie decides, and the app cannot see it — so there is nothing on the device to
    // consult before asking. `me()` first is not an extra round trip: it is the only way to
    // know whether this browser is already carrying a session.
    const { store } = await freshStore()
    me.mockRejectedValue(await refusal())
    devLogin.mockResolvedValue(FIRST)

    await store.start()

    expect(me).toHaveBeenCalled()
    expect(devLogin).toHaveBeenCalledWith()
    expect(store.state).toBe('ready')
  })

  it('keeps the owner id as the name of a drawer, not as a credential', async () => {
    // Nothing sends it anywhere any more; it is what the trip queue, the recent items and the
    // verdict drafts are filed under, and at the shelf with no signal they are read before the
    // server can be asked (Р-9).
    const { store } = await freshStore()
    me.mockRejectedValue(await refusal())
    devLogin.mockResolvedValue(FIRST)

    await store.start()

    expect(localStorage.getItem(KEY)).toBe(FIRST.id)
    expect(store.id).toBe(FIRST.id)
  })

  it('says «offline» instead of hanging, and recovers when the network returns', async () => {
    online(false)
    const { store } = await freshStore()

    await store.start()
    expect(store.state).toBe('offline')
    expect(me).not.toHaveBeenCalled()

    online(true)
    me.mockResolvedValue(FIRST)
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => {
      expect(store.state).toBe('ready')
    })
  })

  it('recovers from «error» too, which is what a captive portal produces', async () => {
    // `navigator.onLine` is true on a captive portal and on wifi with no route out, so the
    // commonest way to have no internet lands in `error` — and the listener used to watch
    // only `offline`, the state that case never reaches.
    const { store } = await freshStore()
    me.mockRejectedValue(new Error('fetch failed'))

    await store.start()
    expect(store.state).toBe('error')

    me.mockResolvedValue(FIRST)
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => {
      expect(store.state).toBe('ready')
    })
  })

  // An iOS PWA frozen in the background misses `online` while the network returns. Since
  // MOL-19 the offline notice has no button, so coming back into view is the other way back
  // (Р-8, B2).
  it('recovers when the app comes back into view, even with no «online» to hear', async () => {
    online(false)
    const { store } = await freshStore()
    await store.start()
    expect(store.state).toBe('offline')

    online(true)
    me.mockResolvedValue(FIRST)
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => {
      expect(store.state).toBe('ready')
    })
  })

  it('does not start over on coming into view when it is fine', async () => {
    const { store } = await freshStore()
    me.mockResolvedValue(FIRST)
    await store.start()
    expect(store.state).toBe('ready')
    me.mockClear()

    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    expect(me).not.toHaveBeenCalled()
  })

  it('starts on a device whose storage is blocked outright, instead of rejecting', async () => {
    // Disabled cookies, an embedded WebView, a corporate policy: reaching for the property
    // throws, not just writing to it. One unguarded read left `start()` rejecting into
    // `void` in main.ts — a screen stuck on «loading», which draws nothing at all.
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: access to localStorage is denied')
      },
    })

    try {
      me.mockResolvedValue(FIRST)
      const { store } = await freshStore()

      await expect(store.start()).resolves.toBeUndefined()

      expect(store.state).toBe('ready')
      expect(store.id).toBe(FIRST.id)
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor)
    }
  })
})

describe('a device whose storage refuses writes', () => {
  it('still knows which drawer is its own for the rest of the session', async () => {
    // The identifier is held in memory as well as written down, so a phone in private mode
    // still finds its queue and its recent items while the tab lives.
    devLogin.mockResolvedValue(FIRST)

    await withBrokenLocalStorage(async () => {
      const { store, identity } = await freshStore()
      me.mockRejectedValue(await refusal())

      await store.start()

      expect(store.state).toBe('ready')
      expect(identity.currentIdentity()).toBe(FIRST.id)
    })
  })

  it('does not open a second session on the next launch, because the cookie survived', async () => {
    // Rows in `actors` are the denominator of the 0.2 gate. What keeps them from multiplying
    // is no longer the stored identifier — which private mode loses — but the cookie, which
    // the browser keeps whatever it does with `localStorage`.
    devLogin.mockResolvedValue(FIRST)

    await withBrokenLocalStorage(async () => {
      const first = await freshStore()
      // Дважды: под блокировкой сценарий переспрашивает сервер, прежде чем заводить кого-то.
      me.mockRejectedValue(await refusal())
      await first.store.start()

      me.mockReset()
      me.mockResolvedValue(FIRST)
      const { store } = await freshStore()
      await store.start()

      expect(devLogin).toHaveBeenCalledTimes(1)
      expect(store.id).toBe(FIRST.id)
    })
  })
})

describe('an offline launch with an owner already known', () => {
  it('does not call itself ready for a session nothing has checked', async () => {
    // «Ready» used to mean two things: «the server confirmed, here is the entity» and «a
    // row exists, nothing could be asked». Everything reading `actor` — the settings screen
    // of MOL-41, a trip's currency — got null where the state promised otherwise.
    localStorage.setItem(KEY, FIRST.id)
    online(false)
    const { store } = await freshStore()

    await store.start()

    expect(store.state).toBe('offline')
    expect(store.actor).toBeNull()
    // Usable all the same: the drawer has a name, and a precached screen can be shown as this
    // person. What is missing is the confirmation, not the identity.
    expect(store.id).toBe(FIRST.id)
  })
})

describe('a session the server does not know', () => {
  it('signs in again and takes the new owner as its own', async () => {
    localStorage.setItem(KEY, FIRST.id)
    const { store, identity } = await freshStore()
    me.mockRejectedValue(await refusal())
    devLogin.mockResolvedValue(SECOND)

    await store.start()

    expect(store.state).toBe('ready')
    expect(localStorage.getItem(KEY)).toBe(SECOND.id)
    expect(identity.currentIdentity()).toBe(SECOND.id)
  })

  it('says «error» when it cannot sign in either', async () => {
    const { store } = await freshStore()
    me.mockRejectedValue(await refusal())
    devLogin.mockRejectedValue(new Error('fetch failed'))

    await store.start()

    expect(store.state).toBe('error')
  })

  it('does not sign in again when the network is at fault', async () => {
    // A failure that is not «no such session» must not start a second account: the cookie may
    // be perfectly alive behind a captive portal.
    localStorage.setItem(KEY, FIRST.id)
    me.mockRejectedValue(new Error('fetch failed'))
    const { store } = await freshStore()

    await store.start()

    expect(store.state).toBe('error')
    expect(localStorage.getItem(KEY)).toBe(FIRST.id)
    expect(devLogin).not.toHaveBeenCalled()
  })
})

describe('two tabs opened at once', () => {
  it('asks again under the lock instead of opening a second session', async () => {
    // The old machinery published an identifier through storage and the other tab adopted it.
    // A cookie needs none of that: it belongs to the origin, so the tab that waited simply
    // asks the server again and is recognised.
    const { store } = await freshStore()
    me.mockRejectedValueOnce(await refusal()).mockResolvedValue(FIRST)

    await store.start()

    expect(devLogin).not.toHaveBeenCalled()
    expect(store.id).toBe(FIRST.id)
    expect(store.state).toBe('ready')
  })

  it('refuses to start twice in the same tab while the first attempt is running', async () => {
    // `retry` is the store's public name for `start`, and a retry button is wired to it.
    let release: (actor: ActorView) => void = () => undefined
    me.mockReturnValue(
      new Promise<ActorView>((resolve) => {
        release = resolve
      }),
    )
    const { store } = await freshStore()

    const first = store.start()
    const second = store.retry()
    release(FIRST)
    await Promise.all([first, second])

    expect(me).toHaveBeenCalledTimes(1)
    expect(store.state).toBe('ready')
  })
})
