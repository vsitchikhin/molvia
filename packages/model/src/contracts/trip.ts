import { z } from 'zod'
import { CATALOGUE_QUERY_MAX, catalogueEntryCodec, catalogueEntryOf } from './catalogue'
import type { Expense } from '#model/entities/expense'
import { newExpenseSchema } from '#model/entities/expense'
import type { Item } from '#model/entities/item'
import { newPlaceSchema, placeSchema } from '#model/entities/place'
import type { Place } from '#model/entities/place'
import { convertMoney, tripTotal } from '#model/entities/trip'
import type { Trip } from '#model/entities/trip'
import { currencySchema, moneyCodec } from '#model/values/money'
import { rateCodec } from '#model/values/rates'
import { quantityCodec, unitPrice, unitPriceCodec } from '#model/values/units'

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
  id: z.uuid(),
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
  id: z.uuid(),
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
  currency: currencySchema,
  rate: rateCodec.nullable(),
  place: tripPlaceSchema.strict(),
  expenses: z.array(tripExpenseCodec),
  /** One per currency, and empty rather than zero when nothing is priced yet. */
  total: z.array(moneyCodec),
  /**
   * The total in the trip's currency, converted by the rate the trip snapshotted. An estimate
   * for display, never a fact — null without a rate, which is every trip until MOL-39/40.
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

  return {
    id: trip.id,
    startedAt: trip.startedAt,
    finishedAt: trip.finishedAt,
    currency: trip.currency,
    rate: trip.rate,
    place: tripPlaceOf(place),
    expenses: rows,
    total: [...total],
    converted: trip.rate && inTripCurrency ? convertMoney(inTripCurrency, trip.rate) : null,
  }
}
