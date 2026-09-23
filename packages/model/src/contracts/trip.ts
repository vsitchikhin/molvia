import { z } from 'zod'
import { actorSettingsSchema } from './settings'
import { CATALOGUE_QUERY_MAX, catalogueEntryCodec, catalogueEntryOf } from './catalogue'
import type { Expense } from '#model/entities/expense'
import { newExpenseSchema } from '#model/entities/expense'
import type { Item } from '#model/entities/item'
import { newPlaceSchema, placeSchema } from '#model/entities/place'
import type { Place } from '#model/entities/place'
import {
  convertedMinor,
  effectiveRate,
  isTripRateStale,
  rateChoiceSchema,
  tripTotal,
} from '#model/entities/trip'
import type { Trip } from '#model/entities/trip'
import { INT8_MAX } from '#model/support/decimal'
import { currencySchema, moneyCodec } from '#model/values/money'
import type { Money } from '#model/values/money'
import { rateCodec, rateProviderSchema } from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'
import { quantityCodec, unitPrice, unitPriceCodec } from '#model/values/units'

/**
 * An identifier the device names a row with, in lower case only. Postgres compares uuids without
 * case and answers in lower case, so an `AB12…` sent in would come back as `ab12…` and the device
 * would not find its own row in the reply (MOL-21, adversarial round 2, В). Refused rather than
 * folded: folding would still leave the device holding the spelling it sent.
 */
const deviceIdSchema = z.uuid().regex(/^[0-9a-f-]+$/)

/**
 * The body of «Начать поход».
 *
 * The identifier comes from the device, not the server (MOL-21, В-2): a trip started with no
 * signal has to be named by the expenses queued inside it, and a double tap has to meet its own
 * trip rather than a «another trip is open» about itself. That differs from the actor on
 * purpose — there the identifier is the proof of identity (MOL-8); here it only names a row that
 * the owner in the header already guards.
 *
 * The place is named, not picked by id: no screen lists places to pick from beyond the last
 * few, and the country and city come from the person's settings. Stores only until 0.3, for
 * the reason «Предложить товар» takes products only — a venue would enter the gate as a store.
 */
export const startTripBodySchema = z.strictObject({
  id: deviceIdSchema,
  // Optional only for a repeat from the old queue; a new trip must supply it.
  context: actorSettingsSchema.optional(),
  place: z.strictObject({
    kind: z.literal('store'),
    name: newPlaceSchema.shape.name,
  }),
})
export type StartTripBody = z.infer<typeof startTripBodySchema>

/**
 * The body of «Добавить в поход». Exactly one field is required beyond the identifier — the
 * item; the rest may come later through the patch.
 *
 * `query` is what was typed before the item was picked. It is remembered in the same
 * transaction as the expense (MOL-11), so a pick exists only when the purchase does. Bounded
 * as the search bounds it: nothing longer could have been the query that found the item.
 */
export const addExpenseBodySchema = newExpenseSchema.omit({ tripId: true }).extend({
  id: deviceIdSchema,
  query: z.string().max(CATALOGUE_QUERY_MAX).optional(),
})
export type AddExpenseBody = z.infer<typeof addExpenseBodySchema>

const isoDate = z.codec(z.iso.datetime(), z.date(), {
  decode: (wire) => new Date(wire),
  encode: (date) => date.toISOString(),
})

/** What the trip screen shows of a place: the name in «Ереван Сити · сегодня», and no more. */
const tripPlaceSchema = placeSchema.pick({ id: true, kind: true, name: true })
export type TripPlace = z.infer<typeof tripPlaceSchema>

const tripExpenseCodec = z.strictObject({
  id: z.uuid(),
  createdAt: isoDate,
  /** The catalogue card, not the item: `createdBy` is somebody's identity (MOL-12). */
  item: catalogueEntryCodec,
  quantity: quantityCodec.nullable(),
  amount: moneyCodec.nullable(),
  /** Computed, never entered and never stored — null until both the amount and the quantity are there. */
  unitPrice: unitPriceCodec.nullable(),
})
export type TripExpenseView = z.output<typeof tripExpenseCodec>

/**
 * A trip as the screen shows it, and the answer of every route that changes one: the list, the
 * price per unit of each row and the total are all the server's, so the phone adds nothing up
 * and divides nothing (CLAUDE.md, «No business logic on the frontend»).
 *
 * Strict, as the catalogue card is: a reply that grew a field fails to parse on the client
 * rather than carrying it past a screen that never reads it — which is how a leak would go
 * unnoticed.
 */
