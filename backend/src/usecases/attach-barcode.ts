import { DomainError, ERROR, writtenBarcode } from '@molvia/model'
import type { Attached, ItemRepository } from '@/db/items-repository'

export type { Attached }

/**
 * «Привязать код к ней?» (MOL-100): a code the catalogue did not know, written to an item the person
 * found by its name. Anyone may write one to any item — a code is a fact from the package, not an
 * opinion — so the owner is only who wrote it (`added_by`), never a filter.
 *
 * The code must check, and is written in the form the scanner reads it as (`writtenBarcode`, Р-1).
 * Another item holding it or its twin is an answer naming that item, and nothing is written (Р-3).
 */
export async function attachBarcode(
  items: ItemRepository,
  actorId: string,
  itemId: string,
  code: string,
): Promise<Attached> {
  const written = writtenBarcode(code)
  if (!written.ok) throw new DomainError(written.error)
  const attached = await items.attachBarcode(itemId, written.code, actorId)
  if (attached === null) throw new DomainError(ERROR.NOT_FOUND)
  return attached
}

/**
 * «Код … — не этот товар?» (MOL-100, В-1): the code let go of by the item it was wrongly written to.
 * Anyone may, as anyone may write one: the person who says so holds the package, and the code is
 * free for the item it belongs to. A code the item does not hold is let go of already.
 */
export async function detachBarcode(
  items: ItemRepository,
  itemId: string,
  code: string,
): Promise<void> {
  if (!(await items.detachBarcode(itemId, code))) throw new DomainError(ERROR.NOT_FOUND)
}
