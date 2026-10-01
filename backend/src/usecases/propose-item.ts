import { DomainError, writtenBarcode } from '@molvia/model'
import type { ProposedItem } from '@molvia/model'
import type { ItemRepository, Proposal } from '@/db/items-repository'
import type { OpenFoodFactsRepository } from '@/db/open-food-facts-repository'

export type { Proposal }

/**
 * «Предложить товар» — the one way a person grows the catalogue.
 *
 * An item of the same kind and the same name, case and spacing aside, is returned instead of
 * being added again (MOL-12, В-5): a double tap, a retry after a timeout or two people on the
 * same evening would otherwise split one product's ratings across two rows. The existing item
 * wins whole — the note and unit sent now are not applied to it. The check and the insert are
 * one step in the repository, under a lock: a double tap is two requests at once.
 *
 * The codes read from the package go with it (MOL-100): each must check, in the form it is written,
 * and none may be a shop's own (`writtenBarcode`, Р-1, В-4); beside a name already there they are
 * not written — the screen asks about that item (В-5); and when another item holds one of them,
 * nothing is written and the answer names that item (Р-3).
 *
 * A new item proposed with a code Open Food Facts named is marked as such (MOL-162, В-2): its name
 * and size may be that base's, which is ODbL. Decided here, by what the server itself kept of the
 * base's answers — never by the phone — and generously: the mark stays even if the person rewrote
 * the name, since telling what is derived from what is not would be guessing.
 *
 * The owner comes from the caller, never from the input, so an item cannot be added in someone
 * else's name, and neither can a code.
 */
export async function proposeItem(
  items: ItemRepository,
  hints: Pick<OpenFoodFactsRepository, 'named'>,
  actorId: string,
  input: ProposedItem,
): Promise<Proposal> {
  const barcodes = input.barcodes.map((code) => {
    const written = writtenBarcode(code)
    if (!written.ok) throw new DomainError(written.error)
    return written.code
  })
  const origin = (await hints.named(barcodes)) ? 'open_food_facts' : null
  return items.createUnlessNamed({ ...input, barcodes }, actorId, origin)
}