export const tripViewCodec = z.strictObject({
  id: z.uuid(),
  startedAt: isoDate,
  finishedAt: isoDate.nullable(),
  finishedOnDeviceAt: isoDate.nullable().optional(),
  currency: currencySchema,
  /**
   * The rate the trip counts by: the snapshot, or — when it jumped and the person chose — the rate
   * before the jump, or their own for this trip (`source: 'personal'`). What `converted` uses.
   */
  rate: rateCodec.nullable(),
  /**
   * Who published the rate the trip **snapshotted** (MOL-22) — not necessarily the rate above:
   * after a jump the person may count by their own, and `rate.source` is then `personal` while
   * this still names the bank the trip took its snapshot from. Null only when there is no
   * snapshot at all.
   *
   * `source: 'fallback'` alone cannot be shown: the screen has to name the bank or the aggregator
   * it counts by, and the aggregator's terms require the name.
   */
  rateProvider: rateProviderSchema.nullable(),
  /**
   * When the snapshotted rate jumped (MOL-39, Р-19, Р-21): the jumped rate, the one before it if
   * there is one, the person's own if they entered it, and their choice — null until made. The
   * screen warns and offers «по новому / по прежнему / свой». Null when nothing jumped.
   */
  rateJump: z
    .strictObject({
      jumped: rateCodec,
      previous: rateCodec.nullable(),
      manual: rateCodec.nullable(),
      choice: rateChoiceSchema.nullable(),
    })
    .nullable(),
  /**
   * The official rate was over a week old when the trip started (Р-18): the screen says the rate
   * is as of its date and the bank has published nothing since.
   */
  rateStale: z.boolean(),
  place: tripPlaceSchema.strict(),
  expenses: z.array(tripExpenseCodec),
  /** One per currency, and empty rather than zero when nothing is priced yet. */
  total: z.array(moneyCodec),
  /**
   * The total in the trip's currency, converted by the rate the trip counts by. An estimate
   * for display, never a fact — null without a rate: an empty cache, or one currency (MOL-39).
   */
  converted: moneyCodec.nullable(),
})
export type TripView = z.output<typeof tripViewCodec>

/** «No trip» is an ordinary state of the screen («Новый поход»), not a 404. */
export const currentTripResponseSchema = z.strictObject({
  trip: tripViewCodec.nullable(),
})
export type CurrentTripResponse = z.infer<typeof currentTripResponseSchema>

export const recentPlacesResponseSchema = z.strictObject({
  places: z.array(tripPlaceSchema.strict()),
})
export type RecentPlacesResponse = z.infer<typeof recentPlacesResponseSchema>

/**
 * The total converted for display, or nothing. An estimate, never a fact — so one that does not
 * fit is shown as none rather than refusing the purchase the trip is being written with: the
 * answer is built inside the writer's transaction, and a throw here would undo the expense
 * (MOL-21, С-11).
 */
function estimate(total: Money, rate: ExchangeRate): Money | null {
  const minor = convertedMinor(total, rate)
  return minor > INT8_MAX ? null : { minor, currency: rate.base }
}

/** The one way a place becomes what the trip screen sees of it. */
export function tripPlaceOf(place: Place): TripPlace {
  return { id: place.id, kind: place.kind, name: place.name }
}

/**
 * Assembles the trip the screen shows. Pure: the rows are read by the caller, and every number
 * here comes from a rule the domain already owns — `unitPrice`, `tripTotal`, `convertMoney`.
 *
 * An expense whose item is missing is a defect rather than a state: the foreign key holds it,
 * so reaching the throw means the caller read the rows from two different moments. A plain
 * Error on purpose — a DomainError would reach the client as a 404, «not found», and a broken
 * server would read as a missing row with no line in the log.
 */
