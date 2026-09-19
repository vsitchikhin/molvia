import { DomainError, ERROR } from '@molvia/model'
import type { AddExpenseBody, ExpensePatch, Trip, TripView } from '@molvia/model'
import type { TripRepository } from '@/db/trips-repository'
import type { Transact, TripRepositories } from '@/db/unit-of-work'
import { tripViewFor } from './trip-view'

export interface Added {
  readonly trip: TripView
  /** `false` when the device sent this identifier before — the route answers 200, not 201. */
  readonly created: boolean
}

/** The owner's trip, or the same answer a stranger's and a missing one give. */
async function ownTrip(trips: TripRepository, tripId: string, actorId: string): Promise<Trip> {
  const trip = await trips.byId(tripId, actorId)
  if (!trip) throw new DomainError(ERROR.NOT_FOUND)
  return trip
}

/**
 * The expense has to be of this trip, not merely of this owner: the repository checks the
 * owner, and a row of the person's other trip named under this one would be changed while the
 * answer showed a trip it is not in.
 */
async function ownExpense(
  repositories: TripRepositories,
  tripId: string,
  expenseId: string,
  actorId: string,
): Promise<Trip> {
  const trip = await ownTrip(repositories.trips, tripId, actorId)
  const rows = await repositories.expenses.forTrip(trip.id, actorId)
  if (!rows.some((row) => row.id === expenseId)) throw new DomainError(ERROR.NOT_FOUND)
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
    const trip = await ownTrip(repositories.trips, tripId, actorId)
    const { query, ...fields } = body
    const { created } = await repositories.expenses.add(actorId, { ...fields, tripId: trip.id })
    if (created && query !== undefined) {
      await repositories.searchPicks.remember(actorId, query, body.itemId)
    }
    return { trip: await tripViewFor(repositories, trip), created }
  })
}

/** «Добавить цену», «Сохранить» — the fields left for later, filled in or cleared. */
export async function updateExpense(
  transact: Transact,
  actorId: string,
  tripId: string,
  expenseId: string,
  patch: ExpensePatch,
): Promise<TripView> {
  return transact(async (repositories) => {
    const trip = await ownExpense(repositories, tripId, expenseId, actorId)
    await repositories.expenses.update(expenseId, actorId, patch)
    return tripViewFor(repositories, trip)
  })
}

/** «Удалить позицию» — the only delete there is; there is no swipe on a row. */
export async function removeExpense(
  transact: Transact,
  actorId: string,
  tripId: string,
  expenseId: string,
): Promise<TripView> {
  return transact(async (repositories) => {
    const trip = await ownExpense(repositories, tripId, expenseId, actorId)
    await repositories.expenses.remove(expenseId, actorId)
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
