import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { ApiError } from '@molvia/client'
import {
  ERROR,
  ISSUE,
  addExpenseBodySchema,
  catalogueEntryCodec,
  expensePatchSchema,
  isWireCode,
} from '@molvia/model'
import type {
  AddExpenseBody,
  CatalogueEntry,
  ExpensePatch,
  TripView,
  WireCode,
} from '@molvia/model'
import { api } from '@/api'
import { useActorStore } from '@/stores/actor'
import { isIdentifier } from '@/stores/identity'
import { read, write } from '@/stores/storage'
import { useTripStore } from '@/stores/trip'

/**
 * One write to a trip, kept until the server has it. `start` and `finish` join when the trip
 * screen writes through here (MOL-22, MOL-25): a trip started with no signal is named by the
 * device precisely so the rows queued inside it can refer to it.
 */
export type QueuedWrite =
  | {
      readonly kind: 'add'
      readonly tripId: string
      readonly body: AddExpenseBody
      /** Not sent: the trip screen needs a name for a row the server has not answered yet. */
      readonly entry: CatalogueEntry
    }
  | {
      readonly kind: 'update'
      readonly tripId: string
      readonly expenseId: string
      readonly patch: ExpensePatch
    }
  | { readonly kind: 'remove'; readonly tripId: string; readonly expenseId: string }

export interface RejectedWrite {
  readonly write: QueuedWrite
  readonly code: WireCode
}

const QUEUE_KEY = 'molvia.trip-queue'
const REJECTED_KEY = 'molvia.trip-rejected'

/**
 * What stops the queue rather than dropping a write: no connection or a server that broke
 * (both arrive as INTERNAL), an answer off the contract — the captive portal of a shop's wifi
 * answers 200 with its own page — and an identity the server no longer knows, which is waited
 * out rather than refused (MOL-56). Every other refusal would be answered the same way again,
 * and a write retried forever would hold every write behind it (MOL-24, В-10).
 */
const HOLDS: readonly WireCode[] = [ERROR.INTERNAL, ISSUE.RESPONSE_INVALID, ERROR.NO_ACTOR]

type Loose = Record<string, unknown>

function isRecord(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null
}

/** Wire form: the bodies carry bigints, and the codecs that read them back are the contract's. */
function encode(entry: QueuedWrite): Loose {
  switch (entry.kind) {
    case 'add':
      return {
        kind: 'add',
        tripId: entry.tripId,
        body: addExpenseBodySchema.encode(entry.body),
        entry: catalogueEntryCodec.encode(entry.entry),
      }
    case 'update':
      return {
        kind: 'update',
        tripId: entry.tripId,
        expenseId: entry.expenseId,
        patch: expensePatchSchema.encode(entry.patch),
      }
    case 'remove':
      return { ...entry }
  }
}

function decode(raw: unknown): QueuedWrite | null {
  if (!isRecord(raw)) return null
  const { kind, tripId, expenseId } = raw
  if (typeof tripId !== 'string' || !isIdentifier(tripId)) return null

  if (kind === 'add') {
    const body = addExpenseBodySchema.safeParse(raw.body)
    const entry = catalogueEntryCodec.safeParse(raw.entry)
    return body.success && entry.success
      ? { kind, tripId, body: body.data, entry: entry.data }
      : null
  }
  if (typeof expenseId !== 'string' || !isIdentifier(expenseId)) return null
  if (kind === 'update') {
    const patch = expensePatchSchema.safeParse(raw.patch)
    return patch.success ? { kind, tripId, expenseId, patch: patch.data } : null
  }
  return kind === 'remove' ? { kind, tripId, expenseId } : null
}

/** A broken entry is dropped alone: the ones around it are somebody's purchases. */
function recallWrites(key: string): QueuedWrite[] {
  const raw = read(key)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(decode).filter((entry): entry is QueuedWrite => entry !== null)
  } catch {
    return []
  }
}

