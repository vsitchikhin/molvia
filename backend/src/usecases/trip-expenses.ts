import { DomainError, ERROR, isDeviceDay, isDeviceTime, toSearchKey } from '@molvia/model'
import type { AddExpenseBody, ExpensePatch, Money, Trip, TripView } from '@molvia/model'
import type { TripRepository } from '@/db/trips-repository'
import type { Transact, TripRepositories } from '@/db/unit-of-work'
import { tripViewFor } from './trip-view'

export interface Added {
  readonly trip: TripView
  /** `false` when the device sent this identifier before — the route answers 200, not 201. */
  readonly created: boolean
}

/**
 * The owner's trip, locked for the rest of the transaction — or the answer a stranger's and a
 * missing one give. Every write to a trip's rows goes through it, so they run one at a time per
 * trip: the total each one checks includes the others (MOL-21, adversarial Б).
 */
async function lockedTrip(trips: TripRepository, tripId: string, actorId: string): Promise<Trip> {
  const trip = await trips.lock(tripId, actorId)
  if (!trip) throw new DomainError(ERROR.NOT_FOUND)
  return trip
}

/**
 * Whether the query that missed is the found one, or one of them starts the other, by the key:
 * «Кефир» is «кефир », «сгущёнка варёная» cut short is «сгущенка» — a pick, not a word of one's
 * own, and learnt as well one purchase would count twice (adversarial Е, П). The screen holds
 * the same rule; this keeps a stale or a foreign client to it.
 */
function sameQuery(missed: string, query: string | undefined): boolean {
  if (query === undefined) return false
  const a = toSearchKey(missed)
  const b = toSearchKey(query)
  return a.startsWith(b) || b.startsWith(a)
}

/** The price of one of the trip's purchases, or null — none, or no such purchase. */
async function pricedAt(
  repositories: Pick<TripRepositories, 'expenses'>,
  trip: Trip,
  actorId: string,
  expenseId: string,
): Promise<Money | null> {
  const rows = await repositories.expenses.forTrip(trip.id, actorId)
  return rows.find((row) => row.id === expenseId.toLowerCase())?.amount ?? null
}

/** The trip's money changed: its «списано» goes (Р-32), and the answer shows it gone. */
async function moneyMoved(
  repositories: Pick<TripRepositories, 'moneyAccounts'>,
  trip: Trip,
): Promise<Trip> {
  await repositories.moneyAccounts.dropTripDebited(trip.id)
  return { ...trip, debited: null }
}

/**
 * A price changed: the trip's money moves with it — unless the trip has a receipt's sum, which is
 * its money whole (MOL-78, `tripMoney`). Under a receipt a price is an observation for «где
 * дешевле», typed at home into a trip already paid for, and taking «списано» off for it moved the
 * account by money that never moved (adversarial А, review 1).
 */
async function priceMoved(
  repositories: Pick<TripRepositories, 'moneyAccounts'>,
  trip: Trip,
): Promise<Trip> {
  return trip.receipt === null ? moneyMoved(repositories, trip) : trip
}

function sameMoney(a: Money | null, b: Money | null): boolean {
  return a?.minor === b?.minor && a?.currency === b?.currency
}

/**
 * «Добавить в поход». Any change of the trip's money — a priced purchase added, a price changed, a
 * priced one removed — takes its «списано» off: that figure was what left the account for the trip
 * as it was (Р-32, adversarial Ж2), and a check names the trip again until it is entered anew —
 * unless a receipt's sum is the trip's money (MOL-78). A finished trip takes it too (MOL-21, В-8): the soy sauce found in the bag
 * at home belongs to the trip it was bought on.
 *
 * The pick is remembered in the same transaction as the purchase (MOL-11), and only for a
 * purchase written now: a repeat from the queue is one purchase and one pick, and a purchase
 * refused leaves no pick lifting an item nobody took. The query that found nothing before it is
 * learnt the same way (MOL-45) — and not checked against the search: the row is the person's
 * alone, and checking would be a second search on every purchase.
 */
export async function addExpense(
  transact: Transact,
  actorId: string,
  tripId: string,
  body: AddExpenseBody,
): Promise<Added> {
  return transact(async (repositories) => {
    const trip = await lockedTrip(repositories.trips, tripId, actorId)
    const { query, missedQuery, ...fields } = body
    const { created } = await repositories.expenses.add(actorId, { ...fields, tripId: trip.id })
    const now = created && fields.amount !== undefined ? await priceMoved(repositories, trip) : trip
    if (created && query !== undefined) {
      await repositories.searchPicks.remember(actorId, query, body.itemId)
    }
    if (created && missedQuery !== undefined && !sameQuery(missedQuery, query)) {
      await repositories.searchPicks.learn(actorId, missedQuery, body.itemId)
    }
    return { trip: await tripViewFor(repositories, now), created }
  })
}

