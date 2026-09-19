import { DomainError, ERROR, tripViewOf } from '@molvia/model'
import type { Trip, TripView } from '@molvia/model'
import type { TripRepositories } from '@/db/unit-of-work'

export type TripViewDeps = Pick<TripRepositories, 'places' | 'expenses' | 'items'>

/**
 * The trip as the screen shows it, and the one way every trip route builds its answer (MOL-21,
 * В-12). Three reads whatever the length of the list — the place, the rows, their items — so a
 * trip of twenty rows is not twenty-two queries.
 *
 * A place or an item that is not there is a defect, not a state: the foreign keys hold both.
 */
export async function tripViewFor(
  { places, expenses, items }: TripViewDeps,
  trip: Trip,
): Promise<TripView> {
  const place = await places.byId(trip.placeId)
  if (!place) throw new DomainError(ERROR.NOT_FOUND, `place ${trip.placeId}`)

  const rows = await expenses.forTrip(trip.id, trip.actorId)
  const catalogue = await items.byIds([...new Set(rows.map((row) => row.itemId))])
  return tripViewOf(trip, place, rows, catalogue)
}
