import { barcodeTwins } from '@molvia/model'
import type { Item } from '@molvia/model'
import type { ItemRepository } from '@/db/items-repository'

/**
 * The item a scanned or typed code belongs to (MOL-99), looked for in every form the package's
 * code may have been taken in (`barcodeTwins`, review С-14), the code as read first. A code of no
 * barcode's shape is answered as one nobody holds, without asking the database.
 *
 * It writes nothing: not the event log, and not the memory of picks — a code is not a query, and
 * an item taken by its code teaches the search no word for it.
 */
export async function findByBarcode(items: ItemRepository, code: string): Promise<Item | null> {
  const codes = barcodeTwins(code)
  return codes.length === 0 ? null : items.byBarcode(codes)
}
