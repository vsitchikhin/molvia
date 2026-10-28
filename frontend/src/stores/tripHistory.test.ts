import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { tripHistoryCodec, tripViewCodec } from '@molvia/model'
import type { TripHistory, TripHistoryEntry, TripView } from '@molvia/model'
import { useTripHistoryStore } from './tripHistory'
import { useTripStore } from './trip'
import { useActorStore } from './actor'

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
    itemCount: null,
    total: null,
    fromReceipt: false,
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
/** The finished record `id` as the server answers a write into it: `bought` purchases of 500 ֏. */
function written(id: string, bought: number): TripView {
  return tripViewCodec.parse({
    ...tripViewCodec.encode(view(id)),
    expenses: Array.from({ length: bought }, (_, n) => ({
      id: `eeeeeeee-0000-4000-8000-00000000000${String(n)}`,
      createdAt: '2026-09-01T10:10:00Z',
      item: {
        id: `dddddddd-0000-4000-8000-00000000000${String(n)}`,
        kind: 'product',
        name: `Товар ${String(n)}`,
        note: null,
        defaultUnit: 'piece',
        typicalQuantity: null,
      },
      quantity: null,
      amount: { amount: '500.00', currency: 'AMD' },
      unitPrice: null,
    })),
    total: [{ amount: `${String(bought * 500)}.00`, currency: 'AMD' }],
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

describe('whether the server has answered an empty history (MOL-77)', () => {
  it('an empty answer is known, and stays known after a restart', async () => {
    const store = useTripHistoryStore()
    expect(store.answeredEmpty).toBe(false)
    tripHistory.mockResolvedValue({ trips: [], nextCursor: null })
    await store.load()
    expect(store.answeredEmpty).toBe(true)
    expect(restart().answeredEmpty).toBe(true)
  })

  it('a cache written by a trip write alone is not an answer', () => {
    // Every write persists the cache, first page empty or not: that page nobody asked for.
    useTripHistoryStore().apply(view(A, false))
    const again = restart()
    expect(again.page.trips).toEqual([])
    expect(again.answeredEmpty).toBe(false)
  })

  it('a failed load answers nothing', async () => {
    const store = useTripHistoryStore()
    tripHistory.mockRejectedValue(new Error('Failed to fetch'))
    await expect(store.load()).rejects.toThrow()
    expect(store.answeredEmpty).toBe(false)
  })

  it('an answer with trips takes the flag back — from every shelf, a full one too (round 2, Ж1)', async () => {
    const store = useTripHistoryStore()
    tripHistory.mockResolvedValueOnce({ trips: [], nextCursor: null })
    await store.load()
    expect(localStorage.getItem(`molvia.trip-history-empty.${OWNER}`)).toBe('1')

    // The shared shelf refuses every write now; removing needs no room.
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    tripHistory.mockResolvedValueOnce({ trips: [entry(A), entry(B)], nextCursor: null })
    await store.load()
    setItem.mockRestore()

    expect(store.answeredEmpty).toBe(false)
    expect(localStorage.getItem(`molvia.trip-history-empty.${OWNER}`)).toBeNull()
    expect(sessionStorage.getItem(`molvia.trip-history-empty.${OWNER}`)).toBeNull()
    // Whatever stale page a refusing shelf kept, a restart finds no «empty» beside it.
    expect(restart().answeredEmpty).toBe(false)
  })

  it('the cache keeps the previous version’s shape, so a window still on it can read it', () => {
    // A field the old strict codec did not know made it read the cache as none, and write its own
    // empty one over a finish made with no signal (adversarial Е).
    const store = useTripHistoryStore()
    store.capture(
      A,
      'Рынок',
      new Date('2026-09-01T10:00:00Z'),
      new Date('2026-09-01T10:30:00Z'),
      'AMD',
      null,
    )
    const cached = JSON.parse(
      localStorage.getItem(`molvia.trip-history.${OWNER}`) ?? '{}',
    ) as object
    expect(Object.keys(cached).sort()).toEqual(['local', 'page', 'selected'])
  })

  it('keeps no field of a trip the previous build cannot read, and reads one it does not know (MOL-115, Р-1)', () => {
    const store = useTripHistoryStore()
    store.capture(
      A,
      'Рынок',
      new Date('2026-09-01T10:00:00Z'),
      new Date('2026-09-01T10:30:00Z'),
      'AMD',
      view(A),
    )
    const cached = JSON.parse(localStorage.getItem(`molvia.trip-history.${OWNER}`) ?? '{}') as {
      local: { view: Record<string, unknown> }[]
    }
    const kept = Object.keys(cached.local[0]?.view ?? {})
    expect(kept).not.toContain('accountId')
    expect(kept).not.toContain('debited')
    // Read back, the fields are what their absence means.
    expect(restart().local[0]?.view).toMatchObject({ accountId: null, debited: null })

    // A later build's field is dropped, not the whole cache.
    const [row] = cached.local
    if (row) row.view.fromLaterBuild = true
    localStorage.setItem(`molvia.trip-history.${OWNER}`, JSON.stringify(cached))
    expect(restart().local.map(({ id }) => id)).toEqual([A])
  })

  it('keeps the count and the total of a row, read by every build since MOL-128, and reads a row of a later one (MOL-307)', async () => {
    const store = useTripHistoryStore()
    const total = [
      { minor: 410_000n, currency: 'AMD' as const },
      { minor: 1_250n, currency: 'USD' as const },
    ]
    tripHistory.mockResolvedValueOnce({
      trips: [{ ...entry(A), itemCount: 3, total }],
      nextCursor: null,
    })
    await store.load()

    const cached = JSON.parse(localStorage.getItem(`molvia.trip-history.${OWNER}`) ?? '{}') as {
      page: { trips: Record<string, unknown>[] }
    }
    // The page as the shelf keeps it is the contract's own, strict: a window of any build since
    // MOL-128 reads both fields, and drops none of the cache for them.
    expect(tripHistoryCodec.parse(cached.page).trips[0]).toMatchObject({ itemCount: 3, total })
    expect(restart().page.trips[0]).toMatchObject({ id: A, itemCount: 3, total })

    const [row] = cached.page.trips
    if (row) row.fromLaterBuild = true
    localStorage.setItem(`molvia.trip-history.${OWNER}`, JSON.stringify(cached))
    expect(restart().page.trips.map(({ id }) => id)).toEqual([A])
  })

  it('a row the build before shelved without them is unknown — not «0 позиций», after a write too (MOL-307)', async () => {
    const store = useTripHistoryStore()
    tripHistory.mockResolvedValueOnce({ trips: [entry(A)], nextCursor: null })
    await store.load()
    const cached = JSON.parse(localStorage.getItem(`molvia.trip-history.${OWNER}`) ?? '{}') as {
      page: { trips: Record<string, unknown>[] }
    }
    for (const row of cached.page.trips) {
      delete row.itemCount
      delete row.total
    }
    localStorage.setItem(`molvia.trip-history.${OWNER}`, JSON.stringify(cached))
    const again = restart()
    expect(again.page.trips[0]).toMatchObject({ id: A, itemCount: null, total: null })
    // Written back by this build, unknown stays unknown.
    again.apply(view(B, false))
    expect(restart().page.trips[0]).toMatchObject({ id: A, itemCount: null, total: null })
  })

  it('a sum in a currency this build does not know is a sum not known, never the whole cache (adversarial А2 of MOL-307)', async () => {
    const store = useTripHistoryStore()
    // A record finished on this phone with no signal: its snapshot waits on the shelf.
    store.capture(
      C,
      'SAS',
      new Date('2026-09-02T10:00:00Z'),
      new Date('2026-09-02T11:00:00Z'),
      'AMD',
      null,
    )
    tripHistory.mockResolvedValueOnce({
      trips: [{ ...entry(A), itemCount: 1, total: [{ minor: 500n, currency: 'GEL' }] }],
      nextCursor: null,
    })
    await store.load()
    // The shelf as a later build writes it: a currency of a country this build has not got.
    const cached = JSON.parse(localStorage.getItem(`molvia.trip-history.${OWNER}`) ?? '{}') as {
      page: { trips: { total: { currency: string }[] }[] }
    }
    for (const row of cached.page.trips) for (const sum of row.total) sum.currency = 'KZT'
    localStorage.setItem(`molvia.trip-history.${OWNER}`, JSON.stringify(cached))

    const again = restart()
    expect(again.page.trips[0]).toMatchObject({ id: A, itemCount: 1, total: null })
    expect(again.local.map(({ id }) => id)).toEqual([C])
    // Its next write keeps the finish made with no signal.
    again.capture(
      B,
      'Гая 5',
      new Date('2026-09-03T10:00:00Z'),
      new Date('2026-09-03T11:00:00Z'),
      'AMD',
      null,
    )
    expect(restart().local.map(({ id }) => id)).toEqual([C, B])
  })

  it('a purchase written into a recorded record moves its row on the shelf too (adversarial А1 of MOL-307)', async () => {
    const store = useTripHistoryStore()
    tripHistory.mockResolvedValueOnce({
      trips: [{ ...entry(A), itemCount: 2, total: [{ minor: 100_000n, currency: 'AMD' }] }],
      nextCursor: null,
    })
    await store.load()
    // The queue's answer to a purchase written into the finished record.
    store.apply(written(A, 3))
    expect(store.page.trips[0]).toMatchObject({ id: A, itemCount: 3 })
    // Another window writes the shelf — what is on it, as its own `persist` would.
    window.dispatchEvent(new StorageEvent('storage', { key: `molvia.trip-history.${OWNER}` }))
    expect(store.page.trips[0]).toMatchObject({ id: A, itemCount: 3 })
    expect(store.page.trips[0]?.total?.[0]?.minor).toBe(150_000n)
    expect(restart().page.trips[0]).toMatchObject({ id: A, itemCount: 3 })
  })

  it('a row another window of this build moved is the answer, while it moves the list under every read (adversarial А3 of MOL-307)', async () => {
    const store = useTripHistoryStore()
    tripHistory.mockResolvedValueOnce({
      trips: [{ ...entry(A), itemCount: 2, total: [{ minor: 100_000n, currency: 'AMD' }] }],
      nextCursor: null,
    })
    await store.load()
    const theirs = useTripHistoryStore(createPinia())
    // The other window sends a purchase into the recorded record while this one reads the list: its
    // answer goes on the shelf, and the server has it.
    tripHistory.mockImplementationOnce(() => {
      theirs.apply(written(A, 3))
      window.dispatchEvent(new StorageEvent('storage', { key: `molvia.trip-history.${OWNER}` }))
      return Promise.resolve({
        trips: [{ ...entry(A), itemCount: 3, total: [{ minor: 150_000n, currency: 'AMD' }] }],
        nextCursor: null,
      })
    })
    // Discarded — the list moved under it — and still the page shown is the server's.
    expect(await store.load()).toBe(false)
    expect(store.page.trips[0]).toMatchObject({ id: A, itemCount: 3 })
    expect(store.showsAnswer()).toBe(true)
  })

  it('a record with no purchases keeps «0» and no sum on the shelf, not «unknown» (MOL-307)', async () => {
    const store = useTripHistoryStore()
    tripHistory.mockResolvedValueOnce({
      trips: [{ ...entry(A), itemCount: 0, total: [] }],
      nextCursor: null,
    })
    await store.load()
    expect(restart().page.trips[0]).toMatchObject({ id: A, itemCount: 0, total: [] })
  })

  it('another owner’s answer is not this owner’s', async () => {
    const store = useTripHistoryStore()
    tripHistory.mockResolvedValue({ trips: [], nextCursor: null })
    await store.load()
    useActorStore().id = A
    await nextTick()
    expect(store.answeredEmpty).toBe(false)
  })
})

describe('when the server answered the first page (MOL-204)', () => {
  const AT = `molvia.trip-history-at.${OWNER}`

  it('is kept with the first page, under a key of its own, and read back after a restart', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-27T10:05:00Z'))
    const store = useTripHistoryStore()
    expect(store.answeredAt).toBeNull()
    tripHistory.mockResolvedValue({ trips: [entry(A)], nextCursor: cursor(A) })
    await store.load()
    vi.useRealTimers()
    expect(store.answeredAt?.toISOString()).toBe('2026-09-27T10:05:00.000Z')
    expect(localStorage.getItem(AT)).toBe('2026-09-27T10:05:00.000Z')
    // Not a field of the cache: the previous build reads that strictly (Р-3).
    expect(localStorage.getItem(`molvia.trip-history.${OWNER}`)).not.toContain('2026-09-27T10:05')
    expect(restart().answeredAt?.toISOString()).toBe('2026-09-27T10:05:00.000Z')
  })

  it('is not moved by «Показать ещё», a failed load or a write to a trip', async () => {
    localStorage.setItem(AT, '2026-09-27T10:05:00.000Z')
    const store = restart()
    tripHistory.mockResolvedValueOnce({ trips: [entry(B)], nextCursor: null })
    // A next page is asked for only past a cursor, so the first page is put there first.
    store.page = { trips: [entry(A)], nextCursor: cursor(A) }
    await store.load(true)
    tripHistory.mockRejectedValueOnce(new Error('Failed to fetch'))
    await expect(store.load()).rejects.toThrow()
    store.apply(view(C, false))
    expect(store.answeredAt?.toISOString()).toBe('2026-09-27T10:05:00.000Z')
    expect(localStorage.getItem(AT)).toBe('2026-09-27T10:05:00.000Z')
  })

  it('a cache from before the key, or anything but a date under it, is no moment', () => {
    useTripHistoryStore().apply(view(A))
    expect(restart().answeredAt).toBeNull()
    localStorage.setItem(AT, 'вчера')
    expect(restart().answeredAt).toBeNull()
  })

  it('a shelf that refuses the page keeps no moment newer than the page it keeps (adversarial А5)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-20T10:00:00Z'))
    const store = useTripHistoryStore()
    tripHistory.mockResolvedValueOnce({ trips: [entry(A)], nextCursor: null })
    await store.load()
    // The shared shelf is full: the page with one more trip does not fit, a date would. happy-dom
    // keeps `setItem` on the instance, so it is replaced there.
    const working = localStorage.setItem.bind(localStorage)
    const define = (value: Storage['setItem']) =>
      Object.defineProperty(localStorage, 'setItem', { configurable: true, writable: true, value })
    define((key: string, value: string) => {
      if (key === `molvia.trip-history.${OWNER}` && value.includes(B))
        throw new DOMException('quota', 'QuotaExceededError')
      working(key, value)
    })
    try {
      vi.setSystemTime(new Date('2026-09-27T14:05:00Z'))
      tripHistory.mockResolvedValueOnce({ trips: [entry(B), entry(A)], nextCursor: null })
      await store.load()
    } finally {
      define(working)
      vi.useRealTimers()
    }
    // This window holds the new page, and its moment.
    expect(store.answeredAt?.toISOString()).toBe('2026-09-27T14:05:00.000Z')
    // Opened again at the shelf: the page of 20 Sept., and no moment of 27 Sept. over it.
    sessionStorage.clear()
    const again = restart()
    expect(again.page.trips.map((row) => row.id)).toEqual([A])
    expect(again.answeredAt).toBeNull()
  })

  it('a page put back on the shelf takes back its own moment, not a newer one (adversarial Б4)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-20T10:00:00Z'))
    const store = useTripHistoryStore()
    tripHistory.mockResolvedValueOnce({ trips: [entry(A)], nextCursor: null })
    await store.load()
    vi.useRealTimers()
    // Another window answered on 27 Sept. and this one did not hear it before its own write.
    localStorage.setItem(AT, '2026-09-27T14:05:00.000Z')
    store.apply(view(C, false))
    expect(localStorage.getItem(AT)).toBe('2026-09-20T10:00:00.000Z')
    sessionStorage.clear()
    expect(restart().answeredAt?.toISOString()).toBe('2026-09-20T10:00:00.000Z')
  })

  it('a page with no moment known puts none on the shelf', () => {
    localStorage.setItem(AT, '2026-09-27T14:05:00.000Z')
    const store = useTripHistoryStore()
    store.answeredAt = null
    store.apply(view(C))
    expect(localStorage.getItem(AT)).toBeNull()
  })

  it('shows the answer while the page on the phone is the server’s last, row for row (adversarial В1, Б4)', async () => {
    const store = useTripHistoryStore()
    expect(store.showsAnswer()).toBe(false)
    tripHistory.mockResolvedValueOnce({ trips: [entry(A)], nextCursor: null })
    await store.load()
    expect(store.showsAnswer()).toBe(true)
    // Another window puts back a page the answer is not: memory.
    localStorage.setItem(
      `molvia.trip-history.${OWNER}`,
      JSON.stringify({
        page: {
          trips: [
            {
              id: B,
              place: entry(B).place,
              startedAt: entry(B).startedAt.toISOString(),
              finishedAt: entry(B).finishedAt.toISOString(),
              finishedOnDeviceAt: null,
            },
          ],
          nextCursor: null,
        },
        selected: null,
        local: [],
      }),
    )
    window.dispatchEvent(new StorageEvent('storage', { key: `molvia.trip-history.${OWNER}` }))
    expect(store.showsAnswer()).toBe(false)
  })

  it('a row read back from the shelf another window wrote keeps its count and sum, and is the answer (Г1 of MOL-204, MOL-307)', async () => {
    const store = useTripHistoryStore()
    const counted = {
      ...entry(A),
      itemCount: 3,
      total: [{ minor: 120000n, currency: 'AMD' as const }],
    }
    tripHistory.mockResolvedValueOnce({ trips: [counted], nextCursor: null })
    await store.load()
    // Another window wrote this very answer: the page is read back from the shelf.
    window.dispatchEvent(new StorageEvent('storage', { key: `molvia.trip-history.${OWNER}` }))
    expect(store.page.trips[0]).toMatchObject({ itemCount: 3, total: counted.total })
    expect(store.showsAnswer()).toBe(true)
  })

  it('a shelf with another count, or none, is the answer by its rows, and its counts are unconfirmed (MOL-307, В-2 «а»)', async () => {
    const store = useTripHistoryStore()
    tripHistory.mockResolvedValueOnce({
      trips: [{ ...entry(A), itemCount: 3, total: [{ minor: 120000n, currency: 'AMD' }] }],
      nextCursor: null,
    })
    await store.load()
    const shelf = (change: (row: Record<string, unknown>) => void) => {
      const cached = JSON.parse(localStorage.getItem(`molvia.trip-history.${OWNER}`) ?? '{}') as {
        page: { trips: Record<string, unknown>[] }
      }
      for (const row of cached.page.trips) change(row)
      localStorage.setItem(`molvia.trip-history.${OWNER}`, JSON.stringify(cached))
      window.dispatchEvent(new StorageEvent('storage', { key: `molvia.trip-history.${OWNER}` }))
    }
    expect(store.unconfirmed()).toEqual(new Set())
    // A window that sent a purchase meanwhile wrote its newer page — or one older than the answer:
    // which, the phone cannot tell.
    shelf((row) => (row.itemCount = 4))
    expect(store.page.trips[0]?.itemCount).toBe(4)
    expect(store.showsAnswer()).toBe(true)
    expect(store.unconfirmed()).toEqual(new Set([A]))
    // A sum alone the answer does not say.
    shelf((row) => {
      row.itemCount = 3
      row.total = [{ amount: '1300.00', currency: 'AMD' }]
    })
    expect(store.unconfirmed()).toEqual(new Set([A]))
    // A window of the build before wrote the same page without the counts.
    shelf((row) => {
      delete row.itemCount
      delete row.total
    })
    expect(store.page.trips[0]?.itemCount).toBeNull()
    expect(store.showsAnswer()).toBe(true)
    expect(store.unconfirmed()).toEqual(new Set([A]))
  })

  it('another owner’s moment is not this owner’s', () => {
    localStorage.setItem(`molvia.trip-history-at.${A}`, '2026-09-27T10:05:00.000Z')
    expect(restart().answeredAt).toBeNull()
  })
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

  it('drops the snapshot of a completion the server has taken, keeping the row', async () => {
    const store = useTripHistoryStore()
    store.capture(A, 'Рынок', new Date(), new Date(), 'AMD', view(A))
    trip.mockResolvedValue(view(A))
    tripHistory.mockResolvedValue({ trips: [entry(B)], nextCursor: null })
    await store.completed(A)
    // The heavy `TripView` goes; the row waits for a page to carry it (А6 + В1).
    expect(store.local.map((row) => [row.id, row.view])).toEqual([[A, null]])
    expect(restart().local.map((row) => row.id)).toEqual([A])
  })

  it('keeps a completion when the list after it never arrived', async () => {
    const store = useTripHistoryStore()
    store.capture(A, 'Рынок', new Date(), new Date(), 'AMD', view(A))
    trip.mockResolvedValue(view(A))
    tripHistory.mockRejectedValue(new Error('offline'))
    await store.completed(A)
    // Neither a storage event from another window nor a restart may take it away: `page.value`
    // is rebuilt from what was written to the phone, and that is `firstPage` (В1).
    window.dispatchEvent(new StorageEvent('storage', { key: `molvia.trip-history.${OWNER}` }))
    expect(store.local.map((row) => row.id)).toEqual([A])
    expect(restart().local.map((row) => row.id)).toEqual([A])
  })

  it('drops the row once a page carries it', async () => {
    const store = useTripHistoryStore()
    store.capture(A, 'Рынок', new Date(), new Date(), 'AMD', view(A))
    trip.mockResolvedValue(view(A))
    tripHistory.mockResolvedValue({ trips: [entry(A)], nextCursor: null })
    await store.completed(A)
    expect(store.local).toEqual([])
  })

  it('drops a next page read from a boundary that moved while it was in flight', async () => {
    const store = useTripHistoryStore()
    tripHistory.mockResolvedValueOnce({
      trips: [entry(A, '2026-09-03T10:00:00Z')],
      nextCursor: cursor(A),
    })
    await store.load()
    let second: ((value: TripHistory) => void) | undefined
    tripHistory.mockImplementationOnce(
      () =>
        new Promise((done) => {
          second = done
        }),
    )
    const more = store.load(true)
    // While it is out, a completion lands in the first page and pushes its last row off: the
    // page still on its way starts below where that row now is (Д2).
    tripHistory.mockResolvedValueOnce({
      trips: [entry(C, '2026-09-04T10:00:00Z')],
      nextCursor: cursor(C),
    })
    await store.load()
    second?.({ trips: [entry(B, '2026-09-02T10:00:00Z')], nextCursor: null })
    await more
    expect(store.page.trips.map((row) => row.id)).toEqual([C])
    expect(store.page.nextCursor).toEqual(cursor(C))
  })

  it('reads the tail again when the first page has moved under it', async () => {
    const store = useTripHistoryStore()
    tripHistory
      .mockResolvedValueOnce({ trips: [entry(A, '2026-09-03T10:00:00Z')], nextCursor: cursor(A) })
      .mockResolvedValueOnce({ trips: [entry(B, '2026-09-02T10:00:00Z')], nextCursor: null })
      // A completion arrived while the second page was being read: the first page now ends
      // somewhere else, and the rows in between could never be reached (В-1).
      .mockResolvedValueOnce({ trips: [entry(C, '2026-09-04T10:00:00Z')], nextCursor: cursor(C) })
    await store.load()
    await store.load(true)
    await store.load()
    expect(store.page.trips.map((row) => row.id)).toEqual([C])
    expect(store.page.nextCursor).toEqual(cursor(C))
  })

  it('does not throw away the next page when a write reaches a finished trip', async () => {
    const store = useTripHistoryStore()
    tripHistory.mockResolvedValueOnce({
      trips: [entry(A, '2026-09-03T10:00:00Z')],
      nextCursor: cursor(A),
    })
    await store.load()
    let resolve: ((value: TripHistory) => void) | undefined
    tripHistory.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const loading = store.load(true)
    store.apply(view(C))
    resolve?.({ trips: [entry(B, '2026-09-02T10:00:00Z')], nextCursor: null })
    await loading
    expect(store.page.trips.map((row) => row.id)).toContain(B)
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
