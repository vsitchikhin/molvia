import { pickOfficialRate, yerevanDate } from '@molvia/model'
import type { Actor, AmdRate, OfficialRate, StartTripBody, TripView } from '@molvia/model'
import type { Transact, TripRepositories } from '@/db/unit-of-work'
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
 * The currency is a snapshot of the person's setting, and so is the rate: the official one, read
 * from the cache and never from the network — a trip at the shelf does not wait for a central
 * bank (MOL-39, Р-3). One transaction, so a trip refused because another is open leaves no new
 * place behind either.
 */
export async function startTrip(
  transact: Transact,
  actor: Actor,
  body: StartTripBody,
  now: Date = new Date(),
): Promise<Started> {
  return transact(async (repositories) => {
    // A repeat is answered before the place is looked at: the same identifier sent again with
    // another name would otherwise leave a shop behind that no trip is in (MOL-21, С-4).
    const already = await repositories.trips.byId(body.id, actor.id)
    if (already) return { trip: await tripViewFor(repositories, already), created: false }

    const place = await repositories.places.ensure({
      kind: body.place.kind,
      name: body.place.name,
      country: actor.country,
      city: actor.city,
    })
    const official = await officialRateFor(repositories, actor, now)
    const { trip, created } = await repositories.trips.start(
      actor.id,
      { id: body.id, placeId: place.id },
      actor.spendCurrency,
      official?.rate ?? null,
      official?.previous ?? null,
    )
    return { trip: await tripViewFor(repositories, trip), created }
  })
}

/**
 * The official rate from the income currency into the spending one, as of `now` in Yerevan, or
 * none: nothing to convert when both are one currency, and nothing known when the cache is empty.
 * Which provider — the central bank, or an open source after a week of its silence — is the
 * domain's rule; a stale rate keeps its date, which the screen shows beside it. A rate that jumped
 * comes with the one before it, and the trip keeps both for the person to choose (Р-19).
 */
async function officialRateFor(
  { rates }: Pick<TripRepositories, 'rates'>,
  actor: Actor,
  now: Date,
): Promise<OfficialRate | null> {
  const base = actor.incomeCurrency
  const quote = actor.spendCurrency
  if (base === quote) return null

  const today = yerevanDate(now)
  const foreign = [base, quote].filter(
    (currency): currency is AmdRate['currency'] => currency !== 'AMD',
  )
  return pickOfficialRate(base, quote, await rates.latestOnOrBefore(foreign, today), today)
}
