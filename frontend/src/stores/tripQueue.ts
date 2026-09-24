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
  startTripBodySchema,
} from '@molvia/model'
import type {
  ActorSettings,
  AddExpenseBody,
  CatalogueEntry,
  ExpensePatch,
  StartTripBody,
  TripView,
  WireCode,
} from '@molvia/model'
import { api } from '@/api'
import { useActorStore } from '@/stores/actor'
import { isIdentifier } from '@/stores/identity'
import { read, writeEverywhere } from '@/stores/storage'
import { useTripHistoryStore } from '@/stores/tripHistory'
import { useTripStore } from '@/stores/trip'

/**
 * One write to a trip, kept until the server has it — starting and finishing it included
 * (MOL-22, В-2): a trip started with no signal is named by the device precisely so the rows
 * queued inside it can refer to it, and the queue is in order, so «завершить» goes last by
 * being queued last.
 */
export type QueuedWrite =
  | {
      readonly kind: 'start'
      readonly context?: ActorSettings
      readonly tripId: string
      readonly place: StartTripBody['place']
      /**
       * Not sent — the server times the trip by its own clock. The screen needs a moment for
       * «Ереван Сити · сегодня» while the trip is still only on the phone.
       */
      readonly startedAt: Date
    }
  | { readonly kind: 'finish'; readonly tripId: string; readonly finishedOnDeviceAt?: Date }
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
  /** Its own name on the phone: two refusals about one row are two notices, not one (В2-8). */
  readonly key: string
  readonly write: QueuedWrite
  readonly code: WireCode
}

/** A trip is open somewhere else, so the purchases of this one are waiting (adversarial Б1). */
export interface TripElsewhere {
  /** The trip the server holds open: the person may take it over or close it. */
  readonly tripId: string
  /** Where the open trip is, and where the person thinks they are. */
  readonly place: string
  readonly mine: string
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
 * A removal of a row the server does not have is the outcome it was asked for, not a refusal
 * (раунд 3, Е2): a purchase undone while its `add` was in the air may never have been written at
 * all, and «не принято» about a thing the person threw away themselves is noise.
 */
const DONE_ENOUGH: Partial<Record<QueuedWrite['kind'], readonly WireCode[]>> = {
  remove: [ERROR.NOT_FOUND],
}

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
    case 'start':
      return {
        kind: 'start',
        tripId: entry.tripId,
        place: { ...entry.place },
        ...(entry.context ? { context: entry.context } : {}),
        startedAt: entry.startedAt.toISOString(),
      }
    case 'finish':
      return {
        ...entry,
        ...(entry.finishedOnDeviceAt
          ? { finishedOnDeviceAt: entry.finishedOnDeviceAt.toISOString() }
          : {}),
      }
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

