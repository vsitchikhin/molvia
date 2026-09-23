import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { tripViewCodec } from '@molvia/model'
import type { TripHistory, TripHistoryEntry, TripView } from '@molvia/model'
import { useTripHistoryStore } from './tripHistory'
import { useTripStore } from './trip'

const trip = vi.fn<(id: string) => Promise<TripView>>()
const tripHistory = vi.fn<() => Promise<TripHistory>>()
vi.mock('@/api', () => ({
  api: { trip: (id: string) => trip(id), tripHistory: () => tripHistory() },
}))
const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001'
const A = 'aaaaaaaa-0000-4000-8000-000000000002'
const B = 'aaaaaaaa-0000-4000-8000-000000000003'
const C = 'aaaaaaaa-0000-4000-8000-000000000004'
function entry(id: string, finishedOnDeviceAt = '2026-09-01T10:30:00Z'): TripHistoryEntry {
  return {
    id,
    place: { id: OWNER, kind: 'store', name: 'Рынок' },
    startedAt: new Date('2026-09-01T10:00:00Z'),
    finishedAt: new Date('2026-09-01T11:00:00Z'),
    finishedOnDeviceAt: new Date(finishedOnDeviceAt),
  }
}
const cursor = (id: string) => ({ at: '2026-09-01T00:00:00.123456Z', id })
function view(id: string, finished = true): TripView {
  return tripViewCodec.parse({
    id,
    startedAt: '2026-09-01T10:00:00Z',
    finishedAt: finished ? '2026-09-01T11:00:00Z' : null,
    finishedOnDeviceAt: finished ? '2026-09-01T10:30:00Z' : null,
    currency: 'AMD',
    rate: null,
    rateProvider: null,
    rateJump: null,
    rateStale: false,
    place: { id: OWNER, kind: 'store', name: 'Рынок' },
    expenses: [],
    total: [],
    converted: null,
  })
}
function restart() {
  setActivePinia(createPinia())
  return useTripHistoryStore()
}
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('molvia.actor', OWNER)
  vi.resetAllMocks()
  setActivePinia(createPinia())
})