function recallRejected(key: string): RejectedWrite[] {
  const raw = read(key)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item: unknown) => {
      if (!isRecord(item) || !isWireCode(item.code)) return []
      const entry = decode(item.write)
      return entry ? [{ write: entry, code: item.code }] : []
    })
  } catch {
    return []
  }
}

function send(entry: QueuedWrite): Promise<TripView> {
  switch (entry.kind) {
    case 'add':
      return api.addExpense(entry.tripId, entry.body).then(({ trip }) => trip)
    case 'update':
      return api.updateExpense(entry.tripId, entry.expenseId, entry.patch)
    case 'remove':
      return api.removeExpense(entry.tripId, entry.expenseId)
  }
}

/**
 * Every write to a trip goes through here, with a connection or without one — one path, so the
 * sheet never waits on the network and never learns which case it was in (MOL-24, В-2). A write
 * is kept on the device first and sent after, one at a time and in order.
 *
 * **A repeat is safe by construction**: the device names every row (MOL-21), so a write whose
 * answer was lost is sent again and meets its own row — `200`, not a second purchase.
 *
 * **Sent when the connection may be back**: at start, on `online` and when the app comes back
 * into view (`App.vue`). There is no background sync on iOS; a queue left in a frozen PWA goes
 * out the next time it is opened.
 *
 * The total is never added up here: until a write is answered, the trip on screen is the
 * server's last one, and `pending` is what the trip screen has to say about the rest (В-11).
 */
export const useTripQueueStore = defineStore('tripQueue', () => {
  const actor = useActorStore()
  const trips = useTripStore()

  const pending = ref<QueuedWrite[]>([])
  const rejected = ref<RejectedWrite[]>([])

  function load(id: string | null): void {
    pending.value = id ? recallWrites(`${QUEUE_KEY}.${id}`) : []
    rejected.value = id ? recallRejected(`${REJECTED_KEY}.${id}`) : []
  }

  function persist(id: string | null): void {
    if (!id) return
    write(`${QUEUE_KEY}.${id}`, JSON.stringify(pending.value.map(encode)))
    write(
      `${REJECTED_KEY}.${id}`,
      JSON.stringify(
        rejected.value.map((item) => ({ write: encode(item.write), code: item.code })),
      ),
    )
  }

  load(actor.id)
  watch(
    () => actor.id,
    (id) => {
      load(id)
      void flush()
    },
  )

  let running: Promise<void> | null = null

  /**
   * One run at a time: two would send the head twice and apply the answers out of order. A run
   * cut short by a change of identity is followed by one for the new identity, which would
   * otherwise have been handed the old run's promise and waited for the next `online`.
   */
  function flush(): Promise<void> {
    if (!running) {
      const owner = actor.id
      running = drain(owner).finally(() => {
        running = null
        if (actor.id !== owner) void flush()
      })
    }
    return running
  }

  async function drain(owner: string | null): Promise<void> {
    if (!owner) return

    for (let head = pending.value[0]; head; head = pending.value[0]) {
      let refusal: WireCode | null = null
      let answered: TripView | null = null
      try {
        answered = await send(head)
      } catch (error) {
        const code = error instanceof ApiError ? error.code : ERROR.INTERNAL
        if (HOLDS.includes(code)) return
        refusal = code
      }

      // The identity changed while the write was out: the queue in memory is now another
      // person's, and its head is not the write that was answered.
      if (actor.id !== owner) return

      if (answered) trips.apply(answered)
      if (refusal) {
        console.warn(`[trip queue] ${head.kind} refused: ${refusal}`)
        rejected.value = [...rejected.value, { write: head, code: refusal }]
      }
      pending.value = pending.value.slice(1)
      persist(owner)
    }
  }

  /** Kept on the device before anything is sent; a second copy of the same add is ignored. */
  function enqueue(entry: QueuedWrite): void {
    const repeated =
      entry.kind === 'add' &&
      pending.value.some((queued) => queued.kind === 'add' && queued.body.id === entry.body.id)
    if (!repeated) {
      pending.value = [...pending.value, entry]
      persist(actor.id)
    }
    void flush()
  }

  return { pending, rejected, enqueue, flush }
})
