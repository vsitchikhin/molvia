import type { Item } from '@molvia/model'
import type { ItemRepository } from '@/db/items-repository'

/**
 * How many rows a search answers with. A product decision rather than a parameter: a phone
 * shows five to seven, the rest is scrolling, and the device keeps the same twenty as its
 * recent picks. A `limit` on the route arrives with a second caller that needs another answer.
 */
export const SEARCH_LIMIT = 20

export interface CatalogueSearchDeps {
  readonly items: ItemRepository
}

/**
 * The catalogue lookup behind «что взяли?».
 *
 * It used to be the first writer of the event log, and no longer writes anything (MOL-31,
 * Р-18). That was the owner's decision in MOL-12, taken with its price in view and with the
 * condition named: a search is a purchase being entered, so the row measured «still
 * entering» *until the screens showing other people's data arrived*, and then who writes the
 * visit had to be decided again. They have arrived. «Что брать» writes `advice_viewed`, the
 * 0.3 gate counts that, and `catalogue_viewed` was left with no reader at all — and an event
 * nothing reads is exactly what the log is not for: whether a person enters purchases is
 * answered by `expenses` and `verdicts`, and duplicating a domain table into an append-only
 * log is the one thing it must never hold.
 *
 * The rows already written stay where they are. The log is append-only, and they were true.
 */
export async function searchCatalogue(
  { items }: CatalogueSearchDeps,
  actorId: string,
  query: string,
): Promise<Item[]> {
  return items.search(query, SEARCH_LIMIT, actorId)
}
