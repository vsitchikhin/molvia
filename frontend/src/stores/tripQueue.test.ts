import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { ApiError } from '@molvia/client'
import {
  ERROR,
  ISSUE,
  catalogueEntryCodec,
  parseMoney,
  parseQuantity,
  tripViewCodec,
} from '@molvia/model'
import type {
  ActorSettings,
  AddExpenseBody,
  CatalogueEntry,
  ExpensePatch,
  StartTripBody,
  TripView,
} from '@molvia/model'
import { useActorStore } from '@/stores/actor'
import { useTripStore } from '@/stores/trip'
import { useTripQueueStore } from '@/stores/tripQueue'
import type { QueuedWrite } from '@/stores/tripQueue'

const addExpense =
  vi.fn<(tripId: string, body: AddExpenseBody) => Promise<{ trip: TripView; created: boolean }>>()
const updateExpense =
  vi.fn<(tripId: string, expenseId: string, patch: ExpensePatch) => Promise<TripView>>()
const removeExpense = vi.fn<(tripId: string, expenseId: string) => Promise<TripView>>()
const startTrip = vi.fn<(body: StartTripBody) => Promise<{ trip: TripView; created: boolean }>>()
const finishTrip = vi.fn<(tripId: string) => Promise<void>>()
const currentTrip = vi.fn<() => Promise<TripView | null>>()
vi.mock('@/api', () => ({
  api: {
    addExpense: (tripId: string, body: AddExpenseBody) => addExpense(tripId, body),
    updateExpense: (tripId: string, expenseId: string, patch: ExpensePatch) =>
      updateExpense(tripId, expenseId, patch),
    removeExpense: (tripId: string, expenseId: string) => removeExpense(tripId, expenseId),
    startTrip: (body: StartTripBody) => startTrip(body),
    finishTrip: (tripId: string) => finishTrip(tripId),
    currentTrip: () => currentTrip(),
  },
}))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const OTHER = '2c4e6a80-1111-4222-8333-444455556666'
const TRIP = 'bbbbbbbb-0000-4000-8000-000000000001'
const MILK = 'cccccccc-0000-4000-8000-000000000001'
const BREAD = 'cccccccc-0000-4000-8000-000000000002'

const milk: CatalogueEntry = {
  id: 'dddddddd-0000-4000-8000-000000000001',
  kind: 'product',
  name: 'Молоко «Ашхар»',
  note: 'ультрапастеризованное, 2,5%',
  defaultUnit: 'l',
  typicalQuantity: parseQuantity('1', 'l'),
}

function answer(
  total: string,
  id = TRIP,
  finishedAt: string | null = null,
  place = 'Ереван Сити',
): TripView {
  return tripViewCodec.parse({
    id,
    startedAt: '2026-09-19T08:00:00.000Z',
    finishedAt,
    currency: 'AMD',
    rate: null,
    rateProvider: null,
    rateJump: null,
    rateStale: false,
    place: {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      kind: 'store',
      name: place,
      country: 'AM',
      city: 'Гюмри',
    },
    expenses: [],
    total: [{ amount: total, currency: 'AMD' }],
    converted: null,
  })
}

function add(id: string, price = '520'): QueuedWrite {
  return {
    kind: 'add',
    tripId: TRIP,
    entry: milk,
    body: {
      id,
      itemId: milk.id,
      quantity: parseQuantity('0.9', 'l'),
      amount: parseMoney(price, 'AMD'),
      query: 'мол',
    },
  }
}

/** Поход, в котором эта покупка уже строка — с теми числами, какие назвали. */
function answered1(purchase: string, quantity: string, price: string): TripView {
  const trip = answer(price)
  return tripViewCodec.parse({
    ...tripViewCodec.encode(trip),
    expenses: [
      {
        id: purchase,
        createdAt: '2026-09-19T08:05:00.000Z',
        item: catalogueEntryCodec.encode(milk),
        quantity: { value: quantity, unit: 'l' },
        amount: { amount: price, currency: 'AMD' },
        unitPrice: null,
      },
    ],
  })
}

const offline = () => new ApiError(ERROR.INTERNAL, 'Failed to fetch')

const started = (
  tripId = TRIP,
  place = 'Ереван Сити',
  context?: ActorSettings,
): Extract<QueuedWrite, { kind: 'start' }> => ({
  kind: 'start',
  tripId,
  place: { kind: 'store', name: place },
  startedAt: new Date('2026-09-19T08:00:00.000Z'),
  ...(context ? { context } : {}),
})

/** Настройки, с которыми начат поход: те же, что у места в `answer`. */
const here: ActorSettings = {
  country: 'AM',
  city: 'Гюмри',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
}

function fresh(identity = ME) {
  localStorage.setItem('molvia.actor', identity)
  setActivePinia(createPinia())
  return useTripQueueStore()
}

