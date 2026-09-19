import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR, tripViewCodec } from '@molvia/model'
import type { TripView } from '@molvia/model'
import { useActorStore } from '@/stores/actor'
import { useTripStore } from '@/stores/trip'

const currentTrip = vi.fn<() => Promise<TripView | null>>()
vi.mock('@/api', () => ({ api: { currentTrip: () => currentTrip() } }))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const OTHER = '2c4e6a80-1111-4222-8333-444455556666'

function trip(id: string, over: { finishedAt?: string | null; amount?: string } = {}): TripView {
  return tripViewCodec.parse({
    id,
    startedAt: '2026-09-19T08:00:00.000Z',
    finishedAt: over.finishedAt ?? null,
    currency: 'AMD',
    rate: null,
    rateJump: null,
    rateStale: false,
    place: { id: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'store', name: 'Ереван Сити' },
    expenses: [],
    total: over.amount ? [{ amount: over.amount, currency: 'AMD' }] : [],
    converted: null,
  })
}

const OPEN = 'bbbbbbbb-0000-4000-8000-000000000001'
const LATER = 'bbbbbbbb-0000-4000-8000-000000000002'

function fresh(identity: string | null = ME) {
  if (identity) localStorage.setItem('molvia.actor', identity)
  setActivePinia(createPinia())
  return useTripStore()
}

describe('trip store', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    currentTrip.mockReset()
  })

  it('takes the trip the server answered with, whole', async () => {
    currentTrip.mockResolvedValue(trip(OPEN, { amount: '520.00' }))
    const store = fresh()
    await store.load()
    expect(store.current?.id).toBe(OPEN)
    expect(store.current?.total).toEqual([{ minor: 52000n, currency: 'AMD' }])
  })

  it('no trip is a state, not a failure', async () => {
    currentTrip.mockResolvedValue(null)
    const store = fresh()
    await store.load()
    expect(store.current).toBeNull()
  })

  it('remembers the trip across a restart, bigints included', async () => {
    currentTrip.mockResolvedValue(trip(OPEN, { amount: '5403.12' }))
    await fresh().load()

    const restarted = fresh()
    expect(restarted.current?.id).toBe(OPEN)
    expect(restarted.current?.total).toEqual([{ minor: 540312n, currency: 'AMD' }])
  })

  it('keeps what it remembers when the server cannot be reached', async () => {
    currentTrip.mockResolvedValue(trip(OPEN))
    await fresh().load()

    currentTrip.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
    const offline = fresh()
    await expect(offline.load()).rejects.toThrow(ApiError)
    expect(offline.current?.id).toBe(OPEN)
  })

  it('forgets a trip the server says is over', async () => {
    currentTrip.mockResolvedValue(trip(OPEN))
    const store = fresh()
    await store.load()
    currentTrip.mockResolvedValue(null)
    await store.load()
    expect(fresh().current).toBeNull()
  })

  it('replaces the trip with its own later version', () => {
    const store = fresh()
    store.apply(trip(OPEN))
    store.apply(trip(OPEN, { amount: '570.00' }))
    expect(store.current?.total).toEqual([{ minor: 57000n, currency: 'AMD' }])
    expect(fresh().current?.total).toEqual([{ minor: 57000n, currency: 'AMD' }])
  })

  it('does not let a finished trip written into later take the place of the open one', () => {
    // The soy sauce found at home goes into the trip it was bought on (MOL-21); the person is
    // still on today's.
    const store = fresh()
    store.apply(trip(LATER))
    store.apply(trip(OPEN, { finishedAt: '2026-09-18T10:00:00.000Z', amount: '300.00' }))
    expect(store.current?.id).toBe(LATER)
  })

  it('takes a new open trip over the one it had', () => {
    const store = fresh()
    store.apply(trip(OPEN))
    store.apply(trip(LATER))
    expect(store.current?.id).toBe(LATER)
  })

  it('does not adopt a finished trip when it had none', () => {
    const store = fresh()
    store.apply(trip(OPEN, { finishedAt: '2026-09-19T10:00:00.000Z' }))
    expect(store.current).toBeNull()
  })

  it('gives each identity its own trip', async () => {
    const store = fresh()
    store.apply(trip(OPEN))

    const actor = useActorStore()
    actor.id = OTHER
    await nextTick()
    expect(store.current).toBeNull()

    store.apply(trip(LATER))
    actor.id = ME
    await nextTick()
    expect(store.current?.id).toBe(OPEN)
  })

  it('reads a broken memory as no trip rather than failing to start', () => {
    localStorage.setItem(`molvia.trip.${ME}`, '{"trip":{"id":"not a trip"}}')
    expect(fresh().current).toBeNull()
    localStorage.setItem(`molvia.trip.${ME}`, 'not json')
    expect(fresh().current).toBeNull()
  })

  it('keeps the trip in memory when storage refuses to write', () => {
    // An own property, as actor.test.ts does it: happy-dom keeps setItem there, and a spy on
    // the prototype stops intercepting after the first restore.
    const store = fresh()
    const shelves = [localStorage, sessionStorage].map((shelf) => ({
      shelf,
      working: shelf.setItem.bind(shelf),
    }))
    const define = (shelf: Storage, value: Storage['setItem']) =>
      Object.defineProperty(shelf, 'setItem', { configurable: true, writable: true, value })
    for (const { shelf } of shelves) {
      define(shelf, () => {
        throw new Error('QuotaExceededError')
      })
    }
    try {
      store.apply(trip(OPEN))
      expect(store.current?.id).toBe(OPEN)
      expect(localStorage.getItem(`molvia.trip.${ME}`)).toBeNull()
    } finally {
      for (const { shelf, working } of shelves) define(shelf, working)
    }
  })
})
