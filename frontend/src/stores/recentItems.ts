import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  INVISIBLE,
  barcodeTwins,
  catalogueEntryCodec,
  drawsNothing,
  kindKey,
  synonymDescribes,
  synonymKeys,
  synonymPairedKinds,
  toSearchKey,
} from '@molvia/model'
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

/** The codes this identity found its recent items by (MOL-99): code → item id. */
function codesKeyOf(actorId: string): string {
  return `molvia.recent-codes.${actorId}`
}

/** Pair by pair, as the list is read entry by entry; anything else is no codes at all. */
function loadCodes(actorId: string): Map<string, string> {
  const raw = read(codesKeyOf(actorId))
  if (!raw) return new Map()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return new Map()
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return new Map()
  return new Map(
    Object.entries(parsed).filter((pair): pair is [string, string] => typeof pair[1] === 'string'),
  )
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

const UNSEEN = new RegExp(`[${INVISIBLE}]`, 'gu')

/** Case and what draws nothing set aside — for narrowing, never for storing. */
function comparable(text: string): string {
  return text.replace(UNSEEN, '').toLocaleLowerCase()
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
  /**
   * The codes the items were found by, kept beside the list rather than in its rows: a row an
   * older version wrote stays readable. Only codes of items still in the list — a code is here to
   * find one of them without a network, and one that fell off the list finds nothing.
   */
  let codes = new Map<string, string>()
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
      codes = actorId === null ? new Map() : loadCodes(actorId)
      return
    }
    if (actorId === null || ahead) return
    const stored = load(actorId)
    if (stored !== null) items.value = stored
    codes = loadCodes(actorId)
  }

  /** With the code the item was found by, when it was found by one (MOL-99). */
  function remember(entry: CatalogueEntry, code?: string): void {
    sync()
    items.value = [entry, ...items.value.filter((kept) => kept.id !== entry.id)].slice(
      0,
      RECENT_LIMIT,
    )
    const kept = new Set(items.value.map((item) => item.id))
    codes = new Map([...codes].filter(([, itemId]) => kept.has(itemId)))
    if (code !== undefined) codes.set(code, entry.id)
    if (owner !== null) {
      const written = JSON.stringify(items.value.map((item) => catalogueEntryCodec.encode(item)))
      const writtenCodes = JSON.stringify(Object.fromEntries(codes))
      write(keyOf(owner), written)
      write(codesKeyOf(owner), writtenCodes)
      // Ahead unless storage reads back what was written. «Some shelf took it» is not enough: a
      // full localStorage keeps its older list and is read first, and the next `sync` would bring
      // that list back over the one just written to sessionStorage (adversarial B5).
      ahead = read(keyOf(owner)) !== written || read(codesKeyOf(owner)) !== writtenCodes
    }
  }

  /**
   * The recent item found by this code before, in any form the package's code may have been
   * taken in (`barcodeTwins`), as the server looks it up — or none.
   */
  function byCode(code: string): CatalogueEntry | null {
    sync()
    for (const form of barcodeTwins(code)) {
      const itemId = codes.get(form)
      const entry =
        itemId === undefined ? undefined : items.value.find((item) => item.id === itemId)
      if (entry) return entry
    }
    return null
  }

  /**
   * Narrowing twenty rows while offline, not a catalogue search: no transliteration and no
   * typos, which is what the offline text says («только среди недавних»). The one thing taken
   * from the search is its dictionary (MOL-45): at a shelf with no signal «картошка» has to find
   * the «Картофель» bought last week, or one word gives two answers depending on the network.
   */
  function filter(query: string): CatalogueEntry[] {
    // Empty by the measure the search uses, and what draws nothing is not looked for on either
    // side: a pasted U+200B left the phase at «nothing typed» and the list empty (Р-14, B1).
    if (drawsNothing(query)) return items.value
    const needle = comparable(query).trim()
    const words = needle.split(/\s+/u).map((word) => ({
      word,
      synonyms: toSearchKey(word).split(' ').flatMap(synonymKeys),
    }))
    const expands = words.some(({ synonyms }) => synonyms.length > 0)
    return items.value.filter((entry) => {
      const name = comparable(entry.name)
      if (name.includes(needle)) return true
      if (entry.note !== null && comparable(entry.note).includes(needle)) return true
      if (!expands) return false
      // As the search counts a synonym — the word of the kind, `kindKey` — and as it demands of
      // every other word a pair of its own: «сок яблочный» is not the peach nectar, though «сок»
      // alone is (adversarial Д).
      const kind = kindKey(entry.name)
      const keyWords = toSearchKey(entry.name).split(' ')
      return words.every(
        ({ word, synonyms }) =>
          name.includes(word) ||
          synonyms.some(
            (synonym) =>
              synonym === kind ||
              ((synonymDescribes(synonym) || synonymPairedKinds(synonym).includes(kind)) &&
                keyWords.includes(synonym)),
          ),
      )
    })
  }

  return { items, sync, remember, filter, byCode }
})
