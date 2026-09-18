import type { Item, NewItem } from '@molvia/model'
import type { ItemRepository } from '@/db/items-repository'

export interface Proposed {
  readonly item: Item
  /** `false` when the catalogue already held it — the route answers 200 rather than 201. */
  readonly created: boolean
}

/**
 * «Предложить товар» — the only way the catalogue grows in 0.1.
 *
 * An item whose name reduces to the same key, of the same kind, is returned instead of being
 * added again (MOL-12, В-5): a double tap, a retry after a timeout or two people on the same
 * evening would otherwise split one product's ratings across two rows. The existing item wins
 * whole — the note and unit sent now are not applied to it.
 *
 * The owner comes from the caller, never from the input: `newItemSchema` has no such field,
 * so an item cannot be added in someone else's name.
 */
export async function proposeItem(
  items: ItemRepository,
  actorId: string,
  input: NewItem,
): Promise<Proposed> {
  const existing = await items.byNameKey(input.kind, input.name)
  if (existing) return { item: existing, created: false }

  return { item: await items.create(input, actorId), created: true }
}