/**
 * «Добавить цену», «Сохранить» — the fields left for later, filled in or cleared. A row that is
 * not in this trip — gone, of another trip, someone else's — is NOT_FOUND: a price saved into
 * nothing must not answer «saved».
 */
export async function updateExpense(
  transact: Transact,
  actorId: string,
  tripId: string,
  expenseId: string,
  patch: ExpensePatch,
): Promise<TripView> {
  return transact(async (repositories) => {
    const trip = await lockedTrip(repositories.trips, tripId, actorId)
    const before = await pricedAt(repositories, trip, actorId, expenseId)
    const updated = await repositories.expenses.update(expenseId, trip.id, actorId, patch)
    if (!updated) throw new DomainError(ERROR.NOT_FOUND)
    const now = sameMoney(before, updated.amount) ? trip : await priceMoved(repositories, trip)
    return tripViewFor(repositories, now)
  })
}

/**
 * «Удалить позицию» — the only delete there is; there is no swipe on a row.
 *
 * Safe to repeat (MOL-21, С-8): a row not in the person's own trip is gone already, and the
 * answer is the trip as it is — the queue that sends it again after a lost reply meets the state
 * it asked for, not an error. A stranger's or a missing trip is still NOT_FOUND, and a stranger's
 * row is untouched: the owner and the trip are conditions of the delete.
 */
export async function removeExpense(
  transact: Transact,
  actorId: string,
  tripId: string,
  expenseId: string,
): Promise<TripView> {
  return transact(async (repositories) => {
    const trip = await lockedTrip(repositories.trips, tripId, actorId)
    const before = await pricedAt(repositories, trip, actorId, expenseId)
    const removed = await repositories.expenses.remove(expenseId, trip.id, actorId)
    const now = removed && before !== null ? await priceMoved(repositories, trip) : trip
    return tripViewFor(repositories, now)
  })
}

/**
 * «Сумма по чеку» (MOL-78): the receipt's sum whole, or none. A change is a change of the trip's
 * money and takes its «списано» off (Р-32 MOL-115), as a price does; the same sum again is a repeat
 * from the queue and moves nothing — neither «списано» nor the moment a check dates it by. The
 * server does not refuse a sum on a trip with no purchases (В-1): the screen does not offer one,
 * and a trip whose purchases were all removed after it keeps its money. **Nor does it take the sum off
 * such a trip once it is finished** (MOL-227, adversarial А4): a receipt with no items is recorded as its
 * sum alone, and a finished trip with no money and no purchase is the empty row «Записать» refuses
 * (Р-4) — «Удалить запись» is the way to be rid of it. An open one is a record still being typed. A rule
 * of the sum only: removing the last purchase of a finished trip leaves it empty, as before (round 2, Б3).
 */
export async function setReceipt(
  transact: Transact,
  actorId: string,
  tripId: string,
  receipt: Money | null,
): Promise<TripView> {
  return transact(async (repositories) => {
    const trip = await lockedTrip(repositories.trips, tripId, actorId)
    if (sameMoney(trip.receipt, receipt)) return tripViewFor(repositories, trip)
    // an open trip with nothing in it is a record being typed; a finished one is an empty row
    if (
      receipt === null &&
      trip.finishedAt !== null &&
      (await repositories.expenses.forTrip(trip.id, actorId)).length === 0
    ) {
      throw new DomainError(ERROR.RECEIPT_TOTAL_REQUIRED)
    }
    const changed = await repositories.trips.setReceipt(trip.id, actorId, receipt)
    if (!changed) throw new DomainError(ERROR.NOT_FOUND)
    return tripViewFor(repositories, await moneyMoved(repositories, changed))
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
  deviceAt?: Date,
  deviceDay?: string,
): Promise<void> {
  // Both ends of the window are judged here, where the clock is, and neither is a refusal
  // (Р-33): the queue never retries a refusal, so a trip nobody can close is worse than one
  // timed by the server — and that holds for a clock that fell back exactly as it does for one
  // that ran ahead. A battery that died is the ordinary way a clock reaches 1970 (В2, Г1).
  const now = new Date()
  const believable = deviceAt && isDeviceTime(deviceAt, now) ? deviceAt : undefined
  // The phone's day of the tap (MOL-121) by the same measure: past the latest day on Earth, dropped.
  const day = deviceDay && isDeviceDay(deviceDay, now) ? deviceDay : undefined
  const trip = await trips.finish(tripId, actorId, undefined, believable, day)
  if (!trip) throw new DomainError(ERROR.NOT_FOUND)
}
