import { DomainError, ERROR, manualRateFor } from '@molvia/model'
import type { RateChoiceBody, TripView } from '@molvia/model'
import type { Transact } from '@/db/unit-of-work'
import { tripViewFor } from './trip-view'

/**
 * «Считать по новому курсу / по прежнему / по своему» (MOL-39, Р-19, Р-21). The snapshot stays as
 * it was taken; the choice only says which rate the trip counts by, so choosing again — any way —
 * is always possible, and the same choice twice is one. An own rate is the snapshot's pair with
 * the person's number, dated when entered. Any trip of the person's, finished too: the jump is
 * noticed on the screen, often after the shop.
 *
 * A trip that is not the person's answers as a missing one does. A trip that never jumped, or a
 * choice of «previous» where there is none, conflicts with the trip's state — not a bad request.
 */
export async function chooseTripRate(
  transact: Transact,
  actorId: string,
  tripId: string,
  body: RateChoiceBody,
  now: Date = new Date(),
): Promise<TripView> {
  return transact(async (repositories) => {
    const trip = await repositories.trips.lock(tripId, actorId)
    if (!trip) throw new DomainError(ERROR.NOT_FOUND)
    if (!trip.rate || !trip.rateJumped) throw new DomainError(ERROR.CONFLICT)
    if (body.choice === 'previous' && !trip.previousRate) throw new DomainError(ERROR.CONFLICT)

    const manual = body.choice === 'manual' ? manualRateFor(trip.rate, body.rate, now) : null
    const chosen = await repositories.trips.chooseRate(tripId, actorId, body.choice, manual)
    if (!chosen) throw new DomainError(ERROR.NOT_FOUND)
    return tripViewFor(repositories, chosen)
  })
}
