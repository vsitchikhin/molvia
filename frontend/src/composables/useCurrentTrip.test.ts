import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { tripViewCodec } from '@molvia/model'
import type { TripView } from '@molvia/model'
import { useCurrentTrip } from '@/composables/useCurrentTrip'
import { useActorStore } from '@/stores/actor'
import { useTripStore } from '@/stores/trip'
import { useTripQueueStore } from '@/stores/tripQueue'
import type { QueuedWrite } from '@/stores/tripQueue'

const startTrip = vi.fn<() => Promise<{ trip: TripView; created: boolean }>>()
vi.mock('@/api', () => ({
  api: {
    startTrip: () => startTrip(),
    finishTrip: () => new Promise(() => undefined),
    addExpense: () => new Promise(() => undefined),
    currentTrip: () => new Promise(() => undefined),
  },
}))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const SERVER = 'bbbbbbbb-0000-4000-8000-000000000001'
const OWN = 'bbbbbbbb-0000-4000-8000-000000000002'

function serverTrip(currency = 'AMD'): TripView {
  return tripViewCodec.parse({
    id: SERVER,
    startedAt: '2026-09-19T08:00:00.000Z',
    finishedAt: null,
    currency,
    rate: null,
    rateProvider: null,
    rateJump: null,
    rateStale: false,
    place: {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      kind: 'store',
      name: 'Ереван Сити',
    },
    expenses: [],
    total: [],
    converted: null,
  })
}

const start = (tripId: string, name = 'Рынок'): QueuedWrite => ({
  kind: 'start',
  tripId,
  place: { kind: 'store', name },
  startedAt: new Date('2026-09-19T12:00:00.000Z'),
})

function fresh() {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('molvia.actor', ME)
  setActivePinia(createPinia())
  return { trips: useTripStore(), queue: useTripQueueStore(), current: useCurrentTrip() }
}

describe('useCurrentTrip', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    startTrip.mockReset()
    startTrip.mockReturnValue(new Promise(() => undefined))
  })

  it('без похода и без очереди похода нет', () => {
    const { current } = fresh()
    expect(current.trip.value).toBeNull()
    expect(current.local.value).toBeNull()
    expect(current.tripId.value).toBeNull()
  })

  it('серверный поход — тот, в который пишут', () => {
    const { trips, current } = fresh()
    trips.apply(serverTrip())

    expect(current.trip.value?.id).toBe(SERVER)
    expect(current.tripId.value).toBe(SERVER)
    expect(current.currency.value).toBe('AMD')
  })

  it('поход, начатый без сети, виден с именем места и моментом', () => {
    const { queue, current } = fresh()
    queue.enqueue(start(OWN))

    expect(current.local.value).toEqual({
      id: OWN,
      placeName: 'Рынок',
      startedAt: new Date('2026-09-19T12:00:00.000Z'),
    })
    expect(current.tripId.value).toBe(OWN)
    // Серверного ответа нет — считать нечем, и валюта берётся из настроек человека.
    expect(current.trip.value).toBeNull()
  })

  it('валюта до ответа сервера — своя, а после — походная', async () => {
    const { trips, queue, current } = fresh()
    const actor = useActorStore()
    actor.actor = {
      id: ME,
      country: 'AM',
      city: 'Gyumri',
      spendCurrency: 'AMD',
      incomeCurrency: 'RUB',
      createdAt: new Date('2026-09-19T08:00:00.000Z'),
      updatedAt: new Date('2026-09-19T08:00:00.000Z'),
    }
    // Ответ сервера держим в руке: до него поход живёт в очереди, после — в сторе.
    let answer: (trip: { trip: TripView; created: boolean }) => void = () => undefined
    startTrip.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    queue.enqueue(start(OWN))
    expect(current.currency.value).toBe('AMD')

    trips.apply(serverTrip('USD'))
    expect(current.currency.value).toBe('AMD')

    answer({ trip: serverTrip('USD'), created: true })
    await queue.flush()
    expect(current.currency.value).toBe('USD')
  })

  it('завершённый без сети поход на экран не возвращается', () => {
    const { trips, queue, current } = fresh()
    trips.apply(serverTrip())
    queue.enqueue({ kind: 'finish', tripId: SERVER })

    expect(current.trip.value).toBeNull()
    expect(current.tripId.value).toBeNull()
  })

  it('завершили один и начали следующий — ведётся следующий', () => {
    const { trips, queue, current } = fresh()
    trips.apply(serverTrip())
    queue.enqueue({ kind: 'finish', tripId: SERVER })
    queue.enqueue(start(OWN))

    expect(current.tripId.value).toBe(OWN)
    expect(current.local.value?.placeName).toBe('Рынок')
  })

  it('начали и тут же завершили, не дождавшись сети, — похода нет', () => {
    const { queue, current } = fresh()
    queue.enqueue(start(OWN))
    queue.enqueue({ kind: 'finish', tripId: OWN })

    expect(current.local.value).toBeNull()
    expect(current.tripId.value).toBeNull()
  })

  it('чужое «завершить» в очереди походу не мешает', () => {
    const { trips, queue, current } = fresh()
    trips.apply(serverTrip())
    queue.enqueue({ kind: 'finish', tripId: OWN })

    expect(current.tripId.value).toBe(SERVER)
  })
})
