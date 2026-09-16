import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ERROR } from '@molvia/model'
import type { Actor } from '@molvia/model'
// Nothing is imported from the store or the identity module at the top on purpose: every
// test loads them through `freshStore`, and a module captured here would be a second copy
// with its own in-memory identifier — the assertions would then read a value the code under
// test never wrote.

const createActor = vi.fn<(code: string) => Promise<Actor>>()
const me = vi.fn<() => Promise<Actor>>()
vi.mock('@/api', () => ({
  api: { createActor: (code: string) => createActor(code), me: () => me() },
}))

const KEY = 'molvia.actor'
const INVITE_KEY = 'molvia.invite'
const LOST_KEY = 'molvia.actor.lost'

function actorWith(id: string): Actor {
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

function openedWith(search: string): void {
  window.history.replaceState({}, '', `/${search}`)
}

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
 * The class matters: the store decides that an identity is gone with `error instanceof
 * ApiError`, and after `vi.resetModules()` a class imported at the top of this file is a
 * different one from the class the store compares against. A rejection built with it would
 * be read as an ordinary failure, and every test about a refused code or a dead identity
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
  createActor.mockReset()
  me.mockReset()
  online(true)
  openedWith('?c=let-me-in')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('the first launch', () => {
  it('creates an identity, stores it and stops asking', async () => {
    createActor.mockResolvedValue(FIRST)
    const { store } = await freshStore()

    await store.start()

    expect(createActor).toHaveBeenCalledWith('let-me-in')
    expect(localStorage.getItem(KEY)).toBe(FIRST.id)
    expect(store.state).toBe('ready')
  })

  it('scrubs the invite code out of the address bar once it is saved', async () => {
    // The query lands in history, in screenshots, in the `start_url` of an installed PWA
    // and in every `Referer` the page sends — the same reason the identifier never goes
    // into a query in the first place.
    createActor.mockResolvedValue(FIRST)
    const { store } = await freshStore()

    await store.start()

    expect(window.location.search).not.toContain('c=')
    expect(localStorage.getItem(INVITE_KEY)).toBe('let-me-in')
  })

  it('remembers the invite code, so the next launch needs no link', async () => {
    createActor.mockResolvedValue(FIRST)
    await (await freshStore()).store.start()

    localStorage.removeItem(KEY)
    openedWith('')
    createActor.mockResolvedValue(SECOND)

    await (await freshStore()).store.start()

    expect(createActor).toHaveBeenLastCalledWith('let-me-in')
  })

  it('does not even try without a code: the refusal would explain nothing', async () => {
    openedWith('')
    const { store } = await freshStore()

    await store.start()

    expect(createActor).not.toHaveBeenCalled()
    expect(store.state).toBe('uninvited')
  })

  it('says «uninvited», not «broken», when the door refuses the code', async () => {
    // A rotated or mistyped code used to land in the state meant for an outage, and the
    // person read «the server did not answer» about a link that was simply wrong.
    const { store } = await freshStore()
    createActor.mockRejectedValue(await refusal())

    await store.start()

    expect(store.state).toBe('uninvited')
  })

  it('forgets a refused code instead of handing it over on every retry', async () => {
    const { store } = await freshStore()
    createActor.mockRejectedValue(await refusal())

    await store.start()
    openedWith('')
    await store.retry()

    expect(localStorage.getItem(INVITE_KEY)).toBeNull()
    expect(createActor).toHaveBeenCalledTimes(1)
  })

  it('says «offline» instead of hanging, and recovers when the network returns', async () => {
    online(false)
    const { store } = await freshStore()

    await store.start()
    expect(store.state).toBe('offline')
    expect(createActor).not.toHaveBeenCalled()

    online(true)
    createActor.mockResolvedValue(FIRST)
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => {
      expect(store.state).toBe('ready')
    })
  })
})

describe('a device whose storage refuses writes', () => {
  it('still carries the identity in every request for the rest of the session', async () => {
    // The whole point: the store used to call itself ready while the client read the header
    // straight out of `localStorage`, so every request went out anonymous — and the app it
    // happened in believed it was fine.
    createActor.mockResolvedValue(FIRST)

    await withBrokenLocalStorage(async () => {
      const { store, identity } = await freshStore()

      await store.start()

      expect(store.state).toBe('ready')
      expect(identity.currentIdentity()).toBe(FIRST.id)
    })
  })

  it('does not hand out a new identity on the next launch of the same session', async () => {
    // Rows in `actors` are the denominator of the 0.2 gate; an iPhone in private mode used
    // to inflate it by itself, one row per launch.
    createActor.mockResolvedValueOnce(FIRST).mockResolvedValueOnce(SECOND)
    me.mockResolvedValue(FIRST)

    await withBrokenLocalStorage(async () => {
      await (await freshStore()).store.start()
      const { store } = await freshStore()
      await store.start()

      expect(createActor).toHaveBeenCalledTimes(1)
      expect(store.id).toBe(FIRST.id)
    })
  })
})

