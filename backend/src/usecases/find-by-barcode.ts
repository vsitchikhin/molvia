import { barcodeTwins, barcodeWriteForm } from '@molvia/model'
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
  // And in the form a write gives it (MOL-100, adversarial Р5-В): eight that check only as UPC-E
  // are written as their thirteen, and asked by the eight they were written from, the lookup found
  // nothing — a client that does not repeat the phone's rules must still find the package.
  const form = barcodeWriteForm(code)
  const codes = [...new Set([...barcodeTwins(code), ...(form.ok ? barcodeTwins(form.code) : [])])]
  return codes.length === 0 ? null : items.byBarcode(codes)
}
