import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { ApiError } from '@molvia/client'
import {
  ERROR,
  ISSUE,
  addExpenseBodySchema,
  catalogueEntryCodec,
  expensePatchSchema,
  finishTripBodySchema,
  isCalendarDay,
  isWireCode,
  startTripBodySchema,
  tripPaymentBodySchema,
} from '@molvia/model'
import type {
  ActorSettings,
  AddExpenseBody,
  CatalogueEntry,
  ExpensePatch,
  FinishTripBody,
  StartTripBody,
  TripPaymentBody,
  TripView,
  WireCode,
} from '@molvia/model'
import { api } from '@/api'
import { localDay } from '@/days'
import { useActorStore } from '@/stores/actor'
import { useLoginStore } from '@/stores/login'
import { isIdentifier } from '@/stores/identity'
import { HOLDS, doublingRetry, exclusively, isRecord, newKey } from '@/stores/queueing'
import type { Loose } from '@/stores/queueing'
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
      /**
       * The phone's day of the tap, taken at the tap (MOL-121, adversarial round 4 Ф): worked out
       * when sent, a start tapped at 23:30 in Yerevan and sent after a flight east was the next day.
       * Absent from a write queued by an earlier build — then worked out from `startedAt`.
       */
      readonly tapDay?: string
    }
  | {
      readonly kind: 'finish'
      readonly tripId: string
      readonly finishedOnDeviceAt?: Date
      /** The phone's day of the tap, as `start` keeps it. */
      readonly tapDay?: string
    }
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
  /** «Удалить поход» (MOL-76): marked on the server, «Вернуть» for ten minutes. */
  | { readonly kind: 'delete'; readonly tripId: string }
  /**
   * «Вернуть» once the removal may have reached the server. `name` is not sent: a refusal — ten
   * minutes gone, another trip open — has to say which trip did not come back.
   */
  | {
      readonly kind: 'restore'
      readonly tripId: string
      readonly name: string
      /**
       * The trip's own «Завершить», taken back with it: the trip comes back finished in one step,
       * or, open on the server under the next trip, it could not come back at all (round 3, В1).
       */
      readonly finish?: FinishTripBody
      /** The day of that «Завершить», kept beside the body an earlier build reads strictly. */
      readonly finishDay?: string
    }
  /**
   * The account of a trip and «списано», from its summary in «Деньги» (MOL-123, Р-3): whole each
   * time, so it is safe to send twice, and queued behind the trip's start — a trip begun with no
   * signal is not on the server yet.
   */
  | { readonly kind: 'payment'; readonly tripId: string; readonly body: TripPaymentBody }

/**
 * What «Удалить поход» took off the phone, for «Вернуть» to put back (MOL-76): the writes of the
 * trip still waiting, in their order. Without them the trip is only on the server.
 */
export interface TripUndo {
  readonly tripId: string
  readonly name: string
  readonly writes: readonly QueuedWrite[]
  /**
   * Its refusals: a purchase the server did not take stays one after «Вернуть», with its
   * «Поправить» — dropped with the removal and not brought back, it was lost in silence (Р-4).
   */
  readonly refusals: readonly RejectedWrite[]
}

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
 * «Удалить поход» and «Вернуть» again, under keys of their own (MOL-76, adversarial round 4, Г1):
 * a window still on the version before them reads the shared queue, drops a kind it does not know
 * and writes the queue back without it — the removal never happened, and said so to nobody. The
 * version that knows them puts back what the older one lost, in its place: before the write that
 * followed it. The same rule as MOL-77's: a phone-side cache is read by both versions.
 */
const MARKS_KEY = 'molvia.trip-marks'
const MARKS_REJECTED_KEY = 'molvia.trip-marks-rejected'
/**
 * The account of a trip, under keys of its own for the same reason (MOL-123): the version before
 * it knows the marks and would write their mirror back without a kind it cannot read.
 */
const PAYMENTS_KEY = 'molvia.trip-payments'
const PAYMENTS_REJECTED_KEY = 'molvia.trip-payments-rejected'

/**
 * A removal of a row the server does not have is the outcome it was asked for, not a refusal
 * (раунд 3, Е2): a purchase undone while its `add` was in the air may never have been written at
 * all, and «не принято» about a thing the person threw away themselves is noise.
 */
