import { DomainError, ERROR, newVerdictSchemaFor } from '@molvia/model'
import type { Rating } from '@molvia/model'
import type { ItemRepository } from '@/db/items-repository'
import type { RatedVerdict, VerdictRepository } from '@/db/verdicts-repository'
import { parseBody } from '@/parse'

export interface RateItemDeps {
  readonly items: ItemRepository
  readonly verdicts: VerdictRepository
}

/**
 * «Поставить оценку» (MOL-27): a first verdict on an item, or the same verdict given again.
 *
 * Any item of the catalogue can be rated, bought on a trip or not (В-1): 0.1 is the owner's
 * own data, and milk drunk for a year before the app existed is still worth a verdict.
 *
 * The item is loaded before the write because the rule about a place depends on its kind,
 * and the kind is not in the request and cannot be — the client must not be the one to say
 * it. The body carries no place until 0.3, so a dish that reached the catalogue some other
 * way is refused here as a body that does not fit, rather than by the CHECK as a 500. It is
 * parsed through the same seam as any body (`@/parse`): what failed is the request, only its
 * schema became known after a read.
 *
 * No event is recorded: the 0.2 gate is a query over `verdicts` (CLAUDE.md).
 */
export async function rateItem(
  { items, verdicts }: RateItemDeps,
  actorId: string,
  itemId: string,
  rating: Rating,
): Promise<RatedVerdict> {
  const item = await items.byId(itemId)
  if (!item) throw new DomainError(ERROR.NOT_FOUND)

  const input = parseBody(newVerdictSchemaFor(item.kind), { ...rating, itemId })
  return verdicts.put(actorId, input)
}
