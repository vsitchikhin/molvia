import { DomainError, ERROR } from '@molvia/model'
import type { TripView } from '@molvia/model'
import type { TripRepository } from '@/db/trips-repository'
import type { CurrentTripDeps } from './current-trip'
import { tripViewFor } from './trip-view'

/**
 * «Удалить поход» (MOL-76): open or finished, empty or not — the question is the screen's. Marked
 * rather than deleted, by the money rule (Р-1): «Вернуть» for ten minutes, then the minute timer.
 * The same answer again while it is marked, so a queue sending twice is one removal; a trip that is
 * not the owner's, and one already final, is a missing one.
 */
export async function removeTrip(
  trips: Pick<TripRepository, 'remove'>,
  actorId: string,
  tripId: string,
): Promise<void> {
  if (!(await trips.remove(tripId, actorId))) throw new DomainError(ERROR.NOT_FOUND)
}

/**
 * «Вернуть»: the trip whole, as every answer about a trip is. Past its ten minutes it is gone; an
 * open one while another trip is open is `TRIP_OPEN` (Р-4).
 */
export async function restoreTrip(
  deps: CurrentTripDeps,
  actorId: string,
  tripId: string,
): Promise<TripView> {
  const trip = await deps.trips.restore(tripId, actorId)
  if (!trip) throw new DomainError(ERROR.NOT_FOUND)
  return tripViewFor(deps, trip)
}
