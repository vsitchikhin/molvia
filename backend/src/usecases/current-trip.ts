import { DomainError, ERROR } from '@molvia/model'
import type { TripView } from '@molvia/model'
import type { TripRepositories } from '@/db/unit-of-work'
import { tripViewFor } from './trip-view'

export type CurrentTripDeps = Pick<TripRepositories, 'trips' | 'places' | 'expenses' | 'items'>

/**
 * The trip the screen opens on: the latest one not finished, whole. None is an ordinary state
 * — «Новый поход» — and answers null rather than failing.
 */
export async function currentTrip(
  deps: CurrentTripDeps,
  actorId: string,
): Promise<TripView | null> {
  const trip = await deps.trips.latestUnfinishedFor(actorId)
  return trip ? tripViewFor(deps, trip) : null
}

/** Explicit selection never falls back to the active trip. */
export async function selectedTrip(
  deps: CurrentTripDeps,
  actorId: string,
  id: string,
): Promise<TripView> {
  const trip = await deps.trips.byId(id, actorId)
  if (!trip) throw new DomainError(ERROR.NOT_FOUND)
  return tripViewFor(deps, trip)
}