const DONE_ENOUGH: Partial<Record<QueuedWrite['kind'], readonly WireCode[]>> = {
  remove: [ERROR.NOT_FOUND],
  // The same for a trip (MOL-76): one the server never heard of — its start was still waiting,
  // or in another window's hands — or one already final is gone, which is what was asked.
  delete: [ERROR.NOT_FOUND],
  // The account of a trip removed meanwhile: there is nothing left to put it on.
  payment: [ERROR.NOT_FOUND],
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
        ...(entry.tapDay ? { tapDay: entry.tapDay } : {}),
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
    case 'delete':
      return { ...entry }
    case 'payment':
      return {
        kind: 'payment',
        tripId: entry.tripId,
        body: tripPaymentBodySchema.encode(entry.body),
      }
    case 'restore':
      return {
        kind: 'restore',
        tripId: entry.tripId,
        name: entry.name,
        ...(entry.finish
          ? {
              finish: entry.finish.finishedOnDeviceAt
                ? { finishedOnDeviceAt: entry.finish.finishedOnDeviceAt.toISOString() }
                : {},
            }
          : {}),
        ...(entry.finishDay ? { finishDay: entry.finishDay } : {}),
      }
  }
}

/** A kept day of a tap, read back only when it is one — anything else is worked out anew. */
function dayField<K extends string>(key: K, raw: unknown): Partial<Record<K, string>> {
  return typeof raw === 'string' && isCalendarDay(raw)
    ? ({ [key]: raw } as Partial<Record<K, string>>)
    : {}
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
      ...dayField('tapDay', raw.tapDay),
    }
  }
  if (kind === 'finish') {
    const day = dayField('tapDay', raw.tapDay)
    if (raw.finishedOnDeviceAt === undefined) return { kind, tripId, ...day }
    const at = typeof raw.finishedOnDeviceAt === 'string' ? new Date(raw.finishedOnDeviceAt) : null
    return at && Number.isFinite(at.getTime())
      ? { kind, tripId, finishedOnDeviceAt: at, ...day }
      : null
  }
  if (kind === 'delete') return { kind, tripId }
  if (kind === 'payment') {
    const body = tripPaymentBodySchema.safeParse(raw.body)
    return body.success ? { kind, tripId, body: body.data } : null
  }
  if (kind === 'restore') {
    const name = typeof raw.name === 'string' ? raw.name : ''
    if (raw.finish === undefined) return { kind, tripId, name }
    const finish = finishTripBodySchema.safeParse(raw.finish)
    return finish.success
      ? { kind, tripId, name, finish: finish.data, ...dayField('finishDay', raw.finishDay) }
      : null
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

/** A removal or a «Вернуть»: the kinds a window of the previous version cannot read. */
function isMark(write: QueuedWrite): boolean {
  return write.kind === 'delete' || write.kind === 'restore'
}

function isPayment(write: QueuedWrite): boolean {
  return write.kind === 'payment'
}

/**
 * Every kind some older version cannot read, each group with the keys of its mirror. Put back in
 * this order: a payment may stand before a mark, and the mark has to be back to be found.
 */
const MIRRORS = [
  { key: MARKS_KEY, rejected: MARKS_REJECTED_KEY, holds: isMark },
  { key: PAYMENTS_KEY, rejected: PAYMENTS_REJECTED_KEY, holds: isPayment },
] as const

function isMirrored(write: QueuedWrite): boolean {
  return MIRRORS.some((mirror) => mirror.holds(write))
}

/**
 * The marks as the mirror keeps them, each with the key of the write it stood before (`null` — the
 * end), and put back into a queue that lost them. A mark whose write is gone has been passed by
 * the queue, so it goes first: it should have gone before that write.
 */
function withMarks(queue: Kept[], key: string, holds: (write: QueuedWrite) => boolean): Kept[] {
  const marks = parsedList(key).flatMap((item: unknown) => {
    if (!isRecord(item) || typeof item.key !== 'string') return []
    const write = decode(item.write)
    const before = typeof item.before === 'string' ? item.before : null
    const after = typeof item.after === 'string' ? item.after : null
    return write && holds(write) ? [{ key: item.key, write, before, after }] : []
  })
  const lost = marks.filter((mark) => !queue.some((item) => item.key === mark.key))
  if (lost.length === 0) return queue
  const result = [...queue]
  for (const mark of lost) {
    const kept = { key: mark.key, write: mark.write }
    // After the write it followed, while that is still waiting: a key gone from behind it is no
    // proof it was sent — an older window gives a corrected or undone write a new key, and the
    // mark jumped to the head, ahead of a price change it followed (adversarial Л).
    const previous = mark.after === null ? -1 : result.findIndex((item) => item.key === mark.after)
    if (previous !== -1) {
      result.splice(previous + 1, 0, kept)
      continue
    }
    const at = mark.before === null ? -1 : result.findIndex((item) => item.key === mark.before)
    if (mark.before === null) result.push(kept)
    else if (at === -1) result.unshift(kept)
    else result.splice(at, 0, kept)
  }
  return result
}

/** The mirror of the marks: each with the key of the next write that is not one. */
function marksOf(queue: readonly Kept[], holds: (write: QueuedWrite) => boolean): string {
  return JSON.stringify(
    queue.flatMap((item, index) => {
      if (!holds(item.write)) return []
      // The next write every older version can read: a window older than both mirrors drops the
      // marks and the payments alike, and a key it never had is no place to come back to (review 9).
      const next = queue.slice(index + 1).find((later) => !isMirrored(later.write))
      const previous = queue
        .slice(0, index)
        .reverse()
        .find((earlier) => !isMirrored(earlier.write))
      return [
        {
          key: item.key,
          write: encode(item.write),
          before: next?.key ?? null,
          after: previous?.key ?? null,
        },
      ]
    }),
  )
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
 * The moment of a tap and its day by the phone's calendar, as far as the wire can carry them (Р-33,
 * adversarial round 3 С): a clock past 9999 has a moment no ISO date writes, and one in year 1 east
 * of UTC a day of five digits — sent, either would be refused by the body's own codec before it left
 * the phone, and a refusal sets the write aside for good. The server times such a tap by its own
 * clock, as it does a moment it cannot believe.
 */
function tapOf(at: Date | undefined): { at?: Date; day?: string } {
  if (!at || !/^\d{4}-/.test(at.toISOString())) return {}
  const day = localDay(at)
  return isCalendarDay(day) ? { at, day } : { at }
}

/** The day of a tap, taken as it happens — nothing when the wire could not carry it. */
function dayOfTap(at: Date): { tapDay?: string } {
  const { day } = tapOf(at)
  return day ? { tapDay: day } : {}
}

/** A finish taken back with «Вернуть», with the phone's day of its tap (MOL-121). */
function finishWithDay(
  finish: FinishTripBody | undefined,
  kept: string | undefined,
): FinishTripBody | undefined {
  if (!finish) return finish
  const { at, day } = tapOf(finish.finishedOnDeviceAt)
  const named = kept ?? day
  return { ...(at ? { finishedOnDeviceAt: at } : {}), ...(named ? { finishedOn: named } : {}) }
}

/**
 * A start or a finish sent again without the day of its tap, when the server refused that very
 * field (adversarial round 4 Х): an API rolled back to a build older than MOL-121 reads its bodies
 * strictly, and a refusal sets the write aside for good. The day is the one thing lost.
 */
function refusedDay(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.code === ISSUE.BODY_INVALID &&
    /\b(startedOn|finishedOn|finish)\b/.test(error.message)
  )
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
/** «Начать» as sent: with the day of its tap, unless the server refused that field. */
function startBody(entry: Extract<QueuedWrite, { kind: 'start' }>, withDay: boolean) {
  const day = entry.tapDay ?? tapOf(entry.startedAt).day
  return {
    id: entry.tripId,
    place: entry.place,
    ...(entry.context ? { context: entry.context } : {}),
    ...(withDay && day ? { startedOn: day } : {}),
  }
}

/** «Завершить» as sent: the moment and the day of its tap, as far as the wire carries them. */
function finishOf(entry: Extract<QueuedWrite, { kind: 'finish' }>, withDay: boolean) {
  const { at, day } = tapOf(entry.finishedOnDeviceAt)
  return api.finishTrip(entry.tripId, at, withDay ? (entry.tapDay ?? day) : undefined)
}

function send(entry: QueuedWrite, written: boolean): Promise<TripView | null> {
  switch (entry.kind) {
    case 'start':
      return api
        .startTrip(startBody(entry, true))
        .catch((error: unknown) => {
          if (refusedDay(error)) return api.startTrip(startBody(entry, false))
          throw error
        })
        .then(({ trip }) => trip)
    case 'finish':
      return finishOf(entry, true)
        .catch((error: unknown) => {
          if (refusedDay(error)) return finishOf(entry, false)
          throw error
        })
        .then(() => null)
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
    case 'delete':
      return api.removeTrip(entry.tripId).then(() => null)
    case 'restore':
      return api
        .restoreTrip(entry.tripId, finishWithDay(entry.finish, entry.finishDay))
        .catch((error: unknown) => {
          if (!refusedDay(error) || !entry.finish) throw error
          const { at } = tapOf(entry.finish.finishedOnDeviceAt)
          return api.restoreTrip(entry.tripId, at ? { finishedOnDeviceAt: at } : {})
        })
    case 'payment':
      return api.payTrip(entry.tripId, entry.body)
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
    case 'delete':
    case 'restore':
    case 'payment':
      return write.tripId
  }
}

function sameWrite(a: QueuedWrite, b: QueuedWrite): boolean {
  return a.kind === b.kind && a.tripId === b.tripId && subject(a) === subject(b)
}

/**
 * Runs `work` while no window is sending this owner's queue (MOL-57). «Выйти» erases the queue
 * under it: a window mid-send takes out the write it sent and writes the rest back, and done
 * during the erasure that put a purchase of the owner who left back on the disk.
 */
export function whileQueueIsStill(owner: string, work: () => Promise<void>): Promise<void> {
  return exclusively(`${QUEUE_KEY}.${owner}`, work)
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
  const login = useLoginStore()
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
  /**
   * Trips whose removal is waiting (MOL-76): no screen shows them, whatever the server or the
   * phone's memory still says, until the answer takes them out of that memory too.
   */
  const removing = computed(() => {
    // The last word of the two decides: a «Вернуть» queued behind a removal in flight brings the
    // trip back on screen now, not after both have been answered.
    const gone = new Set<string>()
    for (const write of pending.value) {
      if (write.kind === 'delete') gone.add(write.tripId)
      if (write.kind === 'restore') gone.delete(write.tripId)
    }
    return gone
  })
  /**
   * Raised when a removal, a «Вернуть» or the account of a trip has landed: what the server counts
   * has moved.
   */
  const landed = ref(0)
  /**
   * Raised when any write of a trip has landed (MOL-123, adversarial И): a priced purchase added,
   * a price changed or a purchase removed moves the balance of the account the trip is on, and
   * «Счета», a journal and «не попали» read again by it. `landed` stays what the month reads by.
   */
  const wrote = ref(0)
  /**
   * The trip removed last on this phone, for the strip's «Вернуть» (MOL-76). In the store, not on
   * a screen: a finished trip is removed from its own screen, and the strip stands on the one the
   * person goes back to. Withdrawn by a new start — two open trips is what `restore` refuses (Р-4).
   */
  const lastRemoved = ref<(TripUndo & { readonly stamp: number }) | null>(null)

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
    kept = MIRRORS.reduce(
      (queue, mirror) => withMarks(queue, `${mirror.key}.${id}`, mirror.holds),
      recallKept(`${QUEUE_KEY}.${id}`),
    )
    const refusals = recallRejected(`${REJECTED_KEY}.${id}`)
    // A refused «Вернуть» holds its trip's writes back (`orphaned`); lost by an older window, it
    // would let them go, each to earn a 404 about a trip the notice no longer names.
    const markRefusals = MIRRORS.flatMap((mirror) =>
      recallRejected(`${mirror.rejected}.${id}`).items.filter(
        (item) => mirror.holds(item.write) && !refusals.items.some((held) => held.key === item.key),
      ),
    )
    rejected.value = [...refusals.items, ...markRefusals]
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
    // The mirrors go after the queue: a window reading in between sees a mark in the queue and not
    // yet in the mirror, which is only a mark it already has.
    for (const mirror of MIRRORS) {
      writeEverywhere(`${mirror.key}.${id}`, marksOf(kept, mirror.holds), () => null)
      writeEverywhere(
        `${mirror.rejected}.${id}`,
        JSON.stringify(
          rejected.value
            .filter((item) => mirror.holds(item.write))
            .map((item) => ({ key: item.key, write: encode(item.write), code: item.code })),
        ),
        () => null,
      )
    }
    ahead = !queued || !refused
  }

  function load(id: string | null): void {
    lastRemoved.value = null
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
    if (
      id &&
      [
        QUEUE_KEY,
        REJECTED_KEY,
        MARKS_KEY,
        MARKS_REJECTED_KEY,
        PAYMENTS_KEY,
        PAYMENTS_REJECTED_KEY,
      ].some((key) => event.key === `${key}.${id}`)
    ) {
      sync(id)
      trips.reread()
    }
  })

  const retry = doublingRetry(() => void attempt())
  function retryLater(): void {
    retry.later()
  }

  /**
   * Один заход повтора: сперва спросить о личности, если сервер молчал, и только потом пробовать
   * отправку — без ответа `me()` она всё равно не пойдёт (MOL-56, Б1).
   *
   * **`await` здесь держит цепочку** (адверсариальный Г1): `start()` синхронно ставит
   * `loading`, и `flush()` в том же тике видел уже не `error`, а значит не заводил следующего
   * таймера. Повтор случался ровно один раз, без обещанного удвоения.
   */
  async function attempt(): Promise<void> {
    if (actor.state === 'error') await actor.retry()
    await flush()
  }

  let running: Promise<void> | null = null

  /**
   * One run at a time: two would send the head twice and apply the answers out of order. A run
   * cut short by a change of identity is followed by one for the new identity, which would
   * otherwise have been handed the old run's promise and waited for the next `online`.
   */
  function flush(): Promise<void> {
    // **Ничего не уходит, пока сервер не сказал, кто мы** (MOL-56, адверсариальный Б1): до
    // ответа «кто мы» — это имя ящика на устройстве, а оно ничего не знает про cookie.
    //
    // Молчащий сервер при живой связи по-прежнему пробуется сам, с удваивающейся паузой: без
    // этого покупка, застрявшая за порталом магазина, ждала бы возвращения во вкладку, а
    // `online` за порталом не приходит вовсе — `onLine` там всё время `true` (MOL-24, Р-5).
    if (actor.state !== 'ready' || login.rechecking) {
      if (actor.state === 'error') retryLater()
      return Promise.resolve()
    }
    if (!running) {
      const owner = actor.id
      retry.cancel()
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
        const tripId = head.write.tripId
        // «Вернуть» of a trip the server never had — its start was still waiting when it was
        // removed — is answered 404, and the start queued right behind it writes the trip (MOL-76).
        const unborn =
          head.write.kind === 'restore' &&
          code === ERROR.NOT_FOUND &&
          kept.some((item) => item.write.kind === 'start' && item.write.tripId === tripId)
        refusal = DONE_ENOUGH[head.write.kind]?.includes(code) || unborn ? null : code
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
      // A removed trip leaves the phone's memory too, or the next launch would draw it from there.
      // …unless «Вернуть» already waits behind it: the trip would blink out until that answer.
      if (!refusal && head.write.kind === 'delete') {
        sync(owner)
        const tripId = head.write.tripId
        if (!kept.some((item) => item.write.kind === 'restore' && item.write.tripId === tripId)) {
          forget(tripId)
        }
      }
      if (!refusal && isMirrored(head.write)) {
        landed.value += 1
      }
      if (!refusal) wrote.value += 1
      sync(owner)
      // A write of a trip removed while it was out is news about nothing the person still has.
      const gone = kept.some(
        (item) => item.write.kind === 'delete' && item.write.tripId === head.write.tripId,
      )
      // Corrected while it was out: the correction is in the queue under its own key, and what
      // came back is about a body nobody holds any more. Neither refusal nor answer is news about
      // it, and the old numbers must not be what «Поправить» offers (В2-1).
      const superseded = kept.some(
        (item) => item.key !== head.key && sameWrite(item.write, head.write),
      )
      if (refusal && !superseded && !gone) {
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
      if (
        answered &&
        !undoing &&
        !gone &&
        write.kind === 'add' &&
        !answeredAsSent(answered, write.body)
      ) {
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
      // Another trip is open on the server now, and the removed one never reached it: brought
      // back, its start would meet this one open — the question about the trip going on, and
      // «Завершить тот» closing it at the shelf (adversarial round 2, Б3). The offer goes, as it
      // does when a new trip is started (Р-4); the removal was never answered «back» by anyone.
      const offered = lastRemoved.value
      if (
        !refusal &&
        write.kind === 'start' &&
        offered &&
        offered.tripId !== write.tripId &&
        offered.writes.some((item) => item.kind === 'start') &&
        !kept.some((item) => item.write.kind === 'delete' && item.write.tripId === offered.tripId)
      ) {
        lastRemoved.value = null
      }
      // A trip that did not come back — ten minutes gone, another trip open — is gone from the
      // phone's memory as a removal that landed is (review Р-3). What waits for it stays, stepped
      // over as a refused start's is (`orphaned`) and counted by the notice: some of it was made
      // after «Вернуть», and taking it away without a word lost it in silence (adversarial А2).
      if (refusal && write.kind === 'restore') forget(write.tripId)
      persist(owner)

      // A trip the server would not take leaves its purchases naming a trip that does not exist:
      // sent on, each would earn its own `404` and its own notice about a purchase that is not
      // the problem (adversarial Б2). They stay on the phone until the person decides.
      if (refusal && head.write.kind === 'start') return
    }
    retry.reset()
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
      retry.cancel()
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
    if (entry.kind === 'start') {
      lastRemoved.value = null
      // The day of the tap, now, by the calendar the phone holds now (adversarial round 4 Ф).
      if (!entry.tapDay) entry = { ...entry, ...dayOfTap(entry.startedAt) }
    }
    if (entry.kind === 'finish') {
      const earlier = kept.find((item) => sameWrite(item.write, entry))?.write
      if (earlier?.kind === 'finish' && earlier.finishedOnDeviceAt) {
        entry = { ...entry, finishedOnDeviceAt: earlier.finishedOnDeviceAt }
      }
      if (earlier?.kind === 'finish' && earlier.tapDay) entry = { ...entry, tapDay: earlier.tapDay }
      else if (!entry.tapDay)
        entry = { ...entry, ...dayOfTap(entry.finishedOnDeviceAt ?? new Date()) }
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
    // The account of a trip goes last, never into the place of an earlier one (adversarial К): the
    // server takes «списано» off at any change of the trip's money (Р-32), so one typed after a
    // price was changed must reach it after that change. The earlier one still waiting says less
    // and goes; one already in the air is left to land.
    if (entry.kind === 'payment') {
      const paid = entry
      kept = kept.filter(
        (item) =>
          item.write === inFlight ||
          !(item.write.kind === 'payment' && sameWrite(item.write, paid)),
      )
    }
    const replaceable =
      entry.kind !== 'update' && entry.kind !== 'remove' && entry.kind !== 'payment'
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
    if (item.write.kind === 'start' || item.write.kind === 'restore') {
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

  /**
   * «Удалить поход» (MOL-76). Every write of the trip still on the phone is taken out and handed
   * back for «Вернуть» — sent, they would only write what is about to go — the one this window may
   * be sending included: every write of a trip is safe to send again, and its answer after the
   * removal is news about nothing (`gone`). Its refusals go too, and come back with «Вернуть».
   *
   * **The removal stands where the trip's first write stood, never at the end** (adversarial А3):
   * the order of the queue is the order the trips lived in — this trip's `finish` is what lets the
   * next trip's `start` through, and a removal queued behind that start left the server holding
   * this trip open under it, asking about a trip the person had just removed. A trip with nothing
   * on the phone is removed first of all, for the same reason. It goes to the server **always**,
   * even for a trip whose start never left: another window may be holding that start in the air,
   * and a removal of a trip nobody wrote is answered 404, which counts as done (`DONE_ENOUGH`).
   */
  function removeTrip(tripId: string, name: string): TripUndo {
    const id = actor.id
    sync(id)
    const own = kept.filter((item) => item.write.tripId === tripId && item.write.kind !== 'delete')
    const removal = kept.some(
      (item) => item.write.kind === 'delete' && item.write.tripId === tripId,
    )
    // Removed again before anything came back: what «Вернуть» holds is still the first removal's
    // (Н1) — taken again, it would hold nothing, and the trip with its purchases was lost.
    const held = lastRemoved.value
    if (removal && own.length === 0 && held?.tripId === tripId) return held

    const first = kept.findIndex((item) => own.includes(item))
    const rest = kept.filter((item) => !own.includes(item))
    if (!removal) {
      // Everything before the first of its writes is another trip's, so the index stands as it is.
      const at = Math.max(first, 0)
      rest.splice(at, 0, { key: newKey(), write: { kind: 'delete', tripId } })
    }
    kept = rest
    const refusals = rejected.value.filter((item) => item.write.tripId === tripId)
    rejected.value = rejected.value.filter((item) => item.write.tripId !== tripId)
    // A question about where this trip's purchases go, or about this trip being open in the way of
    // another's start, has nothing left to ask about: the removal goes first and settles it.
    if (own.some((item) => item.key === conflict?.key) || conflict?.tripId === tripId) {
      conflict = null
      decision = null
      elsewhere.value = null
    }
    persist(id)
    void flush()
    const undo = { tripId, name, writes: own.map((item) => item.write), refusals }
    lastRemoved.value = { ...undo, stamp: Date.now() }
    return undo
  }

  /**
   * «Вернуть»: a removal still waiting is taken back, and `restore` goes all the same — the
   * removal may be in another window's hands right now, and a trip never removed answers `restore`
   * with itself. Then what was taken off the phone, in its order, **in the removal's place**
   * (adversarial А4): put at the end, a trip of yesterday stood behind the one going on now, the
   * screen took it for the current one, and the server was asked to open it over today's. Once
   * the removal has left, everything before it has too, and the trip goes back at the head — behind
   * the removal this window is still sending, whose answer comes first.
   */
  function restoreTrip(undo: TripUndo): void {
    // Only while it is offered: the offer is withdrawn when bringing the trip back can no longer
    // put it where it was — its time ran out, or another trip opened on the server over a trip it
    // never had (Р-4, round 2 Б3) — and a store asked past that must not do what the screen won't.
    if (lastRemoved.value?.tripId !== undo.tripId) return
    const id = actor.id
    sync(id)
    lastRemoved.value = null
    // The trip's own finish goes with «Вернуть»: brought back open, a trip the next one started over
    // on the server could not come back at all (round 3, В1). The `finish` stays behind it too —
    // finishing twice moves nothing.
    const finished = undo.writes.find((write) => write.kind === 'finish')
    const back: Kept[] = [
      {
        key: newKey(),
        write: {
          kind: 'restore',
          tripId: undo.tripId,
          name: undo.name,
          ...(finished?.kind === 'finish'
            ? {
                finish: finished.finishedOnDeviceAt
                  ? { finishedOnDeviceAt: finished.finishedOnDeviceAt }
                  : {},
              }
            : {}),
          ...(finished?.kind === 'finish' && finished.tapDay ? { finishDay: finished.tapDay } : {}),
        },
      },
      ...undo.writes.map((write) => ({ key: newKey(), write })),
    ]
    const removal = (item: Kept) =>
      item.write.kind === 'delete' && item.write.tripId === undo.tripId
    const still = kept.findIndex((item) => removal(item) && waiting(item))
    if (still !== -1) {
      kept = [...kept.slice(0, still), ...back, ...kept.slice(still + 1)]
    } else {
      const flying = kept.findIndex(removal)
      kept = [...kept.slice(0, flying + 1), ...back, ...kept.slice(flying + 1)]
    }
    const known = new Set(rejected.value.map((item) => item.key))
    rejected.value = [...rejected.value, ...undo.refusals.filter((item) => !known.has(item.key))]
    persist(id)
    void flush()
  }

  /**
   * A trip gone for good — removed, or not brought back: out of the current trip and the history's
   * memory, and the history read again, or the only trip of it removed left the home screen on a
   * skeleton for a list nobody asked for (adversarial А5, round 2 Б2). One path for both ways out.
   */
  function forget(tripId: string): void {
    trips.closed(tripId)
    const history = useTripHistoryStore()
    history.drop(tripId)
    void history.load().catch(() => undefined)
  }

  /** Not the write this window is sending: that one has left, and its answer decides. */
  function waiting(item: Kept): boolean {
    return inFlight === null || !sameWrite(inFlight, item.write)
  }

  /**
   * A trip whose own start the server refused, or whose «Вернуть» it did: nothing of it can be
   * written, and what waits for it stays on the phone, named by the notice, until the person
   * takes it away (MOL-76, adversarial А2).
   */
  function orphaned(tripId: string): boolean {
    return rejected.value.some(
      (item) =>
        (item.write.kind === 'start' || item.write.kind === 'restore') &&
        item.write.tripId === tripId,
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
    removeTrip,
    restoreTrip,
    removing,
    landed,
    wrote,
    lastRemoved,
    orphaned,
    /** The strip ran out: the removal stays, only the offer goes. */
    forgetRemoved: () => {
      lastRemoved.value = null
    },
    heldBack,
    joinElsewhere,
    finishElsewhere,
    flush,
  }
})