describe('a launch with an identity already stored', () => {
  it('asks whether it is still alive instead of creating another', async () => {
    localStorage.setItem(KEY, FIRST.id)
    me.mockResolvedValue(FIRST)
    const { store } = await freshStore()

    await store.start()

    expect(me).toHaveBeenCalled()
    expect(createActor).not.toHaveBeenCalled()
    expect(store.state).toBe('ready')
  })

  it('sets the old identifier aside rather than deleting it, and says what happened', async () => {
    localStorage.setItem(KEY, FIRST.id)
    const { store } = await freshStore()
    me.mockRejectedValue(await refusal())
    createActor.mockResolvedValue(SECOND)

    await store.start()

    expect(localStorage.getItem(KEY)).toBe(SECOND.id)
    expect(localStorage.getItem(LOST_KEY)).toBe(FIRST.id)
    expect(store.state).toBe('lost')
  })

  it('keeps the old identifier even when the replacement fails', async () => {
    // A 401 is not proof that the row is gone: a database restored from the wrong backup, an
    // API pointed at the wrong place, a proxy in front of it. Deleting first left a valid
    // identifier nowhere at all — and the data behind it unreachable for good.
    localStorage.setItem(KEY, FIRST.id)
    const { store, identity } = await freshStore()
    me.mockRejectedValue(await refusal())
    createActor.mockRejectedValue(new Error('fetch failed'))

    await store.start()

    expect(store.state).toBe('error')
    expect(identity.lostIdentity()).toBe(FIRST.id)
  })

  it('does not throw the identity away when the network is at fault', async () => {
    localStorage.setItem(KEY, FIRST.id)
    me.mockRejectedValue(new Error('fetch failed'))
    const { store } = await freshStore()

    await store.start()

    expect(store.state).toBe('error')
    expect(localStorage.getItem(KEY)).toBe(FIRST.id)
    expect(createActor).not.toHaveBeenCalled()
  })
})

describe('two tabs opened at once', () => {
  it('adopts what the other tab published instead of creating a second identity', async () => {
    localStorage.setItem('molvia.actor.claiming', String(Date.now()))
    me.mockResolvedValue(FIRST)
    const { store } = await freshStore()

    const started = store.start()
    // The other tab finished and published; happy-dom does not deliver storage events
    // between «tabs», so this is the event that tab would have sent.
    localStorage.setItem(KEY, FIRST.id)
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: FIRST.id }))
    await started

    expect(createActor).not.toHaveBeenCalled()
    expect(store.id).toBe(FIRST.id)
    expect(store.state).toBe('ready')
  })

  it('ignores a published value that could not be an identifier', async () => {
    // Whatever arrives in a storage event used to become this device's identity: the store
    // then held one id in memory, another in `actor`, and nothing in storage.
    localStorage.setItem('molvia.actor.claiming', String(Date.now()))
    createActor.mockResolvedValue(SECOND)
    const { store } = await freshStore()

    const started = store.start()
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'not-a-uuid' }))
    localStorage.setItem(KEY, FIRST.id)
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: FIRST.id }))
    me.mockResolvedValue(FIRST)
    await started

    expect(store.id).toBe(FIRST.id)
    expect(store.id).toBe(store.actor?.id)
  })

  it('refuses to start twice in the same tab while the first attempt is running', async () => {
    // `retry` is the store's public name for `start`, and a retry button is wired to it.
    // Without a guard the second call queued behind a claim this tab set itself.
    let release: (actor: Actor) => void = () => undefined
    createActor.mockReturnValue(
      new Promise<Actor>((resolve) => {
        release = resolve
      }),
    )
    const { store } = await freshStore()

    const first = store.start()
    const second = store.retry()
    release(FIRST)
    await Promise.all([first, second])

    expect(createActor).toHaveBeenCalledTimes(1)
    expect(store.state).toBe('ready')
  })
})

describe('the identity module', () => {
  it('keeps a set-aside identifier readable, so a server-side mistake stays recoverable', async () => {
    localStorage.setItem(KEY, FIRST.id)
    const { store, identity } = await freshStore()
    me.mockRejectedValue(await refusal())
    createActor.mockResolvedValue(SECOND)

    await store.start()

    expect(identity.lostIdentity()).toBe(FIRST.id)
    expect(identity.currentIdentity()).not.toBe(FIRST.id)
  })
})