export function tripViewOf(
  trip: Trip,
  place: Place,
  expenses: readonly Expense[],
  items: readonly Item[],
): TripView {
  const byId = new Map(items.map((item) => [item.id, item]))

  const rows = expenses.map((expense): TripExpenseView => {
    const item = byId.get(expense.itemId)
    if (!item) throw new Error(`trip ${trip.id}: item ${expense.itemId} was not read`)
    return {
      id: expense.id,
      createdAt: expense.createdAt,
      item: catalogueEntryOf(item),
      quantity: expense.quantity,
      amount: expense.amount,
      unitPrice:
        expense.amount && expense.quantity ? unitPrice(expense.amount, expense.quantity) : null,
    }
  })

  const total = tripTotal(expenses)
  const inTripCurrency = total.find((money) => money.currency === trip.currency)
  const rate = effectiveRate(trip)

  return {
    id: trip.id,
    startedAt: trip.startedAt,
    finishedAt: trip.finishedAt,
    finishedOnDeviceAt: trip.finishedOnDeviceAt ?? null,
    currency: trip.currency,
    rate,
    rateProvider: trip.rateProvider,
    rateJump:
      trip.rate && trip.rateJumped
        ? {
            jumped: trip.rate,
            previous: trip.previousRate,
            manual: trip.manualRate,
            choice: trip.rateChoice,
          }
        : null,
    rateStale: isTripRateStale(trip),
    place: tripPlaceOf(place),
    expenses: rows,
    total: [...total],
    converted: rate && inTripCurrency ? estimate(inTripCurrency, rate) : null,
  }
}

/**
 * «Считать по новому курсу / по прежнему / по своему» (MOL-39, Р-19, Р-21). Repeatable: the same
 * choice twice is one. The own rate travels as the decimal a person types — `parseRate` reads it.
 */
export const rateChoiceBodySchema = z.discriminatedUnion('choice', [
  z.strictObject({ choice: z.literal('jumped') }),
  z.strictObject({ choice: z.literal('previous') }),
  z.strictObject({ choice: z.literal('manual'), rate: z.string().max(40) }),
])
export type RateChoiceBody = z.infer<typeof rateChoiceBodySchema>

/**
 * The earliest moment a phone may claim it closed a trip.
 *
 * It is the only key the history is ordered by, so a date no phone could have produced
 * rearranges the whole list for ever — and `0001-01-01`, which the driver hands back as
 * `2001-01-01`, would print one year on the card and sort by another two thousand apart (Б1).
 *
 * **Both ends are judged where the clock is — in the use case — and neither is a refusal**
 * (Р-33). The floor lived in the schema for a day, and that made the two ends behave in
 * opposite ways: a phone whose clock ran ahead had its time dropped and its trip closed, while
 * one whose clock had fallen back got a 400. The queue never retries a refusal, so that trip
 * could never be closed at all, and the local mark of its completion was dropped beside it —
 * and a battery that died is the ordinary way a clock falls back (В2, Г1).
 */
export const DEVICE_TIME_EPOCH = new Date('2000-01-01T00:00:00.000Z')

/** How far ahead of the server a phone's clock may be and still be believed. */
export const DEVICE_TIME_AHEAD_MS = 24 * 60 * 60 * 1000

/** Whether a moment a phone named is one it could plausibly have lived through. */
export function isDeviceTime(at: Date, now: Date): boolean {
  return at >= DEVICE_TIME_EPOCH && at.getTime() - now.getTime() <= DEVICE_TIME_AHEAD_MS
}

/** Old queued finishes have no device time; retries preserve whichever time first arrived. */
export const finishTripBodySchema = z.strictObject({
  finishedOnDeviceAt: isoDate.optional(),
})
export type FinishTripBody = z.output<typeof finishTripBodySchema>

export const TRIP_HISTORY_PAGE_SIZE = 20
export const tripHistoryCursorSchema = z.strictObject({
  // Keep PostgreSQL microseconds on the wire: decoding to Date would skip boundary rows.
  at: z.iso.datetime().refine((at) => !at.startsWith('0000-')),
  id: z.uuid(),
})
export type TripHistoryCursor = z.infer<typeof tripHistoryCursorSchema>
export const tripHistoryQuerySchema = z
  .strictObject({
    before: tripHistoryCursorSchema.shape.at.optional(),
    beforeId: z.uuid().optional(),
  })
  .refine((q) => (q.before === undefined) === (q.beforeId === undefined))

export const tripHistoryEntryCodec = z.strictObject({
  id: z.uuid(),
  place: tripPlaceSchema.strict(),
  startedAt: isoDate,
  finishedAt: isoDate,
  finishedOnDeviceAt: isoDate.nullable(),
})
export type TripHistoryEntry = z.output<typeof tripHistoryEntryCodec>
export const tripHistoryCodec = z.strictObject({
  trips: z.array(tripHistoryEntryCodec).max(TRIP_HISTORY_PAGE_SIZE),
  nextCursor: tripHistoryCursorSchema.nullable(),
})
export type TripHistory = z.output<typeof tripHistoryCodec>
