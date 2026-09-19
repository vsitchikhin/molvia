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
import { read, writeEverywhere } from '@/stores/storage'
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
      /**
       * Not sent: the trip screen needs a name for a row the server has not answered yet. `null`
       * when the card was kept by another version of the app and cannot be read: the purchase is
       * the body, and it goes all the same (adversarial Б1).
       */
      readonly entry: CatalogueEntry | null
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

/**
 * A write as it is kept: with a key of its own, so a window takes out the write it sent and not
 * whatever is first by then — another window may have sent and removed that one already.
 */
interface Kept {
  readonly key: string
  readonly write: QueuedWrite
}

const QUEUE_KEY = 'molvia.trip-queue'
const REJECTED_KEY = 'molvia.trip-rejected'

/**
 * What stops the queue rather than dropping a write: no connection or a server that broke
 * (both arrive as INTERNAL), an answer off the contract — the captive portal of a shop's wifi
 * answers 200 with its own page — and an identity the server no longer knows, which is waited
 * out rather than refused (MOL-56). A code the API did not say itself — a portal's 404 page read
 * as `not_found` — holds it too (adversarial A3). Every other refusal would be answered the same
 * way again, and a write retried forever would hold every write behind it (MOL-24, В-10).
 */
const HOLDS: readonly WireCode[] = [ERROR.INTERNAL, ISSUE.RESPONSE_INVALID, ERROR.NO_ACTOR]

/**
 * How long to wait before trying again after the server broke while the connection is up: a 502
 * during a deploy brings no `online` event, and the last purchase of a trip would otherwise wait
 * for the next time the app is opened (review Р-5). Doubling, and never longer than five minutes.
 */
const RETRY_FIRST_MS = 15_000
const RETRY_LAST_MS = 300_000

type Loose = Record<string, unknown>

function isRecord(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null
}