  if (kind === 'start') {
    // Through the body's own schema, so a name the server would refuse never waits in the queue
    // for a connection that will only bring a `400`.
    const body = startTripBodySchema.safeParse({
      id: tripId,
      place: raw.place,
      context: raw.context,
    })
    const startedAt = typeof raw.startedAt === 'string' ? new Date(raw.startedAt) : null
    if (!body.success || startedAt === null || Number.isNaN(startedAt.getTime())) return null
    return {
      kind,
      tripId,
      place: body.data.place,
      startedAt,
      ...(body.data.context ? { context: body.data.context } : {}),
    }
  }
  if (kind === 'finish') {
    if (raw.finishedOnDeviceAt === undefined) return { kind, tripId }
    const at = typeof raw.finishedOnDeviceAt === 'string' ? new Date(raw.finishedOnDeviceAt) : null
    return at && Number.isFinite(at.getTime()) ? { kind, tripId, finishedOnDeviceAt: at } : null
  }
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

/**
 * Refusals as the phone keeps them, and whether any of them had to be named on the way in: a
 * record kept by the build before keys existed would otherwise be given a new name on every read,
 * and «Убрать» — which holds the name the screen was drawn with — could never match it (раунд 2,
 * Г4). The caller writes them back once, and from then on the name is the record's own.
 */
function recallRejected(key: string): { items: RejectedWrite[]; named: boolean } {
  let named = false
  const items = parsedList(key).flatMap((item: unknown) => {
    if (!isRecord(item) || !isWireCode(item.code)) return []
    const entry = decode(item.write)
    if (!entry) return []
    if (typeof item.key !== 'string') named = true
    return [
      { key: typeof item.key === 'string' ? item.key : newKey(), write: entry, code: item.code },
    ]
  })
  return { items, named }
}

/**
 * The trip as the server answers it, or nothing: «завершить» answers `204`.
 *
 * **A purchase the server already has goes as an amendment**, not as a second `add` (adversarial
 * А1, owner's decision). `POST /expenses` with an identifier the server knows answers `200` with
 * the row it has and changes nothing — that is the promise that makes a resent queue safe. But a
 * purchase can be corrected on the phone after its first `add` has gone, and sent again it would
 * be answered «yes» while the new price quietly went nowhere.
 */
function send(entry: QueuedWrite, written: boolean): Promise<TripView | null> {
  switch (entry.kind) {
    case 'start':
      return api
        .startTrip({
          id: entry.tripId,
          place: entry.place,
          ...(entry.context ? { context: entry.context } : {}),
        })
        .then(({ trip }) => trip)
    case 'finish':
      return api.finishTrip(entry.tripId, entry.finishedOnDeviceAt).then(() => null)
    case 'add':
      return written
        ? api.updateExpense(entry.tripId, entry.body.id, {
            quantity: entry.body.quantity ?? null,
            amount: entry.body.amount ?? null,
          })
        : api.addExpense(entry.tripId, entry.body).then(({ trip }) => trip)
    case 'update':
      return api.updateExpense(entry.tripId, entry.expenseId, entry.patch)
    case 'remove':
      return api.removeExpense(entry.tripId, entry.expenseId)
  }
}

/**
 * Whether the row the server answered with holds the numbers this purchase was sent with.
 *
 * `POST /expenses` with an identifier the server already knows answers `200` with the row it has
 * and changes nothing — the promise that makes a resent queue safe (MOL-21). The phone cannot tell
 * beforehand whether that will happen: its own `add` may have reached the server and lost only the
 * answer, and then the row exists while nothing on the phone knows it (раунд 2, Г1). So the answer
 * is read rather than trusted: numbers that came back other than the ones sent mean the purchase
 * was corrected after it was written, and the correction goes as an amendment.
 */
function answeredAsSent(trip: TripView, body: AddExpenseBody): boolean {
  const row = trip.expenses.find((expense) => expense.id === body.id)
  if (!row) return true
  // Compared field by field, never through `JSON`: a quantity and an amount are bigints, and
  // stringifying one throws — inside the queue's own run, where it would take the run with it.
  return (
    (row.quantity?.milli ?? null) === (body.quantity?.milli ?? null) &&
    (row.quantity?.unit ?? null) === (body.quantity?.unit ?? null) &&
    (row.amount?.minor ?? null) === (body.amount?.minor ?? null) &&
    (row.amount?.currency ?? null) === (body.amount?.currency ?? null)
  )
}

/**
 * What names a write among the writes of its kind: the row it is about. Two adds of one purchase
 * are one; two edits of one row are not — the later one is a later change of mind.
 */
function subject(write: QueuedWrite): string {
  switch (write.kind) {
    case 'add':
      return write.body.id
    case 'update':
    case 'remove':
      return write.expenseId
    case 'start':
    case 'finish':
      return write.tripId
  }
}

function sameWrite(a: QueuedWrite, b: QueuedWrite): boolean {
  return a.kind === b.kind && a.tripId === b.tripId && subject(a) === subject(b)
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
  /** Every conflicting start waits for a choice, including the same shop. */
  const elsewhere = ref<TripElsewhere | null>(null)
  const needsContext = ref<string | null>(null)
  let conflict: { owner: string; key: string; tripId: string } | null = null
  let decision: {
    owner: string
    key: string
    tripId: string
    kind: 'join' | 'finish'
    at: Date
  } | null = null
  // A shelf refused the last write: until every shelf takes one, memory is ahead of storage and
  // is the truth — one refusing shelf still answers `read` with what it held before (Б3).
  let ahead = false
  /** The write a send is carrying right now, so «undo» can tell «gone» from «already a row». */
  let inFlight: QueuedWrite | null = null

  function show(): void {
    pending.value = kept.map((item) => item.write)
    // The question stands while its start does — whether or not that start carries a context:
    // one that is there and unusable waits for the same answer (MOL-65, review 3). The third
    // copy of this condition was left behind and put the banner out on any `sync`, which is
    // every purchase made at the shelf with no signal.
    if (
      needsContext.value &&
      !pending.value.some((write) => write.kind === 'start' && write.tripId === needsContext.value)
    )
      needsContext.value = null
  }

  /** What storage holds now — another window may have changed it. */
  function sync(id: string | null): void {
    if (!id || ahead) return
    kept = recallKept(`${QUEUE_KEY}.${id}`)
    const refusals = recallRejected(`${REJECTED_KEY}.${id}`)
    rejected.value = refusals.items
    show()
    // Names given on the way in are written back at once, or the next read would invent others.
    if (refusals.named) persist(id)
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
    // A refusing shelf keeps its past list: everything in it was refused by the server and is
    // still true. The one thing it loses is a «Убрать» (В-3) — the entry comes back on that shelf
    // alone, and memory, which is ahead of it, is what the screen shows until the tab is closed.
    const refused = writeEverywhere(
      `${REJECTED_KEY}.${id}`,
      JSON.stringify(
        rejected.value.map((item) => ({
          key: item.key,
          write: encode(item.write),
          code: item.code,
        })),
      ),
      (past) => past,
    )
    ahead = !queued || !refused
  }

  function load(id: string | null): void {
    elsewhere.value = null
    conflict = null
    decision = null
    ahead = false
    needsContext.value = null
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

  // Another window changed the queue: what this one shows follows. The trip it wrote with the
  // same hand is re-read too — a purchase that left one window's queue must arrive in the other's
  // list, not vanish between the two (adversarial Б4).
  window.addEventListener('storage', (event) => {
    const id = actor.id
    if (id && (event.key === `${QUEUE_KEY}.${id}` || event.key === `${REJECTED_KEY}.${id}`)) {
      sync(id)
      trips.reread()
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
    /**
     * How many times this run has gone round again without waiting. «Сразу» is right once — the
     * trip that was in the way has just been closed — but two requests answer each other in a
     * circle when `POST /trips` says «open» and `GET /trips/current` says «none»: different
     * requests, and nothing promises they agree (раунд 3, Е1).
     */
    let immediate = 0

    for (;;) {
      if (actor.id !== owner) return
      sync(owner)
      // The writes of a trip the server refused are stepped over, not sent and not waited on:
      // sent, each would earn its own `404` and its own notice about a purchase that is not the
      // problem (раунд 2, Г2); waited on, they would hold everything queued behind them —
      // the next trip and its purchases — until the person noticed a notice about the first
      // (раунд 4, Ж1). They stay on the phone; the queue goes on.
      const head = kept.find((item) => !orphaned(item.write.tripId))
      if (!head) break

      // A choice is checked against a fresh read while holding the queue's cross-window lock.
      if (head.write.kind === 'start' && decision) {
        if (!(await rerouted(owner, { key: head.key, write: head.write }))) return
        continue
      }
      let refusal: WireCode | null = null
      let answered: TripView | null = null
      inFlight = head.write
      try {
        answered = await send(head.write, alreadyWritten(head.write))
      } catch (error) {
        const known = error instanceof ApiError
        const code = known ? error.code : ERROR.INTERNAL
        if (!known || !error.answered || HOLDS.includes(code)) {
          if (code !== ERROR.NO_ACTOR) retryLater()
          return
        }
        const start = head.write
        if (code === ERROR.TRIP_CONTEXT_REQUIRED && start.kind === 'start') {
          // The context this start carries may be there and still unusable — a geography the
          // person no longer holds, which the settings form cannot offer either (MOL-65,
          // review 2). Either way the answer is the same question, and the queue waits for it
          // rather than setting the start aside with every purchase behind it.
          if (
            actor.id === owner &&
            kept.some((item) => item.write.kind === 'start' && item.write.tripId === start.tripId)
          )
            needsContext.value = start.tripId
          return
        }
        if (code === ERROR.TRIP_OPEN && start.kind === 'start') {
          if (!(await rerouted(owner, { key: head.key, write: start }))) return
          if (immediate++ > 0) {
            retryLater()
            return
          }
          continue
        }
        refusal = DONE_ENOUGH[head.write.kind]?.includes(code) ? null : code
      } finally {
        // On every way out, the held ones included: «in the air» must not go on meaning a write
        // that is merely waiting, or undoing it would queue a removal for a row nobody wrote
        // (раунд 3, Е2, рядом).
        inFlight = null
      }

      // The identity changed while the write was out: the queue in memory is now another
      // person's, and the write that was answered is not in it.
      if (actor.id !== owner) return

      if (answered) trips.apply(answered)
      // «Завершить» answers `204`, so there is nothing to apply: the trip the person closed stops
      // being the one they are on here, without waiting for a connection to say so again. Only on
      // success — a refused finish did not close anything (adversarial, second pass).
      if (!refusal && head.write.kind === 'finish') {
        trips.closed(head.write.tripId)
        void useTripHistoryStore().completed(head.write.tripId)
      }
      sync(owner)
      // Corrected while it was out: the correction is in the queue under its own key, and what
      // came back is about a body nobody holds any more. Neither refusal nor answer is news about
      // it, and the old numbers must not be what «Поправить» offers (В2-1).
      const superseded = kept.some(
        (item) => item.key !== head.key && sameWrite(item.write, head.write),
      )
      if (refusal && !superseded) {
        if (head.write.kind === 'finish') useTripHistoryStore().forgetLocal(head.write.tripId)
        console.warn(`[trip queue] ${head.write.kind} refused: ${refusal}`)
        rejected.value = [...rejected.value, { key: newKey(), write: head.write, code: refusal }]
      }
      kept = kept.filter((item) => item.key !== head.key)
      // The server kept numbers other than the ones just sent: its row is what this purchase was
      // written as, and the correction the person has made since has to reach it as an amendment
      // (раунд 2, Г1). Queued after the re-read above, or storage would hand the queue back
      // without it.
      const write = head.write
      // …unless the purchase has been undone meanwhile: the amendment would reach a row that is
      // about to go and come back as «не принято» about a thing the person threw away (П-3).
      const undoing =
        write.kind === 'add' &&
        kept.some((item) => item.write.kind === 'remove' && item.write.expenseId === write.body.id)
      if (answered && !undoing && write.kind === 'add' && !answeredAsSent(answered, write.body)) {
        kept = [
          ...kept,
          {
            key: newKey(),
            write: {
              kind: 'update',
              tripId: write.tripId,
              expenseId: write.body.id,
              patch: { quantity: write.body.quantity ?? null, amount: write.body.amount ?? null },
            },
          },
        ]
      }
      // A start the server has taken answers the question about a trip open elsewhere: there is
      // nothing left to choose (раунд 2, Г3; Ч-1).
      if (write.kind === 'start') {
        elsewhere.value = null
        needsContext.value = null
        conflict = null
        decision = null
      }
      persist(owner)

      // A trip the server would not take leaves its purchases naming a trip that does not exist:
      // sent on, each would earn its own `404` and its own notice about a purchase that is not
      // the problem (adversarial Б2). They stay on the phone until the person decides.
      if (refusal && head.write.kind === 'start') return
    }
    retryDelay = RETRY_FIRST_MS
  }

  /**
   * A conflicting start keeps its purchases until the person chooses. Approval names the owner,
   * the exact queued start and the open trip; a new answer requires a new choice (MOL-25).
   */
  async function rerouted(
    owner: string,
    head: Kept & { write: Extract<QueuedWrite, { kind: 'start' }> },
  ): Promise<boolean> {
    let open: TripView | null
    try {
      open = await api.currentTrip()
    } catch {
      retryLater()
      return false
    }
    if (actor.id !== owner) return false
    sync(owner)
    // Nothing open any more — it was finished while this start waited, and the start itself is
    // good again: sent at once rather than after a wait nothing depends on (Т-7). A question that
    // was on screen about that trip is answered by its disappearance (Т-2).
    if (!kept.some((item) => item.key === head.key)) {
      decision = null
      conflict = null
      elsewhere.value = null
      return true
    }
    if (!open) {
      decision = null
      conflict = null
      elsewhere.value = null
      return true
    }

    const chosen = decision
    if (chosen?.owner !== owner || chosen.key !== head.key || chosen.tripId !== open.id) {
      decision = null
      conflict = { owner, key: head.key, tripId: open.id }
      elsewhere.value = { tripId: open.id, place: open.place.name, mine: head.write.place.name }
      clearTimeout(retry)
      return false
    }
    decision = null
    conflict = null
    elsewhere.value = null
    if (chosen.kind === 'finish') {
      useTripHistoryStore().capture(
        open.id,
        open.place.name,
        open.startedAt,
        chosen.at,
        open.currency,
        open,
      )
      kept = [
        {
          key: newKey(),
          write: { kind: 'finish', tripId: open.id, finishedOnDeviceAt: chosen.at },
        },
        ...kept,
      ]
      persist(owner)
      return true
    }

    trips.apply(open)
    const from = head.write.tripId
    kept = kept.flatMap((item) =>
      item.write.tripId !== from
        ? [item]
        : item.key === head.key
          ? []
          : [{ key: item.key, write: { ...item.write, tripId: open.id } }],
    )
    const history = useTripHistoryStore()
    const completion = history.local.find((row) => row.id === from)
    if (completion) {
      history.capture(
        open.id,
        open.place.name,
        open.startedAt,
        completion.completedAt,
        open.currency,
        open,
      )
      history.forgetLocal(from)
    }
    persist(owner)
    return true
  }

  /**
   * Kept on the device before anything is sent.
   *
   * A purchase, a start or a finish already waiting **takes the new one's place** rather than
   * being queued twice (`sameWrite`): a double tap is one intent, and a purchase corrected before
   * it has gone anywhere is the same purchase — queued again it would become a second row on the
   * server, with the correction lost (MOL-22, review 1). An edit of a row the server already has
   * is another matter: two of those are two changes of mind, and both go.
   */
  function enqueue(entry: QueuedWrite): void {
    const id = actor.id
    sync(id)
    if (entry.kind === 'finish') {
      const earlier = kept.find((item) => sameWrite(item.write, entry))?.write
      if (earlier?.kind === 'finish' && earlier.finishedOnDeviceAt) {
        entry = { ...entry, finishedOnDeviceAt: earlier.finishedOnDeviceAt }
      }
      const at = entry.finishedOnDeviceAt ?? new Date()
      const start = kept.find(
        (item) => item.write.kind === 'start' && item.write.tripId === entry.tripId,
      )?.write
      const trip = trips.current?.id === entry.tripId ? trips.current : null
      if (trip || start?.kind === 'start') {
        useTripHistoryStore().capture(
          entry.tripId,
          trip?.place.name ?? (start?.kind === 'start' ? start.place.name : ''),
          trip?.startedAt ?? (start?.kind === 'start' ? start.startedAt : at),
          at,
          trip?.currency ?? actor.actor?.spendCurrency ?? null,
          trip,
        )
      }
    }
    const replaceable = entry.kind !== 'update' && entry.kind !== 'remove'
    const at = replaceable ? kept.findIndex((item) => sameWrite(item.write, entry)) : -1
    if (at === -1) {
      kept = [...kept, { key: newKey(), write: entry }]
    } else {
      // In its own place in the queue and under a **new** key: the order of what is waiting is
      // the order it was made in, but the key must not be the one a send is already carrying —
      // the answer to that older body takes its key out, and the correction would go with it
      // (adversarial В2-1).
      kept = kept.map((item, index) => (index === at ? { key: newKey(), write: entry } : item))
    }
    persist(id)
    void flush()
  }

  /**
   * Forgets a write the server refused (MOL-22, В-3). Matched by what it is about rather than by
   * reference: the list is re-read from storage whenever another window changes it, so the object
   * the screen holds is not the object in memory by then.
   */
  function dismiss(item: RejectedWrite): void {
    const id = actor.id
    sync(id)
    rejected.value = rejected.value.filter((entry) => entry.key !== item.key)
    // A trip the server refused takes its purchases with it: they name a trip that will never
    // exist, and left behind they would wait for ever with nothing on screen about them (раунд 5,
    // З1). The screen says so before it asks.
    if (item.write.kind === 'start') {
      useTripHistoryStore().forgetLocal(item.write.tripId)
      kept = kept.filter((entry) => entry.write.tripId !== item.write.tripId)
    }
    persist(id)
  }

  /**
   * «Дописать в тот поход»: the purchases waiting behind a start go into the trip the server
   * holds open, wherever it is. Only the person can say this — the queue itself refuses to move a
   * price into another shop (Б1).
   */
  function choose(kind: 'join' | 'finish', expected?: TripElsewhere): void {
    // The same question about the same trip is the same question, even though `rerouted` built
    // a new object for it: `flush()` runs by itself — `useReconnect` sends it on `online` and
    // when the app comes back into view — so a phone in a pocket re-asked between the sheet
    // opening and the tap, and the answer was dropped while the sheet reported it taken (А3).
    const asked = elsewhere.value
    if (
      expected &&
      (expected.tripId !== asked?.tripId ||
        expected.place !== asked.place ||
        expected.mine !== asked.mine)
    ) {
      return
    }
    if (actor.id !== conflict?.owner || elsewhere.value?.tripId !== conflict.tripId) return
    decision = { ...conflict, kind, at: new Date() }
    elsewhere.value = null
    void flush()
  }

  function joinElsewhere(expected?: TripElsewhere): void {
    choose('join', expected)
  }

  function finishElsewhere(expected?: TripElsewhere): void {
    choose('finish', expected)
  }

  /**
   * Takes a purchase out of the queue before it has gone anywhere (adversarial В2): the wrong
   * thing picked up at a shelf with no signal is undone by dropping the write, not by sending it
   * and deleting the row it becomes. Only what is still waiting — once the server has it, the
   * row is deleted through `remove`.
   */
  function dropPurchase(tripId: string, purchaseId: string): boolean {
    const id = actor.id
    sync(id)
    const mine = (write: QueuedWrite): boolean =>
      write.kind === 'add' && write.tripId === tripId && write.body.id === purchaseId
    const at = kept.findIndex((item) => mine(item.write))
    const refused = rejected.value.find((item) => mine(item.write))
    // A write waits in the queue until its answer comes back, so «in the queue» and «in the air»
    // are not exclusive.
    const flying = inFlight !== null && mine(inFlight)

    if (at === -1 && !refused && !flying) {
      // Not on the phone any more: it is a row of the trip, and the caller deletes it as one.
      return false
    }

    if (at !== -1) kept = kept.filter((_, index) => index !== at)
    // Refused and then undone: the notice about it goes with the purchase (Т-3).
    if (refused) rejected.value = rejected.value.filter((item) => item.key !== refused.key)
    if (!refused) {
      // The removal goes into the queue whether or not this window was the one sending: another
      // window may be holding the purchase in the air right now, and it cannot be asked (раунд 3,
      // Е2). A removal of a row nobody wrote costs one request and is answered `404`, which counts
      // as the outcome asked for (`DONE_ENOUGH`); a purchase the person undid and the server keeps
      // for ever costs them the trust in the total.
      kept = [...kept, { key: newKey(), write: { kind: 'remove', tripId, expenseId: purchaseId } }]
    }

    persist(id)
    void flush()
    return true
  }

  /** A trip whose own start the server refused: nothing of it can be written. */
  function orphaned(tripId: string): boolean {
    return rejected.value.some(
      (item) => item.write.kind === 'start' && item.write.tripId === tripId,
    )
  }

  /** How many purchases are waiting on a trip that will never be written (раунд 5, З1). */
  function heldBack(tripId: string): number {
    return kept.filter((item) => item.write.kind === 'add' && item.write.tripId === tripId).length
  }

  /**
   * Whether this purchase is already a row of its trip: a repeat of `add` would then be answered
   * «yes» and change nothing, so the correction goes as an amendment instead (А1).
   */
  function alreadyWritten(write: QueuedWrite): boolean {
    if (write.kind !== 'add') return false
    const trip =
      trips.current?.id === write.tripId ? trips.current : useTripHistoryStore().known(write.tripId)
    if (trip?.id !== write.tripId) return false
    return trip.expenses.some((row) => row.id === write.body.id)
  }

  function supplyContext(tripId: string, context: ActorSettings): void {
    sync(actor.id)
    const entry = kept.find((item) => item.write.kind === 'start' && item.write.tripId === tripId)
    if (entry?.write.kind !== 'start') return
    needsContext.value = null
    enqueue({ ...entry.write, context })
  }

  return {
    needsContext,
    supplyContext,
    pending,
    rejected,
    elsewhere,
    enqueue,
    dismiss,
    dropPurchase,
    heldBack,
    joinElsewhere,
    finishElsewhere,
    flush,
  }
})
