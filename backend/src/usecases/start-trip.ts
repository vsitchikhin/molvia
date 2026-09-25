import {
  DomainError,
  ERROR,
  geographyAllowed,
  pickOfficialRate,
  walletRate,
  yerevanDate,
} from '@molvia/model'
import type { Actor, AmdRate, OfficialRate, StartTripBody, TripView } from '@molvia/model'
import type { TripSnapshot } from '@/db/trips-repository'
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
 * The place is named, not picked: the country and the city come from the trip's own context —
 * the settings as the phone knew them when it started, which offline may be older than the
 * row — and `places.ensure` meets «ЕРЕВАН СИТИ» and «ереван сити» at the one shop. «Yerevan City» is a
 * second shop, accepted for 0.1 — merging places is 0.2's, as merging items is (MOL-21, В-11).
 *
 * The currency is a snapshot of the person's setting, and so is the rate: their own, from their
 * exchanges, or the official one read from the cache and never from the network — a trip at the
 * shelf does not wait for a central bank (MOL-39, Р-3; MOL-40). One transaction, so a trip refused
 * because another is open leaves no new place behind either.
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

    // Checked against the actor rather than by the body's own schema: `places` is a table
    // everyone shares, and without this the two cities the settings form offers are held by
    // the form alone — one `POST` away from a shop in a city that does not exist (MOL-65,
    // review 1). The same predicate `PUT /actors/me/settings` refuses by.
    //
    // «Not named» and «named in a way nothing may be written under» are one answer, because
    // they are one question for the person: name the city and the currencies of this trip.
    // A 400 would have been the end of that trip —
    // the queue sets a start it cannot send aside, and its purchases go with it, which is the
    // very thing the context exists to prevent (MOL-65, review 2, замечание 9). It happens to
    // a geography granted by hand, outside the form's two cities, after the person moves on.
    const context = body.context && geographyAllowed(body.context, actor) ? body.context : null
    if (!context) throw new DomainError(ERROR.TRIP_CONTEXT_REQUIRED)

    const place = await repositories.places.ensure({
      kind: body.place.kind,
      name: body.place.name,
      country: context.country,
      city: context.city,
    })
    const snapshot =
      (await personalRateFor(repositories, actor.id, context, now)) ??
      (await officialRateFor(repositories, context, now))
    const { trip, created } = await repositories.trips.start(
      actor.id,
      { id: body.id, placeId: place.id },
      context.spendCurrency,
      snapshot,
    )
    return { trip: await tripViewFor(repositories, trip), created }
  })
}

/**
 * The person's own rate of the trip's pair (MOL-40, В-3, В-4): the average cost of what they hold,
 * from their exchanges dated no later than today in Yerevan — or none, and the official rate goes
 * in instead: when they asked for the official one, when the two currencies are one, and when
 * they have no exchange of this pair. Never jumped, never with a provider: it is nobody's
 * publication, and nothing to measure a jump against.
 */
async function personalRateFor(
  { exchanges }: Pick<TripRepositories, 'exchanges'>,
  owner: string,
  pair: Pick<Actor, 'incomeCurrency' | 'spendCurrency'>,
  now: Date,
): Promise<TripSnapshot | null> {
  const base = pair.incomeCurrency
  const quote = pair.spendCurrency
  if (base === quote) return null
  if ((await exchanges.preference(owner)) !== 'personal') return null

  const wallet = walletRate(await exchanges.list(owner), base, quote, yerevanDate(now))
  return wallet ? { rate: wallet.rate, provider: null, jumped: false, previous: null } : null
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
  actor: Pick<Actor, 'incomeCurrency' | 'spendCurrency'>,
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
