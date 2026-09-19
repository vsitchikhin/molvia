import { DomainError, ERROR } from '@molvia/model'
import type { RateChoice, TripView } from '@molvia/model'
import type { Transact } from '@/db/unit-of-work'
import { tripViewFor } from './trip-view'

/**
 * «Считать по новому курсу / по прежнему» (MOL-39, Р-19). The snapshot stays as it was taken;
 * the choice only says which of its two rates the trip counts by, so choosing again — either way —
 * is always possible and the same choice twice is one. Any trip of the person's, finished too:
 * the jump is noticed on the screen, often after the shop.
 *
 * A trip that is not the person's answers as a missing one does; a trip with nothing to choose
 * between is a conflict with the trip's state, not a bad request.
 */
export async function chooseTripRate(
  transact: Transact,
  actorId: string,
  tripId: string,
  choice: RateChoice,
): Promise<TripView> {
  return transact(async (repositories) => {
    const chosen = await repositories.trips.chooseRate(tripId, actorId, choice)
    if (chosen) return tripViewFor(repositories, chosen)

    const trip = await repositories.trips.byId(tripId, actorId)
    throw new DomainError(trip ? ERROR.CONFLICT : ERROR.NOT_FOUND)
  })
}
