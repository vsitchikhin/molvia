import { EVENT } from '@molvia/model'
import type { Item } from '@molvia/model'
import type { EventRepository } from '@/db/events-repository'
import type { ItemRepository } from '@/db/items-repository'

/**
 * How many rows a search answers with. A product decision rather than a parameter: a phone
 * shows five to seven, the rest is scrolling, and the device keeps the same twenty as its
 * recent picks. A `limit` on the route arrives with a second caller that needs another answer.
 */
export const SEARCH_LIMIT = 20

export interface CatalogueSearchDeps {
  readonly items: ItemRepository
  readonly events: EventRepository
}

/**
 * The catalogue lookup behind «что взяли?», and the first writer of the event log.
 *
 * Why the search writes `catalogue_viewed` is the owner's decision (MOL-12, В-1), taken with
 * its price in view: in 0.1 and 0.2 a search is a purchase being entered, not someone reading
 * other people's data, so until the screens of 0.3 exist this row measures «still entering».
 * When those screens arrive, who writes this event has to be asked again. `product` always:
 * 0.1 has no venues, and the query alone does not say which half it belongs to.
 *
 * Recorded after the search answers, so a search that failed is not a visit; a failure to
 * record is not swallowed — a row lost here lowers the gate silently, with nothing to backfill.
 */
export async function searchCatalogue(
  { items, events }: CatalogueSearchDeps,
  actorId: string,
  query: string,
): Promise<Item[]> {
  const found = await items.search(query, SEARCH_LIMIT, actorId)
  await events.recordOncePerDay({
    actorId,
    type: EVENT.CATALOGUE_VIEWED,
    payload: { subject: 'product' },
  })
  return found
}
