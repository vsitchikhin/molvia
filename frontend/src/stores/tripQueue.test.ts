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
import type { AddExpenseBody, CatalogueEntry, ExpensePatch, TripView } from '@molvia/model'
import { useActorStore } from '@/stores/actor'
import { useTripStore } from '@/stores/trip'
import { useTripQueueStore } from '@/stores/tripQueue'
import type { QueuedWrite } from '@/stores/tripQueue'

const addExpense =
  vi.fn<(tripId: string, body: AddExpenseBody) => Promise<{ trip: TripView; created: boolean }>>()
const updateExpense =
  vi.fn<(tripId: string, expenseId: string, patch: ExpensePatch) => Promise<TripView>>()
const removeExpense = vi.fn<(tripId: string, expenseId: string) => Promise<TripView>>()
vi.mock('@/api', () => ({
  api: {
    addExpense: (tripId: string, body: AddExpenseBody) => addExpense(tripId, body),
    updateExpense: (tripId: string, expenseId: string, patch: ExpensePatch) =>
      updateExpense(tripId, expenseId, patch),
    removeExpense: (tripId: string, expenseId: string) => removeExpense(tripId, expenseId),
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

function answer(total: string): TripView {
  return tripViewCodec.parse({
    id: TRIP,
    startedAt: '2026-09-19T08:00:00.000Z',
    finishedAt: null,
    currency: 'AMD',
    rate: null,
    rateJump: null,
    rateStale: false,
    place: { id: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'store', name: 'Ереван Сити' },
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

const offline = () => new ApiError(ERROR.INTERNAL, 'Failed to fetch')

function fresh(identity = ME) {
  localStorage.setItem('molvia.actor', identity)
  setActivePinia(createPinia())
  return useTripQueueStore()
}

/** Resolves when every promise already queued has run: the queue sends in the background. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('trip queue', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    addExpense.mockReset()
    updateExpense.mockReset()
    removeExpense.mockReset()
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
      writes.map((write) => (write.kind === 'add' ? write.body.id : write.expenseId))

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
})
