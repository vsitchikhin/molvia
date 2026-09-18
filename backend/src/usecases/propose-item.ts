import type { Item, ProposedItem } from '@molvia/model'
import type { ItemRepository } from '@/db/items-repository'

export interface Proposed {
  readonly item: Item
  /** `false` when the catalogue already held it — the route answers 200 rather than 201. */
  readonly created: boolean
}

/**
 * «Предложить товар» — the only way the catalogue grows in 0.1.
 *
 * An item of the same kind and the same name, case and spacing aside, is returned instead of
 * being added again (MOL-12, В-5): a double tap, a retry after a timeout or two people on the
 * same evening would otherwise split one product's ratings across two rows. The existing item
 * wins whole — the note and unit sent now are not applied to it. The check and the insert are
 * one step in the repository, under a lock: a double tap is two requests at once.
 *
 * The owner comes from the caller, never from the input, so an item cannot be added in someone
 * else's name. No barcodes in 0.1 (`proposedItemSchema`).
 */
export async function proposeItem(
  items: ItemRepository,
  actorId: string,
  input: ProposedItem,
): Promise<Proposed> {
  return items.createUnlessNamed({ ...input, barcodes: [] }, actorId)
}
