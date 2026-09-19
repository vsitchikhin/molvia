import { DomainError, ERROR } from '@molvia/model'
import type { AddExpenseBody, ExpensePatch, Trip, TripView } from '@molvia/model'
import type { TripRepository } from '@/db/trips-repository'
import type { Transact } from '@/db/unit-of-work'
import { tripViewFor } from './trip-view'

export interface Added {
  readonly trip: TripView
  /** `false` when the device sent this identifier before — the route answers 200, not 201. */
  readonly created: boolean
}

/**
 * The owner's trip, locked for the rest of the transaction — or the answer a stranger's and a
 * missing one give. Every write to a trip's rows goes through it, so they run one at a time per
 * trip: the total each one checks includes the others (MOL-21, adversarial Б).
 */
async function lockedTrip(trips: TripRepository, tripId: string, actorId: string): Promise<Trip> {
  const trip = await trips.lock(tripId, actorId)
  if (!trip) throw new DomainError(ERROR.NOT_FOUND)
  return trip
}

/**
 * «Добавить в поход». A finished trip takes it too (MOL-21, В-8): the soy sauce found in the bag
 * at home belongs to the trip it was bought on.
 *
 * The pick is remembered in the same transaction as the purchase (MOL-11), and only for a
 * purchase written now: a repeat from the queue is one purchase and one pick, and a purchase
 * refused leaves no pick lifting an item nobody took.
 */
export async function addExpense(
  transact: Transact,
  actorId: string,
  tripId: string,
  body: AddExpenseBody,
): Promise<Added> {
  return transact(async (repositories) => {
    const trip = await lockedTrip(repositories.trips, tripId, actorId)
    const { query, ...fields } = body
    const { created } = await repositories.expenses.add(actorId, { ...fields, tripId: trip.id })
    if (created && query !== undefined) {
      await repositories.searchPicks.remember(actorId, query, body.itemId)
    }
    return { trip: await tripViewFor(repositories, trip), created }
  })
}

/**
 * «Добавить цену», «Сохранить» — the fields left for later, filled in or cleared. A row that is
 * not in this trip — gone, of another trip, someone else's — is NOT_FOUND: a price saved into
 * nothing must not answer «saved».
 */
export async function updateExpense(
  transact: Transact,
  actorId: string,
  tripId: string,
  expenseId: string,
  patch: ExpensePatch,
): Promise<TripView> {
  return transact(async (repositories) => {
    const trip = await lockedTrip(repositories.trips, tripId, actorId)
    const updated = await repositories.expenses.update(expenseId, trip.id, actorId, patch)
    if (!updated) throw new DomainError(ERROR.NOT_FOUND)
    return tripViewFor(repositories, trip)
  })
}

/**
 * «Удалить позицию» — the only delete there is; there is no swipe on a row.
 *
 * Safe to repeat (MOL-21, С-8): a row not in the person's own trip is gone already, and the
 * answer is the trip as it is — the queue that sends it again after a lost reply meets the state
 * it asked for, not an error. A stranger's or a missing trip is still NOT_FOUND, and a stranger's
 * row is untouched: the owner and the trip are conditions of the delete.
 */
export async function removeExpense(
  transact: Transact,
  actorId: string,
  tripId: string,
  expenseId: string,
): Promise<TripView> {
  return transact(async (repositories) => {
    const trip = await lockedTrip(repositories.trips, tripId, actorId)
    await repositories.expenses.remove(expenseId, trip.id, actorId)
    return tripViewFor(repositories, trip)
  })
}

/**
 * «Завершить». The trip stops being current and stops holding back «Начать поход»; nothing
 * else about it changes — it still takes what was forgotten (В-8). Finishing again is not an
 * error and moves nothing.
 */
export async function finishTrip(
  trips: TripRepository,
  actorId: string,
  tripId: string,
): Promise<void> {
  const trip = await trips.finish(tripId, actorId)
  if (!trip) throw new DomainError(ERROR.NOT_FOUND)
}