function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Wire form: the bodies carry bigints, and the codecs that read them back are the contract's. */
function encode(entry: QueuedWrite): Loose {
  switch (entry.kind) {
    case 'add':
      return {
        kind: 'add',
        tripId: entry.tripId,
        body: addExpenseBodySchema.encode(entry.body),
        entry: entry.entry ? catalogueEntryCodec.encode(entry.entry) : null,
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
    const body = addExpenseBodySchema.safeParse(knownFields(raw.body, BODY_FIELDS))
    return body.success ? { kind, tripId, body: body.data, entry: cardOf(raw.entry) } : null
  }
  if (typeof expenseId !== 'string' || !isIdentifier(expenseId)) return null
  if (kind === 'update') {
    const patch = expensePatchSchema.safeParse(knownFields(raw.patch, PATCH_FIELDS))
    return patch.success ? { kind, tripId, expenseId, patch: patch.data } : null
  }
  return kind === 'remove' ? { kind, tripId, expenseId } : null
}

const BODY_FIELDS = ['id', 'itemId', 'quantity', 'amount', 'query'] as const
const PATCH_FIELDS = ['quantity', 'amount'] as const

/**
 * A kept body or patch as far as this version knows it: one kept by a newer build — rolled back
 * after — may carry a field this one has never heard of, and the strict schema would drop the
 * whole write for it. Only the known fields are read, as `cardOf` does for the card (round 3,
 * review Р-14).
 */
function knownFields(raw: unknown, fields: readonly string[]): unknown {
  if (!isRecord(raw)) return raw
  return Object.fromEntries(
    fields.filter((field) => raw[field] !== undefined).map((field) => [field, raw[field]]),
  )
}

const CARD_FIELDS = ['id', 'kind', 'name', 'note', 'defaultUnit', 'typicalQuantity'] as const

/**
 * The card as far as this version can read it: only the fields it knows are looked at, so one
 * that grew a field — barcodes in 0.2 — still reads. The codec is strict on purpose for the
 * server's answers; a card kept on the device is not an answer.
 */
function cardOf(raw: unknown): CatalogueEntry | null {
  if (!isRecord(raw)) return null
  const known = Object.fromEntries(CARD_FIELDS.map((field) => [field, raw[field]]))
  const card = catalogueEntryCodec.safeParse(known)
  return card.success ? card.data : null
}

function parsedList(key: string): unknown[] {
  const raw = read(key)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** The part of a kept queue still waiting: its past, less what has been sent since. */
function stillWaiting(past: string, waiting: ReadonlySet<string>): string | null {
  let entries: unknown
  try {
    entries = JSON.parse(past)
  } catch {
    return null
  }
  if (!Array.isArray(entries)) return null
  const left = entries.filter(
    (item: unknown) => isRecord(item) && typeof item.key === 'string' && waiting.has(item.key),
  )
  if (left.length === entries.length) return past
  return left.length > 0 ? JSON.stringify(left) : null
}

/** A broken entry is dropped alone: the ones around it are somebody's purchases. */
function recallKept(key: string): Kept[] {
  return parsedList(key).flatMap((item: unknown) => {
    if (!isRecord(item) || typeof item.key !== 'string') return []
    const entry = decode(item.write)
    return entry ? [{ key: item.key, write: entry }] : []
  })
}

function recallRejected(key: string): RejectedWrite[] {
  return parsedList(key).flatMap((item: unknown) => {
    if (!isRecord(item) || !isWireCode(item.code)) return []
    const entry = decode(item.write)
    return entry ? [{ write: entry, code: item.code }] : []
  })
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

/** Runs `work` alone across every window of the app where the browser can say so. */
function exclusively(name: string, work: () => Promise<void>): Promise<void> {
  // The DOM types promise `navigator.locks`; older WebViews do not have it (see stores/actor.ts).
  const locks = (navigator as unknown as Record<string, unknown>).locks as LockManager | undefined
  return locks ? locks.request(name, work) : work()
}

/**
 * Every write to a trip goes through here, with a connection or without one — one path, so the
 * sheet never waits on the network and never learns which case it was in (MOL-24, В-2). A write
 * is kept on the device first and sent after, one at a time and in order.
 *
 * **A repeat is safe by construction**: the device names every row (MOL-21), so a write whose
 * answer was lost is sent again and meets its own row — `200`, not a second purchase.
 *
 * **Storage is the queue, not a copy of it** (adversarial A2). The installed app and a tab opened
 * from the bot's link share it: each window reads it before every change and every send, and
 * takes out only the write it sent. A window that kept its own copy wrote over the other's
 * purchase, or sent again an add the other had already sent and removed — and a removed row came
 * back. One window sends at a time (`navigator.locks`).
 *
 * **Sent when the connection may be back**: at start, on `online`, when the app comes back into
 * view (`App.vue`) and, after a server that broke with the connection up, again a little later.
 * There is no background sync on iOS; a queue left in a frozen PWA goes out the next time it is
 * opened.
 *
 * The total is never added up here: until a write is answered, the trip on screen is the
 * server's last one, and `pending` is what the trip screen has to say about the rest (В-11).
 */
export const useTripQueueStore = defineStore('tripQueue', () => {
  const actor = useActorStore()
  const trips = useTripStore()

  let kept: Kept[] = []
  const pending = ref<QueuedWrite[]>([])
  const rejected = ref<RejectedWrite[]>([])
  // A shelf refused the last write: until every shelf takes one, memory is ahead of storage and
  // is the truth — one refusing shelf still answers `read` with what it held before (Б3).
  let ahead = false

  function show(): void {
    pending.value = kept.map((item) => item.write)
  }

  /** What storage holds now — another window may have changed it. */
  function sync(id: string | null): void {
    if (!id || ahead) return
    kept = recallKept(`${QUEUE_KEY}.${id}`)
    rejected.value = recallRejected(`${REJECTED_KEY}.${id}`)
    show()
  }

  function persist(id: string | null): void {
    show()
    if (!id) return
    const queued = writeEverywhere(
      `${QUEUE_KEY}.${id}`,
      JSON.stringify(kept.map((item) => ({ key: item.key, write: encode(item.write) }))),
      // A shelf that refused keeps the writes of its past still waiting: those already sent
      // would go again at the next launch — an add after its remove brings the row back (Р-13) —
      // and those still waiting are purchases made at the shelf with no signal (Г1).
      (past) => stillWaiting(past, new Set(kept.map((item) => item.key))),
    )
    // Refusals only grow, so a refusing shelf's past is a true, shorter list: it stays.
    const refused = writeEverywhere(
      `${REJECTED_KEY}.${id}`,
      JSON.stringify(
        rejected.value.map((item) => ({ write: encode(item.write), code: item.code })),
      ),
      (past) => past,
    )
    ahead = !queued || !refused
  }

  function load(id: string | null): void {
    ahead = false
    kept = []
    rejected.value = []
    sync(id)
    show()
  }

  load(actor.id)
  watch(
    () => actor.id,
    (id) => {
      load(id)
      void flush()
    },
  )

  // Another window changed the queue: what this one shows follows.
  window.addEventListener('storage', (event) => {
    const id = actor.id
    if (id && (event.key === `${QUEUE_KEY}.${id}` || event.key === `${REJECTED_KEY}.${id}`)) {
      sync(id)
    }
  })

  let retry: ReturnType<typeof setTimeout> | undefined
  let retryDelay = RETRY_FIRST_MS

  function retryLater(): void {
    if (!navigator.onLine) return
    clearTimeout(retry)
    retry = setTimeout(() => void flush(), retryDelay)
    retryDelay = Math.min(retryDelay * 2, RETRY_LAST_MS)
  }

  let running: Promise<void> | null = null

  /**
   * One run at a time: two would send the head twice and apply the answers out of order. A run
   * cut short by a change of identity is followed by one for the new identity, which would
   * otherwise have been handed the old run's promise and waited for the next `online`.
   */
  function flush(): Promise<void> {
    if (!running) {
      const owner = actor.id
      clearTimeout(retry)
      const run = owner
        ? exclusively(`${QUEUE_KEY}.${owner}`, () => drain(owner))
        : Promise.resolve()
      running = run.finally(() => {
        running = null
        if (actor.id !== owner) void flush()
      })
    }
    return running
  }

  async function drain(owner: string): Promise<void> {
    for (;;) {
      if (actor.id !== owner) return
      sync(owner)
      const head = kept[0]
      if (!head) break

      let refusal: WireCode | null = null
      let answered: TripView | null = null
      try {
        answered = await send(head.write)
      } catch (error) {
        const known = error instanceof ApiError
        const code = known ? error.code : ERROR.INTERNAL
        if (!known || !error.answered || HOLDS.includes(code)) {
          if (code !== ERROR.NO_ACTOR) retryLater()
          return
        }
        refusal = code
      }

      // The identity changed while the write was out: the queue in memory is now another
      // person's, and the write that was answered is not in it.
      if (actor.id !== owner) return

      if (answered) trips.apply(answered)
      sync(owner)
      if (refusal) {
        console.warn(`[trip queue] ${head.write.kind} refused: ${refusal}`)
        rejected.value = [...rejected.value, { write: head.write, code: refusal }]
      }
      kept = kept.filter((item) => item.key !== head.key)
      persist(owner)
    }
    retryDelay = RETRY_FIRST_MS
  }

  /** Kept on the device before anything is sent; a second copy of the same add is ignored. */
  function enqueue(entry: QueuedWrite): void {
    const id = actor.id
    sync(id)
    const repeated =
      entry.kind === 'add' &&
      kept.some((item) => item.write.kind === 'add' && item.write.body.id === entry.body.id)
    if (!repeated) {
      kept = [...kept, { key: newKey(), write: entry }]
      persist(id)
    }
    void flush()
  }

  return { pending, rejected, enqueue, flush }
})