/** Resolves when every promise already queued has run: the queue sends in the background. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('trip queue', () => {
  it('does not merge a captured start into a same-named shop without asking', async () => {
    startTrip.mockRejectedValue(new ApiError(ERROR.TRIP_OPEN, 'open trip'))
    currentTrip.mockResolvedValue(answer('0', OTHER, null, 'Ереван Сити'))
    const queue = fresh()
    queue.enqueue({
      ...started(),
      context: { country: 'AM', city: 'Ереван', spendCurrency: 'USD', incomeCurrency: 'EUR' },
    })
    queue.enqueue(add(MILK))
    await queue.flush()
    expect(queue.elsewhere?.tripId).toBe(OTHER)
    expect(queue.pending).toHaveLength(2)
    expect(addExpense).not.toHaveBeenCalled()
  })

  it('asks again when the context it carries is one the server will not write under', async () => {
    // A geography granted by hand, left behind by a move: the server answers the same
    // question rather than a 400, and the queue must not set the start aside with every
    // purchase behind it (MOL-65, review 2, замечание 9).
    startTrip.mockRejectedValue(new ApiError(ERROR.TRIP_CONTEXT_REQUIRED, 'context unusable'))
    const stale = { ...here, country: 'GE', city: 'Тбилиси' } as const
    const queue = fresh()
    queue.enqueue(started(TRIP, 'Ереван Сити', stale))
    queue.enqueue(add(MILK))
    await queue.flush()

    expect(queue.needsContext).toBe(TRIP)
    expect(queue.pending).toHaveLength(2)
    expect(queue.rejected).toEqual([])

    startTrip.mockResolvedValue({ trip: answer('0'), created: true })
    addExpense.mockResolvedValue({ trip: answer('520'), created: true })
    queue.supplyContext(TRIP, here)
    await queue.flush()

    expect(startTrip).toHaveBeenLastCalledWith(expect.objectContaining({ id: TRIP, context: here }))
    expect(queue.pending).toEqual([])
  })

  it('keeps the question while its start waits, through another window and through a purchase', async () => {
    startTrip.mockRejectedValue(new ApiError(ERROR.TRIP_CONTEXT_REQUIRED, 'context unusable'))
    const stale = { ...here, country: 'GE', city: 'Тбилиси' } as const
    const queue = fresh()
    queue.enqueue(started(TRIP, 'Ереван Сити', stale))
    await queue.flush()
    expect(queue.needsContext).toBe(TRIP)

    // Another window of the same app writes the queue; and the person, with no signal, puts a
    // purchase in. Both go through `sync`, and neither is an answer to the question.
    window.dispatchEvent(new StorageEvent('storage', { key: `molvia.trip-queue.${ME}` }))
    expect(queue.needsContext).toBe(TRIP)
    queue.enqueue(add(MILK))
    await queue.flush()
    expect(queue.needsContext).toBe(TRIP)
    expect(queue.pending).toHaveLength(2)
  })

  it('holds a legacy start and its purchases until the person supplies context', async () => {
    startTrip.mockRejectedValue(new ApiError(ERROR.TRIP_CONTEXT_REQUIRED, 'context required'))
    const queue = fresh()
    queue.enqueue(started())
    queue.enqueue(add(MILK))
    await queue.flush()
    expect(queue.needsContext).toBe(TRIP)
    expect(queue.pending).toHaveLength(2)
    expect(queue.rejected).toEqual([])
    const context = {
      country: 'AM',
      city: 'Гюмри',
      spendCurrency: 'AMD',
      incomeCurrency: 'RUB',
    } as const
    startTrip.mockResolvedValue({ trip: answer('0'), created: true })
    addExpense.mockResolvedValue({ trip: answer('520'), created: true })
    queue.supplyContext(TRIP, context)
    await queue.flush()
    expect(startTrip).toHaveBeenLastCalledWith(expect.objectContaining({ id: TRIP, context }))
    expect(queue.pending).toEqual([])
  })

  it('keeps captured context through storage and ignores changed account settings', async () => {
    startTrip.mockRejectedValue(offline())
    const context = {
      country: 'AM',
      city: 'Гюмри',
      spendCurrency: 'USD',
      incomeCurrency: 'EUR',
    } as const
    const queue = fresh()
    queue.enqueue({ ...started(), context })
    await queue.flush()
    const restored = fresh()
    await restored.flush()
    expect(startTrip).toHaveBeenLastCalledWith(expect.objectContaining({ context }))
    expect(restored.pending[0]).toMatchObject({ context })
  })

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    addExpense.mockReset()
    updateExpense.mockReset()
    removeExpense.mockReset()
    startTrip.mockReset()
    finishTrip.mockReset()
    currentTrip.mockReset()
    vi.restoreAllMocks()
  })

  it('sends a write and hands the answer to the trip', async () => {
    addExpense.mockResolvedValue({ trip: answer('520.00'), created: true })
    const queue = fresh()
    queue.enqueue(add(MILK))
    await queue.flush()

    expect(addExpense).toHaveBeenCalledWith(
      TRIP,
      expect.objectContaining({ id: MILK, query: 'мол' }),
    )
    expect(queue.pending).toEqual([])
    expect(useTripStore().current?.total).toEqual([{ minor: 52000n, currency: 'AMD' }])
  })

  it('keeps a write it could not send, and it survives a restart with its bigints', async () => {
    addExpense.mockRejectedValue(offline())
    const queue = fresh()
    queue.enqueue(add(MILK, '5403.12'))
    await queue.flush()
    expect(queue.pending).toHaveLength(1)

    const restarted = fresh()
    const [kept] = restarted.pending
    expect(kept?.kind).toBe('add')
    if (kept?.kind !== 'add') return
    expect(kept.body.amount).toEqual({ minor: 540312n, currency: 'AMD' })
    expect(kept.body.quantity).toEqual({ milli: 900n, unit: 'l' })
    expect(kept.body.query).toBe('мол')
    expect(kept.entry).toEqual(milk)
  })

  it('sends in order, one at a time', async () => {
    const calls: string[] = []
    addExpense.mockImplementation((_trip, body) => {
      calls.push(`add ${body.id}`)
      return Promise.resolve({ trip: answer('520.00'), created: true })
    })
    updateExpense.mockImplementation((_trip, id) => {
      calls.push(`update ${id}`)
      return Promise.resolve(answer('570.00'))
    })
    removeExpense.mockImplementation((_trip, id) => {
      calls.push(`remove ${id}`)
      return Promise.resolve(answer('0'))
    })

    addExpense.mockRejectedValueOnce(offline())
    const queue = fresh()
    queue.enqueue(add(MILK))
    queue.enqueue({ kind: 'update', tripId: TRIP, expenseId: MILK, patch: { amount: null } })
    queue.enqueue({ kind: 'remove', tripId: TRIP, expenseId: MILK })
    queue.enqueue(add(BREAD))
    await queue.flush()
    expect(calls).toEqual([])
    expect(queue.pending).toHaveLength(4)

    await queue.flush()
    expect(calls).toEqual([`add ${MILK}`, `update ${MILK}`, `remove ${MILK}`, `add ${BREAD}`])
    expect(queue.pending).toEqual([])
  })

  it('sends a write again after its answer was lost — the same id, not a second purchase', async () => {
    addExpense.mockRejectedValueOnce(offline())
    addExpense.mockResolvedValueOnce({ trip: answer('520.00'), created: false })
    const queue = fresh()
    queue.enqueue(add(MILK))
    await queue.flush()
    await queue.flush()

    expect(addExpense).toHaveBeenCalledTimes(2)
    expect(addExpense.mock.calls.map(([, body]) => body.id)).toEqual([MILK, MILK])
  })

  it('stops at a dropped connection and does not repeat what already went', async () => {
    addExpense.mockResolvedValueOnce({ trip: answer('520.00'), created: true })
    addExpense.mockRejectedValueOnce(offline())
    const queue = fresh()
    queue.enqueue(add(MILK))
    queue.enqueue(add(BREAD))
    await settled()

    expect(addExpense.mock.calls.map(([, body]) => body.id)).toEqual([MILK, BREAD])
    expect(queue.pending.map((entry) => entry.kind === 'add' && entry.body.id)).toEqual([BREAD])
  })

  it.each([
    ['a server that broke', ERROR.INTERNAL],
    ['a captive portal answering off the contract', ISSUE.RESPONSE_INVALID],
    ['an identity the server no longer knows', ERROR.NO_ACTOR],
  ])('holds the queue on %s', async (_case, code) => {
    addExpense.mockRejectedValue(new ApiError(code))
    const queue = fresh()
    queue.enqueue(add(MILK))
    queue.enqueue(add(BREAD))
    await queue.flush()

    expect(addExpense).toHaveBeenCalledTimes(1)
    expect(queue.pending).toHaveLength(2)
    expect(queue.rejected).toEqual([])
  })

  it('sets a refused write aside and goes on with the next', async () => {
    // Sent again it would be refused again, and every write behind it would wait forever (В-10).
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    addExpense.mockRejectedValueOnce(new ApiError(ERROR.INVALID_AMOUNT, 'amount.amount'))
    addExpense.mockResolvedValueOnce({ trip: answer('520.00'), created: true })
    const queue = fresh()
    queue.enqueue(add(MILK))
    queue.enqueue(add(BREAD))
    await settled()
    await queue.flush()

    expect(queue.pending).toEqual([])
    expect(queue.rejected).toHaveLength(1)
    expect(queue.rejected[0]?.code).toBe(ERROR.INVALID_AMOUNT)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(ERROR.INVALID_AMOUNT))

    expect(fresh().rejected[0]?.code).toBe(ERROR.INVALID_AMOUNT)
  })

  it('runs once however many times it is asked at the same moment', async () => {
    let release: (answered: { trip: TripView; created: boolean }) => void = () => undefined
    addExpense.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const queue = fresh()
    queue.enqueue(add(MILK))
    const again = [queue.flush(), queue.flush(), queue.flush()]
    release({ trip: answer('520.00'), created: true })
    await Promise.all(again)

    expect(addExpense).toHaveBeenCalledTimes(1)
  })

  it('keeps one copy of the same add, as a double tap would queue it', async () => {
    addExpense.mockRejectedValue(offline())
    const queue = fresh()
    queue.enqueue(add(MILK))
    queue.enqueue(add(MILK))
    await settled()
    expect(queue.pending).toHaveLength(1)
  })

  it('never sends one identity’s writes as another’s', async () => {
    addExpense.mockRejectedValue(offline())
    const queue = fresh()
    queue.enqueue(add(MILK))
    await queue.flush()

    addExpense.mockReset()
    addExpense.mockResolvedValue({ trip: answer('0'), created: true })
    useActorStore().id = OTHER
    await nextTick()
    await settled()

    expect(queue.pending).toEqual([])
    expect(addExpense).not.toHaveBeenCalled()

    useActorStore().id = ME
    await nextTick()
    await settled()
    expect(addExpense).toHaveBeenCalledWith(TRIP, expect.objectContaining({ id: MILK }))
  })

  it('does not drop the head of the next identity when the identity changes mid-send', async () => {
    let release: (answered: { trip: TripView; created: boolean }) => void = () => undefined
    addExpense.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const queue = fresh()
    queue.enqueue(add(MILK))
    await settled()

    localStorage.setItem(
      `molvia.trip-queue.${OTHER}`,
      JSON.stringify([{ key: 'k1', write: { kind: 'remove', tripId: TRIP, expenseId: BREAD } }]),
    )
    removeExpense.mockRejectedValue(offline())
    useActorStore().id = OTHER
    await nextTick()
    release({ trip: answer('520.00'), created: true })
    await settled()
    await settled()

    expect(queue.pending).toEqual([{ kind: 'remove', tripId: TRIP, expenseId: BREAD }])
    expect(removeExpense).toHaveBeenCalledWith(TRIP, BREAD)
  })

  it('drops a broken entry alone and keeps the purchases around it', () => {
    const good = { kind: 'remove', tripId: TRIP, expenseId: MILK }
    localStorage.setItem(
      `molvia.trip-queue.${ME}`,
      JSON.stringify([
        { key: 'k1', write: good },
        { key: 'k2', write: { kind: 'add', tripId: TRIP, body: { id: 'x' } } },
        'junk',
        // Kept without a key: no version that shipped wrote this, and one without its key would
        // be sent again after every read (review Р-10).
        good,
        { key: 'k3', write: good },
      ]),
    )
    expect(fresh().pending).toEqual([good, good])

    localStorage.setItem(`molvia.trip-queue.${ME}`, 'not json')
    expect(fresh().pending).toEqual([])
  })

  describe('two windows of the app — the installed one and a tab from the bot (A2)', () => {
    const idsOf = (writes: readonly QueuedWrite[]) =>
      writes.map((write) =>
        write.kind === 'add'
          ? write.body.id
          : write.kind === 'update' || write.kind === 'remove'
            ? write.expenseId
            : write.tripId,
      )

    it('keep each other’s purchases: storage is the queue, not a copy', async () => {
      addExpense.mockRejectedValue(offline())
      fresh()
      const pwa = useTripQueueStore(createPinia())
      const tab = useTripQueueStore(createPinia())
      pwa.enqueue(add(MILK))
      tab.enqueue(add(BREAD))
      await settled()

      expect(idsOf(useTripQueueStore(createPinia()).pending)).toEqual([MILK, BREAD])
    })

    it('do not bring back a purchase one of them sent and then removed', async () => {
      addExpense.mockRejectedValueOnce(offline())
      fresh()
      const pwa = useTripQueueStore(createPinia())
      pwa.enqueue(add(MILK))
      await settled()
      const tab = useTripQueueStore(createPinia())
      expect(idsOf(tab.pending)).toEqual([MILK])

      addExpense.mockResolvedValue({ trip: answer('520.00'), created: true })
      removeExpense.mockResolvedValue(answer('0'))
      await pwa.flush()
      pwa.enqueue({ kind: 'remove', tripId: TRIP, expenseId: MILK })
      await settled()
      await tab.flush()

      expect(addExpense).toHaveBeenCalledTimes(2)
      expect(removeExpense).toHaveBeenCalledTimes(1)
      expect(tab.pending).toEqual([])
    })

    it('send a write once each, with a lock that excludes as a browser’s does (Б2)', async () => {
      // happy-dom's `navigator.locks` excludes nothing: a minimal exclusive one, as browsers have.
      let tail = Promise.resolve()
      const locks = {
        request: (_name: string, work: () => Promise<void>) => {
          const run = tail.then(work)
          tail = run.catch(() => undefined)
          return run
        },
      }
      const real = Object.getOwnPropertyDescriptor(navigator, 'locks')
      Object.defineProperty(navigator, 'locks', { value: locks, configurable: true })
      try {
        addExpense.mockRejectedValueOnce(offline())
        fresh()
        const pwa = useTripQueueStore(createPinia())
        pwa.enqueue(add(MILK))
        await settled()
        const tab = useTripQueueStore(createPinia())

        let release: (answered: { trip: TripView; created: boolean }) => void = () => undefined
        addExpense.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = resolve
            }),
        )
        addExpense.mockResolvedValue({ trip: answer('520.00'), created: false })
        const slow = tab.flush()
        await vi.waitFor(() => {
          expect(addExpense).toHaveBeenCalledTimes(2)
        })
        const quick = pwa.flush()
        release({ trip: answer('520.00'), created: true })
        await Promise.all([slow, quick])

        // Offline once, then the tab's send; the PWA waited for it and found nothing left.
        expect(addExpense).toHaveBeenCalledTimes(2)
      } finally {
        if (real) Object.defineProperty(navigator, 'locks', real)
        else Reflect.deleteProperty(navigator, 'locks')
      }
    })
  })

  describe('a card for the screen the app cannot read (Б1)', () => {
    function kept(entry: unknown) {
      const body = { id: MILK, itemId: milk.id, amount: { amount: '520', currency: 'AMD' } }
      localStorage.setItem(
        `molvia.trip-queue.${ME}`,
        JSON.stringify([{ key: 'k1', write: { kind: 'add', tripId: TRIP, body, entry } }]),
      )
    }

    it('reads a card that grew a field — barcodes in 0.2', () => {
      kept({ ...catalogueEntryCodec.encode(milk), barcodes: ['4850001234567'] })
      const [write] = fresh().pending
      expect(write?.kind === 'add' && write.entry).toEqual(milk)
    })

    it('keeps and sends the purchase when the card cannot be read at all', async () => {
      kept({ name: 42 })
      addExpense.mockResolvedValue({ trip: answer('520.00'), created: true })
      const queue = fresh()
      expect(queue.pending).toHaveLength(1)
      expect(queue.pending[0]?.kind === 'add' && queue.pending[0].entry).toBeNull()

      await queue.flush()
      expect(addExpense).toHaveBeenCalledWith(TRIP, expect.objectContaining({ id: MILK }))
    })
  })

  it('does not send again after a restart what it sent while a shelf refused (Р-13)', async () => {
    // localStorage fills up; the purchase goes and is removed; the PWA is killed in the
    // background — its sessionStorage goes with it — and opened again.
    addExpense.mockRejectedValue(offline())
    const queue = fresh()
    queue.enqueue(add(MILK))
    await settled()
    const working = localStorage.setItem.bind(localStorage)
    Object.defineProperty(localStorage, 'setItem', {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error('QuotaExceededError')
      },
    })
    try {
      addExpense.mockReset()
      addExpense.mockResolvedValue({ trip: answer('520.00'), created: true })
      removeExpense.mockResolvedValue(answer('0'))
      await queue.flush()
      queue.enqueue({ kind: 'remove', tripId: TRIP, expenseId: MILK })
      await settled()
      expect(queue.pending).toEqual([])

      sessionStorage.clear()
      addExpense.mockClear()
      removeExpense.mockClear()
      // A restart: the identity is already stored, and this localStorage takes no writes.
      setActivePinia(createPinia())
      const restarted = useTripQueueStore()
      await restarted.flush()

      expect(restarted.pending).toEqual([])
      expect(addExpense).not.toHaveBeenCalled()
      expect(removeExpense).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(localStorage, 'setItem', {
        configurable: true,
        writable: true,
        value: working,
      })
    }
  })

  describe('a localStorage that fills up while purchases wait (Г1)', () => {
    function full(): () => void {
      const working = localStorage.setItem.bind(localStorage)
      Object.defineProperty(localStorage, 'setItem', {
        configurable: true,
        writable: true,
        value: () => {
          throw new Error('QuotaExceededError')
        },
      })
      return () => {
        Object.defineProperty(localStorage, 'setItem', {
          configurable: true,
          writable: true,
          value: working,
        })
      }
    }

    function restarted() {
      // The PWA killed in the background: its sessionStorage goes with it.
      sessionStorage.clear()
      setActivePinia(createPinia())
      return useTripQueueStore()
    }

    it('keeps the purchase waiting from before across a restart', async () => {
      addExpense.mockRejectedValue(offline())
      const queue = fresh()
      queue.enqueue(add(MILK))
      await settled()
      const release = full()
      try {
        queue.enqueue(add(BREAD))
        await settled()
        const [kept] = restarted().pending
        // The bread came when nothing could be written; the milk was written before and stays.
        expect(kept?.kind === 'add' && kept.body.id).toBe(MILK)
      } finally {
        release()
      }
    })

    it('keeps the refusals from before across a restart (Г1b)', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      addExpense.mockRejectedValueOnce(new ApiError(ERROR.INVALID_AMOUNT))
      addExpense.mockRejectedValue(offline())
      const queue = fresh()
      queue.enqueue(add(MILK))
      await settled()
      expect(queue.rejected).toHaveLength(1)
      const release = full()
      try {
        queue.enqueue(add(BREAD))
        await settled()
        expect(restarted().rejected).toHaveLength(1)
      } finally {
        release()
      }
    })
  })

  it('reads an amendment kept by a newer build that grew a field of its patch (Р-14)', () => {
    localStorage.setItem(
      `molvia.trip-queue.${ME}`,
      JSON.stringify([
        {
          key: 'k1',
          write: {
            kind: 'update',
            tripId: TRIP,
            expenseId: MILK,
            patch: { amount: { amount: '570', currency: 'AMD' }, note: 'акция' },
          },
        },
      ]),
    )
    expect(fresh().pending).toEqual([
      {
        kind: 'update',
        tripId: TRIP,
        expenseId: MILK,
        patch: { amount: parseMoney('570', 'AMD') },
      },
    ])
  })

  it('reads a purchase kept by a newer build that grew a field of its body', () => {
    // A build rolled back after it queued a purchase: the body is the purchase, and a field this
    // build has never heard of must not drop it.
    localStorage.setItem(
      `molvia.trip-queue.${ME}`,
      JSON.stringify([
        {
          key: 'k1',
          write: {
            kind: 'add',
            tripId: TRIP,
            body: { id: MILK, itemId: milk.id, amount: { amount: '520', currency: 'AMD' }, tip: 1 },
            entry: catalogueEntryCodec.encode(milk),
          },
        },
      ]),
    )
    const [write] = fresh().pending
    expect(write?.kind === 'add' && write.body).toEqual({
      id: MILK,
      itemId: milk.id,
      amount: parseMoney('520', 'AMD'),
    })
  })

  it('keeps memory for the truth when one shelf refuses and the other takes the write (Б3)', async () => {
    // localStorage reads back what it held and refuses every write; sessionStorage works.
    addExpense.mockRejectedValue(offline())
    const queue = fresh()
    queue.enqueue(add(MILK))
    await settled()
    const working = localStorage.setItem.bind(localStorage)
    Object.defineProperty(localStorage, 'setItem', {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error('QuotaExceededError')
      },
    })
    try {
      queue.enqueue(add(BREAD))
      await settled()
      expect(queue.pending).toHaveLength(2)

      addExpense.mockReset()
      addExpense.mockResolvedValue({ trip: answer('520.00'), created: true })
      await queue.flush()
      expect(addExpense.mock.calls.map(([, body]) => body.id)).toEqual([MILK, BREAD])
      expect(queue.pending).toEqual([])
    } finally {
      Object.defineProperty(localStorage, 'setItem', {
        configurable: true,
        writable: true,
        value: working,
      })
    }
  })

  it('holds the queue on a 404 the API did not say itself — a portal’s page (A3)', async () => {
    addExpense.mockRejectedValue(new ApiError(ERROR.NOT_FOUND, 'HTTP 404', false))
    const queue = fresh()
    queue.enqueue(add(MILK))
    await queue.flush()

    expect(queue.pending).toHaveLength(1)
    expect(queue.rejected).toEqual([])
  })

  it('sets aside a 404 the API said itself', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    addExpense.mockRejectedValue(new ApiError(ERROR.NOT_FOUND))
    const queue = fresh()
    queue.enqueue(add(MILK))
    await queue.flush()

    expect(queue.pending).toEqual([])
    expect(queue.rejected[0]?.code).toBe(ERROR.NOT_FOUND)
  })

  describe('after a server that broke with the connection up (Р-5)', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('tries again a little later, and later still, without waiting for «online»', async () => {
      vi.useFakeTimers()
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
      addExpense.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'HTTP 502', false))
      addExpense.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'HTTP 502', false))
      addExpense.mockResolvedValue({ trip: answer('520.00'), created: true })
      const queue = fresh()
      queue.enqueue(add(MILK))
      await vi.advanceTimersByTimeAsync(0)
      expect(addExpense).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(15_000)
      expect(addExpense).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(15_000)
      expect(addExpense).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(15_000)
      expect(addExpense).toHaveBeenCalledTimes(3)
      expect(queue.pending).toEqual([])
    })

    it('does not poll with no connection — «online» will say when', async () => {
      vi.useFakeTimers()
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      addExpense.mockRejectedValue(offline())
      const queue = fresh()
      queue.enqueue(add(MILK))
      await vi.advanceTimersByTimeAsync(600_000)
      expect(addExpense).toHaveBeenCalledTimes(1)
    })
  })
  describe('начать и завершить поход — тоже записи очереди (MOL-22, В-2)', () => {
    it('поход уходит первым, покупки за ним, «завершить» последним', async () => {
      startTrip.mockResolvedValue({ trip: answer('0.00'), created: true })
      addExpense.mockResolvedValue({ trip: answer('520.00'), created: true })
      finishTrip.mockResolvedValue()
      const queue = fresh()
      queue.enqueue(started())
      queue.enqueue(add(MILK))
      queue.enqueue({ kind: 'finish', tripId: TRIP })
      await queue.flush()

      expect(startTrip).toHaveBeenCalledWith({
        id: TRIP,
        place: { kind: 'store', name: 'Ереван Сити' },
      })
      expect(addExpense).toHaveBeenCalledTimes(1)
      expect(finishTrip).toHaveBeenCalledWith(TRIP)
      expect(queue.pending).toEqual([])
    })

    it('старт без сети ждёт в очереди и переживает перезапуск вместе с местом и моментом', async () => {
      startTrip.mockRejectedValue(offline())
      const queue = fresh()
      queue.enqueue(started())
      await queue.flush()
      expect(queue.pending).toHaveLength(1)

      const again = fresh()
      expect(again.pending[0]).toEqual(started())
    })

    it('поправленная покупка занимает место прежней, а не встаёт второй', async () => {
      addExpense.mockRejectedValue(offline())
      const queue = fresh()
      queue.enqueue(add(MILK, '520'))
      queue.enqueue(add(BREAD))
      await queue.flush()

      queue.enqueue(add(MILK, '750'))

      const adds = queue.pending.filter((write) => write.kind === 'add')
      expect(adds).toHaveLength(2)
      // На своём месте в очереди и с новой ценой: порядок покупок — тот, в котором их делали.
      expect(adds[0]?.body.id).toBe(MILK)
      expect(adds[0]?.body.amount?.minor).toBe(75_000n)
      expect(fresh().pending.find((write) => write.kind === 'add')?.body.amount?.minor).toBe(
        75_000n,
      )
    })

    it('двойное нажатие с одним id — одна запись', async () => {
      startTrip.mockRejectedValue(offline())
      const queue = fresh()
      queue.enqueue(started())
      queue.enqueue(started())
      await queue.flush()

      expect(queue.pending).toHaveLength(1)
    })

    it('двойное нажатие с разными id — всё равно один поход (Ч-3)', async () => {
      // Шторка придумывает свой id на каждый тап, так что дедупликация тут не при чём: второй
      // старт получает `409` и переезжает в первый — того же магазина.
      const SECOND = 'bbbbbbbb-0000-4000-8000-000000000015'
      startTrip.mockResolvedValueOnce({ trip: answer('0.00'), created: true })
      startTrip.mockRejectedValue(new ApiError(ERROR.TRIP_OPEN, undefined, true))
      currentTrip.mockResolvedValue(answer('0.00'))
      addExpense.mockResolvedValue({ trip: answer('520.00'), created: true })
      const queue = fresh()
      queue.enqueue(started())
      queue.enqueue(started(SECOND))
      queue.enqueue({ ...add(MILK), tripId: SECOND })
      await queue.flush()

      expect(startTrip).toHaveBeenCalledTimes(2)
      // Покупка второго тапа уехала в поход первого, а не осталась без похода.
      expect(addExpense).toHaveBeenCalledWith(TRIP, expect.objectContaining({ id: MILK }))
      expect(queue.pending).toEqual([])
      expect(queue.rejected).toEqual([])
    })

    it('«завершить» отвечает 204, и поход перестаёт быть текущим без второго запроса', async () => {
      startTrip.mockResolvedValue({ trip: answer('0.00'), created: true })
      finishTrip.mockResolvedValue()
      const queue = fresh()
      const trips = useTripStore()
      queue.enqueue(started())
      await queue.flush()
      expect(trips.current?.id).toBe(TRIP)

      queue.enqueue({ kind: 'finish', tripId: TRIP })
      await queue.flush()

      expect(trips.current).toBeNull()
      expect(currentTrip).not.toHaveBeenCalled()
    })
  })

  describe('старт встретил уже открытый поход (MOL-22, Р-1)', () => {
    const OPEN = 'bbbbbbbb-0000-4000-8000-000000000009'
    const tripOpen = () => new ApiError(ERROR.TRIP_OPEN, undefined, true)

    it('покупки переезжают в открытый поход, а не теряются по одной', async () => {
      startTrip.mockRejectedValue(tripOpen())
      currentTrip.mockResolvedValue(answer('0.00', OPEN))
      addExpense.mockResolvedValue({ trip: answer('520.00', OPEN), created: true })
      const queue = fresh()
      const trips = useTripStore()
      queue.enqueue(started())
      queue.enqueue(add(MILK))
      queue.enqueue(add(BREAD))
      await queue.flush()

      expect(trips.current?.id).toBe(OPEN)
      expect(addExpense).toHaveBeenNthCalledWith(1, OPEN, expect.objectContaining({ id: MILK }))
      expect(addExpense).toHaveBeenNthCalledWith(2, OPEN, expect.objectContaining({ id: BREAD }))
      expect(queue.pending).toEqual([])
      expect(queue.rejected).toEqual([])
    })

    it('чужие записи не трогает: переезжают только записи того же похода', async () => {
      const ELSE = 'bbbbbbbb-0000-4000-8000-000000000007'
      startTrip.mockRejectedValue(tripOpen())
      currentTrip.mockResolvedValue(answer('0.00', OPEN))
      addExpense.mockRejectedValue(offline())
      const queue = fresh()
      queue.enqueue(started())
      queue.enqueue({ ...add(MILK), tripId: ELSE })
      await queue.flush()

      expect(queue.pending).toEqual([{ ...add(MILK), tripId: ELSE }])
    })

    it('открытый поход не прочитался — очередь стоит, покупки целы', async () => {
      startTrip.mockRejectedValue(tripOpen())
      currentTrip.mockRejectedValue(offline())
      const queue = fresh()
      queue.enqueue(started())
      queue.enqueue(add(MILK))
      await queue.flush()

      expect(queue.pending).toHaveLength(2)
      expect(queue.rejected).toEqual([])
      expect(addExpense).not.toHaveBeenCalled()
    })

    it('открытого похода уже нет — старт уходит тут же, а не через паузу', async () => {
      startTrip.mockRejectedValueOnce(tripOpen())
      startTrip.mockResolvedValue({ trip: answer('0.00'), created: true })
      currentTrip.mockResolvedValue(null)
      const queue = fresh()
      queue.enqueue(started())
      await queue.flush()

      // Тот поход завершили, пока этот ждал: ждать пятнадцать секунд не за чем (Т-7).
      expect(startTrip).toHaveBeenCalledTimes(2)
      expect(queue.pending).toEqual([])
      expect(queue.elsewhere).toBeNull()
    })
  })

  describe('правка покупки, которая уже ушла (адверсариальная А1)', () => {
    it('исправленная цена уходит правкой: повтор add сервер принял бы и ничего не изменил', async () => {
      addExpense.mockResolvedValue({ trip: answer('520.00'), created: true })
      updateExpense.mockResolvedValue(answer('750.00'))
      const queue = fresh()
      const trips = useTripStore()
      queue.enqueue(add(MILK, '520'))
      await queue.flush()
      // Сервер ответил походом, в котором эта покупка уже строка.
      trips.apply(
        tripViewCodec.parse({
          ...tripViewCodec.encode(answer('520.00')),
          expenses: [
            {
              id: MILK,
              createdAt: '2026-09-19T08:05:00.000Z',
              item: catalogueEntryCodec.encode(milk),
              quantity: { value: '0.9', unit: 'l' },
              amount: { amount: '520', currency: 'AMD' },
              unitPrice: null,
            },
          ],
        }),
      )

      queue.enqueue(add(MILK, '750'))
      await queue.flush()

      expect(updateExpense).toHaveBeenCalledWith(TRIP, MILK, expect.objectContaining({}))
      expect(addExpense).toHaveBeenCalledTimes(1)
      expect(trips.current?.total[0]?.minor).toBe(75_000n)
    })

    it('ответ, где строка та же, что отправили, ничего за собой не тянет', async () => {
      // И не роняет прогон: количество и цена — bigint, а через JSON он бы бросил (нашлось e2e).
      addExpense.mockResolvedValue({ trip: answered1(MILK, '0.9', '520'), created: true })
      const queue = fresh()
      queue.enqueue(add(MILK, '520'))
      await queue.flush()

      expect(updateExpense).not.toHaveBeenCalled()
      expect(queue.pending).toEqual([])
      expect(queue.rejected).toEqual([])
    })

    it('ответ со старыми числами — правка уходит следом (Г1: ответ потерялся)', async () => {
      // Сервер принял первую версию, ответ не дошёл; повтор с новой ценой он встречает своей
      // строкой и отвечает 200 со старыми числами.
      addExpense.mockResolvedValue({ trip: answered1(MILK, '0.9', '520'), created: false })
      updateExpense.mockResolvedValue(answered1(MILK, '0.9', '750'))
      const queue = fresh()
      queue.enqueue(add(MILK, '750'))
      await queue.flush()

      expect(updateExpense).toHaveBeenCalledWith(TRIP, MILK, {
        quantity: parseQuantity('0.9', 'l'),
        amount: parseMoney('750', 'AMD'),
      })
      expect(queue.pending).toEqual([])
    })

    it('правка, положенная пока запись в пути, не уходит с ответом на прежнюю', async () => {
      let answered: (trip: { trip: TripView; created: boolean }) => void = () => undefined
      addExpense.mockReturnValueOnce(
        new Promise((resolve) => {
          answered = resolve
        }),
      )
      addExpense.mockResolvedValue({ trip: answer('750.00'), created: true })
      const queue = fresh()
      queue.enqueue(add(MILK, '520'))
      await settled()

      // Человек правит цену, пока первая версия висит в сети.
      queue.enqueue(add(MILK, '750'))
      answered({ trip: answer('520.00'), created: true })
      await queue.flush()

      // Правка не выброшена ответом на прежнее тело — она ушла второй.
      expect(addExpense).toHaveBeenCalledTimes(2)
      expect(addExpense.mock.calls[1]?.[1].amount?.minor).toBe(75_000n)
      expect(queue.pending).toEqual([])
    })

    it('отказ на прежнее тело не становится плашкой, когда правка уже в очереди', async () => {
      let refuse: (error: unknown) => void = () => undefined
      addExpense.mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          refuse = reject
        }),
      )
      addExpense.mockResolvedValue({ trip: answer('750.00'), created: true })
      const queue = fresh()
      queue.enqueue(add(MILK, '520'))
      await settled()

      queue.enqueue(add(MILK, '750'))
      refuse(new ApiError(ERROR.INVALID_AMOUNT, undefined, true))
      await queue.flush()

      expect(queue.rejected).toEqual([])
      expect(queue.pending).toEqual([])
    })
  })

  describe('открытый поход в другом магазине (адверсариальная Б1)', () => {
    const OPEN = 'bbbbbbbb-0000-4000-8000-000000000009'
    const tripOpen = () => new ApiError(ERROR.TRIP_OPEN, undefined, true)

    it('покупки не уезжают в чужой магазин: очередь ждёт и называет оба места', async () => {
      startTrip.mockRejectedValue(tripOpen())
      currentTrip.mockResolvedValue(answer('0.00', OPEN, null, 'SAS'))
      const queue = fresh()
      queue.enqueue(started())
      queue.enqueue(add(MILK))
      await queue.flush()

      expect(addExpense).not.toHaveBeenCalled()
      expect(queue.pending).toHaveLength(2)
      expect(queue.elsewhere).toEqual({ tripId: OPEN, place: 'SAS', mine: 'Ереван Сити' })
    })

    it('«Дописать в тот поход» — и покупки переезжают по слову человека', async () => {
      startTrip.mockRejectedValue(tripOpen())
      currentTrip.mockResolvedValue(answer('0.00', OPEN, null, 'SAS'))
      addExpense.mockResolvedValue({ trip: answer('520.00', OPEN, null, 'SAS'), created: true })
      const queue = fresh()
      queue.enqueue(started())
      queue.enqueue(add(MILK))
      await queue.flush()

      queue.joinElsewhere()
      await queue.flush()

      expect(addExpense).toHaveBeenCalledWith(OPEN, expect.objectContaining({ id: MILK }))
      expect(queue.elsewhere).toBeNull()
      expect(queue.pending).toEqual([])
    })

    it('«Завершить тот поход» встаёт в начало очереди — свой поход уйдёт следом', async () => {
      startTrip.mockRejectedValue(tripOpen())
      currentTrip.mockResolvedValue(answer('0.00', OPEN, null, 'SAS'))
      finishTrip.mockResolvedValue()
      const queue = fresh()
      queue.enqueue(started())
      await queue.flush()

      // Тот поход закрыт — значит следующий заход старта уже проходит.
      startTrip.mockResolvedValue({ trip: answer('0.00'), created: true })
      queue.finishElsewhere()
      await settled()

      expect(finishTrip).toHaveBeenCalledWith(OPEN)
      expect(startTrip).toHaveBeenCalled()
      expect(queue.elsewhere).toBeNull()
      expect(queue.pending).toEqual([])
    })

    it('согласие принадлежит тому походу, а не живёт до конца сессии (Т-1)', async () => {
      const THIRD = 'bbbbbbbb-0000-4000-8000-000000000003'
      startTrip.mockRejectedValue(tripOpen())
      currentTrip.mockResolvedValue(answer('0.00', OPEN, null, 'SAS'))
      const queue = fresh()
      queue.enqueue(started())
      await queue.flush()

      // Человек согласился дописать в «SAS», но переезд не состоялся — связь пропала.
      currentTrip.mockRejectedValueOnce(offline())
      queue.joinElsewhere()
      await queue.flush()

      // Следующий поход встречает уже третий магазин: молча переезжать туда нельзя.
      currentTrip.mockResolvedValue(answer('0.00', THIRD, null, 'Рынок'))
      await queue.flush()

      expect(queue.elsewhere).toMatchObject({ tripId: THIRD, place: 'Рынок' })
      expect(addExpense).not.toHaveBeenCalled()
    })

    it('плашка гаснет, когда тот поход закрыли (Т-2)', async () => {
      startTrip.mockRejectedValueOnce(tripOpen())
      startTrip.mockResolvedValue({ trip: answer('0.00'), created: true })
      currentTrip.mockResolvedValueOnce(answer('0.00', OPEN, null, 'SAS'))
      const queue = fresh()
      queue.enqueue(started())
      await queue.flush()
      expect(queue.elsewhere).not.toBeNull()

      // Тот поход завершили с другого устройства — вопроса больше нет.
      currentTrip.mockResolvedValue(null)
      queue.joinElsewhere()
      await queue.flush()

      expect(queue.elsewhere).toBeNull()
      expect(queue.pending).toEqual([])
    })

    it('«Ереван Сити» и «ереван сити » — один магазин, вопроса нет (Т-6)', async () => {
      startTrip.mockRejectedValue(tripOpen())
      currentTrip.mockResolvedValue(answer('0.00', OPEN, null, ' ереван  сити '))
      addExpense.mockResolvedValue({ trip: answer('520.00', OPEN), created: true })
      const queue = fresh()
      queue.enqueue(started())
      queue.enqueue(add(MILK))
      await queue.flush()

      expect(queue.elsewhere).toBeNull()
      expect(addExpense).toHaveBeenCalledWith(OPEN, expect.objectContaining({ id: MILK }))
    })

    it('В1: тот же магазин и тот же город — переезд молча, даже с контекстом', async () => {
      // Контекст есть у каждого нового старта, и пока он один решал вопрос, приложение
      // спрашивало «поход открыт в другом месте» про то же самое место.
      startTrip.mockRejectedValue(tripOpen())
      currentTrip.mockResolvedValue(answer('0.00', OPEN))
      addExpense.mockResolvedValue({ trip: answer('520.00', OPEN), created: true })
      const queue = fresh()
      queue.enqueue(started(TRIP, 'Ереван Сити', here))
      queue.enqueue(add(MILK))
      await queue.flush()

      expect(queue.elsewhere).toBeNull()
      expect(addExpense).toHaveBeenCalledWith(OPEN, expect.objectContaining({ id: MILK }))
    })

    it('В1: то же имя в другом городе — вопрос, ради которого контекст и сверяют', async () => {
      startTrip.mockRejectedValue(tripOpen())
      currentTrip.mockResolvedValue(answer('0.00', OPEN))
      const queue = fresh()
      queue.enqueue(started(TRIP, 'Ереван Сити', { ...here, city: 'Ереван' }))
      queue.enqueue(add(MILK))
      await queue.flush()

      expect(addExpense).not.toHaveBeenCalled()
      expect(queue.elsewhere).toMatchObject({ tripId: OPEN, place: 'Ереван Сити' })
    })

    it('тот же магазин — переезд молча, как и было', async () => {
      startTrip.mockRejectedValue(tripOpen())
      currentTrip.mockResolvedValue(answer('0.00', OPEN))
      addExpense.mockResolvedValue({ trip: answer('520.00', OPEN), created: true })
      const queue = fresh()
      queue.enqueue(started())
      queue.enqueue(add(MILK))
      await queue.flush()

      expect(addExpense).toHaveBeenCalledWith(OPEN, expect.objectContaining({ id: MILK }))
      expect(queue.elsewhere).toBeNull()
    })
  })

  describe('отвергнутый старт (адверсариальная Б2)', () => {
    it('покупки мёртвого похода остаются на телефоне, а не получают каждая свой отказ', async () => {
      startTrip.mockRejectedValue(new ApiError(ERROR.CONFLICT, undefined, true))
      const queue = fresh()
      queue.enqueue(started())
      queue.enqueue(add(MILK))
      await queue.flush()

      expect(addExpense).not.toHaveBeenCalled()
      expect(queue.rejected).toHaveLength(1)
      expect(queue.pending.filter((write) => write.kind === 'add')).toHaveLength(1)
    })
  })

  describe('очередь за сиротой (раунд 4, Ж1)', () => {
    it('«Убрать» у отвергнутого старта уносит и покупки этого похода', async () => {
      startTrip.mockRejectedValue(new ApiError(ERROR.CONFLICT, undefined, true))
      const queue = fresh()
      queue.enqueue(started())
      queue.enqueue(add(MILK))
      await queue.flush()
      expect(queue.heldBack(TRIP)).toBe(1)

      const refusal = queue.rejected[0]
      if (!refusal) throw new Error('нет отказа на старт')
      queue.dismiss(refusal)

      // Ни покупки, ни отказа: висеть в очереди вечно им больше негде.
      expect(queue.pending).toEqual([])
      expect(queue.rejected).toEqual([])
      expect(fresh().pending).toEqual([])
    })

    it('покупки мёртвого похода стоят, а следующий поход уходит', async () => {
      const NEXT = 'bbbbbbbb-0000-4000-8000-000000000031'
      startTrip.mockRejectedValueOnce(new ApiError(ERROR.CONFLICT, undefined, true))
      startTrip.mockResolvedValue({ trip: answer('0.00', NEXT), created: true })
      addExpense.mockResolvedValue({ trip: answer('520.00', NEXT), created: true })
      const queue = fresh()
      queue.enqueue(started())
      queue.enqueue(add(MILK))
      await queue.flush()

      // Следующий поход и его покупка встали за сиротой — и не должны ждать её вечно.
      queue.enqueue({ ...started(NEXT, 'Рынок') })
      queue.enqueue({ ...add(BREAD), tripId: NEXT })
      await queue.flush()

      expect(startTrip).toHaveBeenCalledTimes(2)
      expect(addExpense).toHaveBeenCalledWith(NEXT, expect.objectContaining({ id: BREAD }))
      // Покупка мёртвого похода по-прежнему на телефоне и не получила своего отказа.
      expect(queue.pending.filter((write) => write.kind === 'add')).toHaveLength(1)
      expect(queue.rejected).toHaveLength(1)
    })
  })

  describe('покупка, отменённая в полёте, и догоняющая правка (П-3)', () => {
    it('правка не уходит за покупкой, которую уже отменили', async () => {
      let answered: (trip: { trip: TripView; created: boolean }) => void = () => undefined
      addExpense.mockReturnValueOnce(
        new Promise((resolve) => {
          answered = resolve
        }),
      )
      removeExpense.mockResolvedValue(answer('0.00'))
      const queue = fresh()
      queue.enqueue(add(MILK, '750'))
      await settled()

      queue.dropPurchase(TRIP, MILK)
      // Сервер отвечает строкой со старой ценой — обычно за этим уходит догоняющая правка.
      answered({ trip: answered1(MILK, '0.9', '520'), created: false })
      await queue.flush()

      expect(updateExpense).not.toHaveBeenCalled()
      expect(removeExpense).toHaveBeenCalledWith(TRIP, MILK)
      expect(queue.rejected).toEqual([])
    })
  })

  describe('ждущую покупку можно убрать (адверсариальная В2)', () => {
    it('покупка уходит из очереди, а вслед за ней — удаление: его может ждать другое окно', async () => {
      addExpense.mockRejectedValue(offline())
      removeExpense.mockRejectedValue(offline())
      const queue = fresh()
      queue.enqueue(add(MILK))
      await queue.flush()

      expect(queue.dropPurchase(TRIP, MILK)).toBe(true)
      await queue.flush()

      // Самой покупки в очереди нет, есть только её отмена — и она переживёт перезапуск.
      expect(queue.pending.filter((write) => write.kind === 'add')).toEqual([])
      expect(queue.pending.filter((write) => write.kind === 'remove')).toHaveLength(1)
      expect(fresh().pending.filter((write) => write.kind === 'remove')).toHaveLength(1)
    })

    it('удаление строки, которой сервер не знает, — не отказ, а тот же итог', async () => {
      addExpense.mockRejectedValue(offline())
      removeExpense.mockRejectedValue(new ApiError(ERROR.NOT_FOUND, undefined, true))
      const queue = fresh()
      queue.enqueue(add(MILK))
      await queue.flush()
      queue.dropPurchase(TRIP, MILK)
      await queue.flush()

      expect(queue.rejected).toEqual([])
      expect(queue.pending).toEqual([])
    })

    it('покупку, которой в очереди нет, не трогает', () => {
      const queue = fresh()
      expect(queue.dropPurchase(TRIP, MILK)).toBe(false)
    })

    it('отвергнутую покупку тоже снимает — вместе с плашкой (Т-3)', async () => {
      addExpense.mockRejectedValue(new ApiError(ERROR.INVALID_AMOUNT, undefined, true))
      const queue = fresh()
      queue.enqueue(add(MILK))
      await queue.flush()
      expect(queue.rejected).toHaveLength(1)

      expect(queue.dropPurchase(TRIP, MILK)).toBe(true)
      expect(queue.rejected).toEqual([])
      expect(fresh().rejected).toEqual([])
    })

    it('снятая в полёте покупка не воскресает: за ней уходит удаление (Т-5)', async () => {
      let answered: (trip: { trip: TripView; created: boolean }) => void = () => undefined
      addExpense.mockReturnValueOnce(
        new Promise((resolve) => {
          answered = resolve
        }),
      )
      removeExpense.mockResolvedValue(answer('0.00'))
      const queue = fresh()
      queue.enqueue(add(MILK))
      await settled()

      // Человек передумал, пока запись была в сети.
      expect(queue.dropPurchase(TRIP, MILK)).toBe(true)
      answered({ trip: answer('520.00'), created: true })
      await queue.flush()

      expect(removeExpense).toHaveBeenCalledWith(TRIP, MILK)
      expect(queue.pending).toEqual([])
    })
  })

  describe('«не принято» снимается с телефона (MOL-22, В-3)', () => {
    it('«Убрать» снимает запись и переживает перезапуск', async () => {
      addExpense.mockRejectedValue(new ApiError(ERROR.INVALID_AMOUNT, undefined, true))
      const queue = fresh()
      queue.enqueue(add(MILK))
      queue.enqueue(add(BREAD))
      await queue.flush()
      expect(queue.rejected).toHaveLength(2)

      const first = queue.rejected[0]
      if (first) queue.dismiss(first)

      expect(queue.rejected).toHaveLength(1)
      expect(fresh().rejected).toHaveLength(1)
    })

    it('снимает ту запись, а не ту, что первая в перечитанном списке', async () => {
      addExpense.mockRejectedValue(new ApiError(ERROR.INVALID_AMOUNT, undefined, true))
      const queue = fresh()
      queue.enqueue(add(MILK))
      queue.enqueue(add(BREAD))
      await queue.flush()

      // Как это приходит с экрана: копия объекта, взятая до того, как список перечитали.
      const held = queue.rejected[1]
      if (!held) throw new Error('второй отвергнутой записи нет')
      queue.dismiss({ ...held })

      expect(
        queue.rejected.map((item) => (item.write.kind === 'add' ? item.write.body.id : '')),
      ).toEqual([MILK])
    })
  })
})
