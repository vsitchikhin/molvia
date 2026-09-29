import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import type { CatalogueEntry } from '@molvia/model'

/**
 * An item picked on the search screen, on its way to the sheet that asks how much and for what
 * price (MOL-24).
 *
 * The query travels with the item, and that is the point of this pair. «Добавить в поход» sends
 * it (`AddExpenseBody.query`), and the server remembers the pick under it, so the same query puts
 * the same item first next time (MOL-11). Handed the item alone, the sheet would add purchases
 * just as well while that memory silently stopped filling — nothing would fail. The query is the
 * field as typed: the server takes its key by the same function it uses for names.
 */
export interface Pick {
  readonly entry: CatalogueEntry
  readonly query: string
  /** The query that found nothing before this one found the item, if any (MOL-45). */
  readonly missedQuery?: string | null
}

export const useItemEntryStore = defineStore('itemEntry', () => {
  const picked = shallowRef<Pick | null>(null)
  /**
   * «Сканировать» on the record (MOL-99, В-4): the search screen opens with the scanner up. In
   * memory only — a reload of the search screen is not a tap on «Сканировать».
   */
  let scan = false

  function pick(next: Pick): void {
    picked.value = next
  }

  function clear(): void {
    picked.value = null
  }

  function askToScan(): void {
    scan = true
  }

  /** Whether the screen arrived to scan — asked once, and forgotten by asking. */
  function takeScan(): boolean {
    const asked = scan
    scan = false
    return asked
  }

  return { picked, pick, clear, askToScan, takeScan }
})
