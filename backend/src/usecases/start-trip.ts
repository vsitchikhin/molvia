import type { Actor, StartTripBody, TripView } from '@molvia/model'
import type { Transact } from '@/db/unit-of-work'
import { tripViewFor } from './trip-view'

export interface Started {
  readonly trip: TripView
  /** `false` when the device sent this identifier before — the route answers 200, not 201. */
  readonly created: boolean
}

/**
 * «Начать поход».
 *
 * The place is named, not picked: the country and the city are the person's own settings, and
 * `places.ensure` meets «ЕРЕВАН СИТИ» and «ереван сити» at the one shop. «Yerevan City» is a
 * second shop, accepted for 0.1 — merging places is 0.2's, as merging items is (MOL-21, В-11).
 *
 * The currency is a snapshot of the person's setting; the rate is null until MOL-39/40 give it
 * a source. One transaction, so a trip refused because another is open leaves no new place
 * behind either.
 */
export async function startTrip(
  transact: Transact,
  actor: Actor,
  body: StartTripBody,
): Promise<Started> {
  return transact(async (repositories) => {
    const place = await repositories.places.ensure({
      kind: body.place.kind,
      name: body.place.name,
      country: actor.country,
      city: actor.city,
    })
    const { trip, created } = await repositories.trips.start(
      actor.id,
      { id: body.id, placeId: place.id },
      actor.spendCurrency,
      null,
    )
    return { trip: await tripViewFor(repositories, trip), created }
  })
}
