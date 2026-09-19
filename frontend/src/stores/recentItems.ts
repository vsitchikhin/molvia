import { defineStore } from 'pinia'
import { ref } from 'vue'
import { catalogueEntryCodec } from '@molvia/model'
import type { CatalogueEntry } from '@molvia/model'
import { currentIdentity } from '@/stores/identity'
import { read, write } from '@/stores/storage'

/** As many as the search answers with: the device keeps the same twenty (`SEARCH_LIMIT`). */
export const RECENT_LIMIT = 20

/**
 * Per identity: after «Вернуть прежние данные» the recent items are that identity's, not the
 * one set aside — the same person, but not the same purchases.
 */
function keyOf(actorId: string): string {
  return `molvia.recent.${actorId}`
}

/**
 * Entry by entry, so one row an older version wrote differently costs that row and not the
 * list. Anything that is not a list at all is no list; `null` — nothing stored.
 */
function load(actorId: string): CatalogueEntry[] | null {
  const raw = read(keyOf(actorId))
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  return parsed.flatMap((row) => {
    const entry = catalogueEntryCodec.safeDecode(row)
    return entry.success ? [entry.data] : []
  })
}

/**
 * The items this person added to trips lately, kept on the device: «Часто берёте» under an
 * empty query, and the only thing to search while the network is gone.
 *
 * Written when an item goes into a trip, never on a tap — a tap the sheet cancels is a changed
 * mind, the rule the server's own memory of picks keeps (MOL-11). The writer is the sheet
 * (MOL-24). Newest first, by recency rather than by frequency: the handoff asks for «the last
 * twenty picked».
 *
 * Catalogue cards only — six public fields, nothing about the person — so nothing here is more
 * private than the catalogue itself.
 */
export const useRecentItemsStore = defineStore('recentItems', () => {
  const items = ref<CatalogueEntry[]>([])
  /** Whose list `items` holds. */
  let owner: string | null = null
  /**
   * Storage refused the last write, so memory is ahead of it for the rest of the session — and
   * reading storage again would bring back an older list.
   */
  let ahead = false

  /**
   * Called where the list is shown and before every write. Storage is read afresh each time: the
   * installed app and a tab opened from the bot share it, and a list read once and written whole
   * would erase what the other window added (adversarial A9).
   */
  function sync(): void {
    const actorId = currentIdentity()
    if (actorId !== owner) {
      owner = actorId
      ahead = false
      items.value = (actorId === null ? null : load(actorId)) ?? []
      return
    }
    if (actorId === null || ahead) return
    const stored = load(actorId)
    if (stored !== null) items.value = stored
  }

  function remember(entry: CatalogueEntry): void {
    sync()
    items.value = [entry, ...items.value.filter((kept) => kept.id !== entry.id)].slice(
      0,
      RECENT_LIMIT,
    )
    if (owner !== null) {
      ahead = !write(
        keyOf(owner),
        JSON.stringify(items.value.map((kept) => catalogueEntryCodec.encode(kept))),
      )
    }
  }

  /**
   * Narrowing twenty rows while offline, not a catalogue search: no transliteration and no
   * typos, which is what the offline text says («только среди недавних»).
   */
  function filter(query: string): CatalogueEntry[] {
    const needle = query.trim().toLocaleLowerCase()
    if (needle === '') return items.value
    return items.value.filter(
      (entry) =>
        entry.name.toLocaleLowerCase().includes(needle) ||
        (entry.note?.toLocaleLowerCase().includes(needle) ?? false),
    )
  }

  return { items, sync, remember, filter }
})
