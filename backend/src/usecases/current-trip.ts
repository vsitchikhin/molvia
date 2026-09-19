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
