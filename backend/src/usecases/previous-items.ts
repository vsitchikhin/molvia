import { DomainError, ERROR, catalogueEntryOf } from '@molvia/model'
import type { PreviousItemsResponse } from '@molvia/model'
import type { TripRepositories } from '@/db/unit-of-work'

/**
 * How many items «Брали здесь в прошлый раз» is answered with — as many as the search and the
 * recent items (`SEARCH_LIMIT`, `RECENT_LIMIT`). The phone shows five, but only after taking out
 * what is already in this trip (Р-17), which only the phone knows whole: cut to five here, three of
 * them recorded left two, where ten were taken last time (MOL-209, Р-2). Counted after what this
 * trip holds on the server is taken out (В-5 «а»): the same arithmetic on a big receipt.
 */
export const PREVIOUS_ITEMS_LIMIT = 20

export type PreviousItemsDeps = Pick<TripRepositories, 'trips' | 'items'>

/**
 * «Брали здесь в прошлый раз» (MOL-209, Ф-24): what the person took the last time they were at
 * this trip's place. The place is the trip's, never the request's, and the trip is the session
 * owner's — a stranger's, a missing or a removed one is the one `404`. Reads, writes nothing.
 */
export async function previousItems(
  { trips, items }: PreviousItemsDeps,
  actorId: string,
  tripId: string,
): Promise<PreviousItemsResponse> {
  const found = await trips.previousPurchases(tripId, actorId, PREVIOUS_ITEMS_LIMIT)
  if (!found) throw new DomainError(ERROR.NOT_FOUND)

  const byId = new Map((await items.byIds(found.itemIds)).map((item) => [item.id, item]))
  return {
    previous: found.previous,
    items: found.itemIds.map((id) => {
      const item = byId.get(id)
      // The foreign key holds it: missing is a defect, a 500 with a line, never a «not found».
      if (!item) throw new Error(`previous trip: item ${id} was not read`)
      return catalogueEntryOf(item)
    }),
  }
}
