import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { Actor } from '@molvia/model'
import { useActorStore } from '@/stores/actor'

const createActor = vi.fn<(code: string) => Promise<Actor>>()
const me = vi.fn<() => Promise<Actor>>()
vi.mock('@/api', () => ({
  api: { createActor: (code: string) => createActor(code), me: () => me() },
}))

const KEY = 'molvia.actor'
const LOCK_KEY = 'molvia.actor.claiming'

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

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
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
    const store = useActorStore()

    await store.start()

    expect(createActor).toHaveBeenCalledWith('let-me-in')
    expect(localStorage.getItem(KEY)).toBe(FIRST.id)
    expect(store.state).toBe('ready')
  })

  it('remembers the invite code, so the next launch needs no link', async () => {
    createActor.mockResolvedValue(FIRST)
    await useActorStore().start()

    // Second launch, this time opened from the home screen without the parameter.
    localStorage.removeItem(KEY)
    openedWith('')
    setActivePinia(createPinia())
    createActor.mockResolvedValue(SECOND)

    await useActorStore().start()

    expect(createActor).toHaveBeenLastCalledWith('let-me-in')
  })

  it('does not even try without a code: the refusal would explain nothing', async () => {
    openedWith('')
    const store = useActorStore()

    await store.start()

    expect(createActor).not.toHaveBeenCalled()
    // Not «lost»: nothing was lost, the app was opened without the link that carries the
    // code — and the two cases are told apart because their sentences differ.
    expect(store.state).toBe('uninvited')
  })

  it('keeps working when storage throws, for the length of this tab', async () => {
    // Safari's private mode throws on write rather than returning null. A blank screen
    // there would look exactly like a broken app.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    createActor.mockResolvedValue(FIRST)
    const store = useActorStore()

    await store.start()

    expect(store.state).toBe('ready')
    expect(store.id).toBe(FIRST.id)
  })

  it('says «offline» instead of hanging, and recovers on retry', async () => {
    online(false)
    const store = useActorStore()

    await store.start()
    expect(store.state).toBe('offline')
    expect(createActor).not.toHaveBeenCalled()

    online(true)
    createActor.mockResolvedValue(FIRST)
    await store.retry()

    expect(store.state).toBe('ready')
  })
})

describe('a launch with an identity already stored', () => {
  it('asks whether it is still alive instead of creating another', async () => {
    localStorage.setItem(KEY, FIRST.id)
    me.mockResolvedValue(FIRST)
    const store = useActorStore()

    await store.start()

    expect(me).toHaveBeenCalled()
    expect(createActor).not.toHaveBeenCalled()
    expect(store.state).toBe('ready')
  })

  it('starts a new identity when the stored one is gone, and says so', async () => {
    // Cleared storage on the server side, or `make db-reset` in development. The person is
    // told rather than handed a silently empty app — Ш-8 draws that message.
    localStorage.setItem(KEY, FIRST.id)
    me.mockRejectedValue(new ApiError(ERROR.NO_ACTOR))
    createActor.mockResolvedValue(SECOND)
    const store = useActorStore()

    await store.start()

    expect(createActor).toHaveBeenCalled()
    expect(localStorage.getItem(KEY)).toBe(SECOND.id)
    expect(store.state).toBe('lost')
  })

  it('does not throw the identity away when the network is at fault', async () => {
    localStorage.setItem(KEY, FIRST.id)
    me.mockRejectedValue(new Error('fetch failed'))
    const store = useActorStore()

    await store.start()

    expect(store.state).toBe('error')
    expect(localStorage.getItem(KEY)).toBe(FIRST.id)
    expect(createActor).not.toHaveBeenCalled()
  })
})

describe('two tabs opened at once', () => {
  it('gives both the same identity: the second waits instead of creating its own', async () => {
    // The first tab has claimed the creation and is mid-request.
    localStorage.setItem(LOCK_KEY, String(Date.now()))
    const store = useActorStore()

    const started = store.start()
    // The first tab finishes and publishes what it got; happy-dom does not deliver storage
    // events between «tabs», so the event is what the other tab would have sent.
    localStorage.setItem(KEY, FIRST.id)
    me.mockResolvedValue(FIRST)
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: FIRST.id }))
    await started

    expect(createActor).not.toHaveBeenCalled()
    expect(store.id).toBe(FIRST.id)
    expect(store.state).toBe('ready')
  })

  it('creates one anyway when the claiming tab died mid-request', async () => {
    // Without the timeout this tab would wait for a tab that will never answer, and the app
    // would simply never load in the second window.
    localStorage.setItem(LOCK_KEY, String(Date.now() - 60_000))
    createActor.mockResolvedValue(FIRST)
    const store = useActorStore()

    await store.start()

    expect(createActor).toHaveBeenCalled()
    expect(store.state).toBe('ready')
  })
})