describe('history memory', () => {
  it('keeps a local completion across restart, before a server trip exists', () => {
    const store = useTripHistoryStore()
    store.capture(
      A,
      'Рынок',
      new Date('2026-09-01T10:00:00Z'),
      new Date('2026-09-01T10:30:00Z'),
      'AMD',
      null,
    )
    expect(restart().local).toEqual(store.local)
  })

  it('updates an explicitly selected old trip without replacing the current one', async () => {
    const store = useTripHistoryStore()
    const current = useTripStore()
    current.apply(view(B, false))
    trip.mockResolvedValue(view(A))
    await store.open(A)
    current.apply({ ...view(A), currency: 'EUR' })
    expect(store.selected?.currency).toBe('EUR')
    expect(current.current?.id).toBe(B)
    expect(restart().selected?.id).toBe(A)
  })

  // Both ways in: with the trip already on the phone and without it. They used to be two tests
  // that differed only in that line and asserted the same thing (З-9).
  it.each([true, false])(
    'does not let an older read replace an answered write (cached: %s)',
    async (cached) => {
      const store = useTripHistoryStore()
      if (cached) store.selected = view(A)
      let resolve: ((value: TripView) => void) | undefined
      trip.mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done
          }),
      )
      const loading = store.open(A)
      store.apply({ ...view(A), currency: 'EUR' })
      resolve?.(view(A))
      await loading
      expect(store.selected?.currency).toBe('EUR')
    },
  )

  it('keeps completions made by two windows even before storage events arrive', () => {
    const first = useTripHistoryStore()
    const second = useTripHistoryStore(createPinia())
    first.capture(A, 'Рынок', new Date(), new Date(), 'AMD', view(A))
    second.capture(B, 'SAS', new Date(), new Date(), 'AMD', view(B))
    expect(restart().local.map((row) => row.id)).toEqual([A, B])
  })

  it('does not replace this window’s selection when another window opens a different trip', async () => {
    const first = useTripHistoryStore()
    trip.mockResolvedValueOnce(view(A)).mockResolvedValueOnce(view(B))
    await first.open(A)
    const second = useTripHistoryStore(createPinia())
    await second.open(B)
    window.dispatchEvent(new StorageEvent('storage', { key: `molvia.trip-history.${OWNER}` }))
    expect(first.selected?.id).toBe(A)
  })

  it('keeps the trip it holds when a tap on another one cannot be read', async () => {
    const store = useTripHistoryStore()
    trip.mockResolvedValueOnce(view(A))
    await store.open(A)
    trip.mockRejectedValueOnce(new Error('offline'))
    await expect(store.open(B)).rejects.toThrow()
    expect(store.selected?.id).toBe(A)
    // The write that follows must not save the emptiness over it.
    store.apply(view(A, false))
    expect(restart().selected?.id).toBe(A)
  })

  it('does not throw away a history answer when a purchase reaches the current trip', async () => {
    const store = useTripHistoryStore()
    const current = useTripStore()
    let resolve: ((value: TripHistory) => void) | undefined
    tripHistory.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const loading = store.load()
    current.apply(view(B, false))
    resolve?.({ trips: [entry(A)], nextCursor: null })
    await loading
    expect(store.page.trips.map((row) => row.id)).toEqual([A])
  })

  it('still throws away an answer the phone’s own completion has outrun', async () => {
    const store = useTripHistoryStore()
    let resolve: ((value: TripHistory) => void) | undefined
    tripHistory.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const loading = store.load()
    store.capture(B, 'SAS', new Date(), new Date(), 'AMD', null)
    resolve?.({ trips: [entry(A)], nextCursor: null })
    await loading
    expect(store.page.trips).toEqual([])
    expect(store.local.map((row) => row.id)).toEqual([B])
  })

  it('forgets a local completion the server has taken, even off the first page', async () => {
    const store = useTripHistoryStore()
    store.capture(A, 'Рынок', new Date(), new Date(), 'AMD', view(A))
    trip.mockResolvedValue(view(A))
    tripHistory.mockResolvedValue({ trips: [entry(B)], nextCursor: null })
    await store.completed(A)
    expect(store.local).toEqual([])
    expect(restart().local).toEqual([])
  })

  it('keeps the pages already loaded when the first page is refreshed', async () => {
    const store = useTripHistoryStore()
    tripHistory
      .mockResolvedValueOnce({ trips: [entry(A, '2026-09-03T10:00:00Z')], nextCursor: cursor(A) })
      .mockResolvedValueOnce({ trips: [entry(B, '2026-09-02T10:00:00Z')], nextCursor: null })
      .mockResolvedValueOnce({
        trips: [entry(C, '2026-09-04T10:00:00Z'), entry(A, '2026-09-03T10:00:00Z')],
        nextCursor: cursor(A),
      })
    await store.load()
    await store.load(true)
    await store.load()
    expect(store.page.trips.map((row) => row.id)).toEqual([C, A, B])
    expect(store.page.nextCursor).toBeNull()
  })

  it('does not collapse the loaded pages when another window writes', async () => {
    const store = useTripHistoryStore()
    tripHistory
      .mockResolvedValueOnce({ trips: [entry(A, '2026-09-03T10:00:00Z')], nextCursor: cursor(A) })
      .mockResolvedValueOnce({ trips: [entry(B, '2026-09-02T10:00:00Z')], nextCursor: null })
    await store.load()
    await store.load(true)
    window.dispatchEvent(new StorageEvent('storage', { key: `molvia.trip-history.${OWNER}` }))
    expect(store.page.trips.map((row) => row.id)).toEqual([A, B])
  })

  it('caches the original first-page cursor, not the cursor after appended pages', async () => {
    const store = useTripHistoryStore()
    const first = { trips: [], nextCursor: { at: '2026-09-01T00:00:00.123456Z', id: A } }
    tripHistory.mockResolvedValueOnce(first).mockResolvedValueOnce({ trips: [], nextCursor: null })
    await store.load()
    await store.load(true)
    expect(store.page.nextCursor).toBeNull()
    expect(restart().page.nextCursor).toEqual(first.nextCursor)
  })
})
