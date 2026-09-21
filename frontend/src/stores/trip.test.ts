import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR, currentTripResponseSchema, tripViewCodec } from '@molvia/model'
import type { TripView } from '@molvia/model'
import { useActorStore } from '@/stores/actor'
import { TRIP_FIELDS, useTripStore } from '@/stores/trip'

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
    rateProvider: null,
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

  it('lets go of the current trip once it is answered finished', () => {
    // Finished on another device, or by «Завершить» through the queue: purchases must not keep
    // going into it (review Р-1).
    const store = fresh()
    store.apply(trip(OPEN))
    store.apply(trip(OPEN, { finishedAt: '2026-09-19T10:00:00.000Z' }))
    expect(store.current).toBeNull()
    expect(fresh().current).toBeNull()
  })

  it('gives an answer that was out while the identity changed to nobody', async () => {
    let answer: (trip: TripView | null) => void = () => undefined
    currentTrip.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    const store = fresh()
    const loading = store.load()
    const actor = useActorStore()
    actor.id = OTHER
    await nextTick()
    answer(trip(OPEN))
    await loading

    expect(store.current).toBeNull()
    expect(localStorage.getItem(`molvia.trip.${OTHER}`)).toBeNull()
  })

  it('does not put back an older trip over an answer to a write that came back first', async () => {
    let answer: (trip: TripView | null) => void = () => undefined
    currentTrip.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    const store = fresh()
    const loading = store.load()
    store.apply(trip(OPEN, { amount: '520.00' }))
    answer(trip(OPEN))
    await loading

    expect(store.current?.total).toEqual([{ minor: 52000n, currency: 'AMD' }])
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

  // MOL-22, Н-11: «завершить» отвечает 204 — применять нечего, а поход на экране обязан
  // закончиться сразу, без второго запроса у полки.
  it('завершённый поход перестаёт быть текущим, чужой — не трогается', () => {
    const store = fresh()
    store.apply(trip(OPEN))

    store.closed(LATER)
    expect(store.current?.id).toBe(OPEN)

    store.closed(OPEN)
    expect(store.current).toBeNull()
    expect(fresh().current).toBeNull()
  })

  it('завершённый поход не возвращается ответом, который был в пути', async () => {
    const store = fresh()
    store.apply(trip(OPEN))
    let answer: (trip: TripView | null) => void = () => undefined
    currentTrip.mockReturnValue(
      new Promise<TripView | null>((resolve) => {
        answer = resolve
      }),
    )

    const loading = store.load()
    store.closed(OPEN)
    answer(trip(OPEN))
    await loading

    expect(store.current).toBeNull()
  })

  // Адверсариальная Б3: строгий кодек правилен для ответов сервера, но своя память — не ответ.
  it('поход, запомненный прошлой сборкой, не пропадает после обновления', () => {
    const remembered = currentTripResponseSchema.encode({ trip: trip(OPEN) })
    const old = JSON.parse(JSON.stringify(remembered)) as { trip: Record<string, unknown> }
    delete old.trip.rateProvider
    localStorage.setItem(`molvia.trip.${ME}`, JSON.stringify(old))

    const store = fresh()
    expect(store.current?.id).toBe(OPEN)
    expect(store.current?.rateProvider).toBeNull()
  })

  // Адверсариальная Б4: очередь общая между окнами, и поход обязан быть таким же.
  it('второе окно узнаёт о походе, который записало первое', () => {
    const store = fresh()
    expect(store.current).toBeNull()

    localStorage.setItem(
      `molvia.trip.${ME}`,
      JSON.stringify(currentTripResponseSchema.encode({ trip: trip(OPEN) })),
    )
    window.dispatchEvent(new StorageEvent('storage', { key: `molvia.trip.${ME}` }))

    expect(store.current?.id).toBe(OPEN)
  })

  // Ч-6: список знакомых полей — вторая точка правды рядом с контрактом. Разойдутся — поход
  // будет молча пропадать при перезапуске.
  it('список полей памяти совпадает с контрактом похода', () => {
    expect([...TRIP_FIELDS].sort()).toEqual(Object.keys(tripViewCodec.def.shape).sort())
  })

  // Раунд 2, Д1: «Источник:» без источника — хуже, чем отсутствие плашки.
  it('запасной курс без издателя не читается как курс, а поход остаётся', () => {
    const remembered = currentTripResponseSchema.encode({ trip: trip(OPEN) })
    const old = JSON.parse(JSON.stringify(remembered)) as { trip: Record<string, unknown> }
    delete old.trip.rateProvider
    old.trip.rate = {
      base: 'RUB',
      quote: 'AMD',
      rate: '4.820000',
      source: 'fallback',
      asOf: '2026-09-18T12:00:00.000Z',
    }
    localStorage.setItem(`molvia.trip.${ME}`, JSON.stringify(old))

    const store = fresh()
    expect(store.current?.id).toBe(OPEN)
    expect(store.current?.rate).toBeNull()
    expect(store.current?.rateProvider).toBeNull()
  })

  it('официальный курс прошлой сборки читается как курс ЦБ РА', () => {
    const remembered = currentTripResponseSchema.encode({ trip: trip(OPEN) })
    const old = JSON.parse(JSON.stringify(remembered)) as { trip: Record<string, unknown> }
    delete old.trip.rateProvider
    old.trip.rate = {
      base: 'RUB',
      quote: 'AMD',
      rate: '4.820000',
      source: 'official',
      asOf: '2026-09-18T12:00:00.000Z',
    }
    localStorage.setItem(`molvia.trip.${ME}`, JSON.stringify(old))

    expect(fresh().current?.rateProvider).toBe('cba')
  })

  // П-2: у своего курса издателя нет по определению — это не «описать нечем».
  it('свой курс прошлой сборки остаётся курсом', () => {
    const remembered = currentTripResponseSchema.encode({ trip: trip(OPEN) })
    const old = JSON.parse(JSON.stringify(remembered)) as { trip: Record<string, unknown> }
    delete old.trip.rateProvider
    old.trip.rate = {
      base: 'RUB',
      quote: 'AMD',
      rate: '4.600000',
      source: 'personal',
      asOf: '2026-09-18T12:00:00.000Z',
    }
    localStorage.setItem(`molvia.trip.${ME}`, JSON.stringify(old))

    const store = fresh()
    expect(store.current?.rate?.source).toBe('personal')
    expect(store.current?.rateProvider).toBeNull()
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
