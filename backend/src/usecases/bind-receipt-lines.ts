import {
  RECEIPT_NAME_LANGUAGE,
  createLineMatcher,
  isServiceClass,
  receiptLineName,
  serbianServiceLine,
} from '@molvia/model'
import type { AppLocale, ReceiptCountry, ReceiptLine } from '@molvia/model'
import type { ItemRepository } from '@/db/items-repository'
import type { LineBinding } from '@/db/receipts-repository'
import type { Embedder } from '@/embeddings/embedder'
import { TILL_WORDS_RU } from '@/receipts/till-words-ru'
import { queryMeaning } from '@/usecases/query-meaning'

export interface BindReceiptLinesDeps {
  readonly items: Pick<ItemRepository, 'nodes' | 'search'>
  /** The model of the search by meaning (MOL-105); without one, letters alone. */
  readonly embedder: Pick<Embedder, 'model' | 'query'>
}

/** The search is asked for its first item only; a few more lets its order settle the same way. */
const SEARCH_ROWS = 5

/** A name shorter than this is no item to search by: «Ko», a unit's cut that stood alone. */
const SHORTEST_NAME = 3

/**
 * The lines of a parsed receipt to items, once, in the queue (MOL-126, Р-1): the catalogue's names in
 * the till's language with the line's customs heading (`createLineMatcher`), then the catalogue search
 * by the line's gloss — near is found, far is «проверьте» (MOL-124 В-4) — and nothing is a new item,
 * named by the gloss. A line of a class of services, «56.10» of food service, is a dish: whatever the
 * catalogue's goods give it is «проверьте» (MOL-226). The shop's memory comes before all of it, but it
 * is laid over on every reading of the receipt rather than here: it changes with every receipt recorded.
 * A country with no names of its own, Serbia, goes by the search of the line's name alone (MOL-232, В-3).
 *
 * The gloss is Russian, the catalogue's language, and is shown only to a receipt read out in Russian;
 * the search asks it whatever the receipt's language.
 */
export async function bindReceiptLines(
  { items, embedder }: BindReceiptLinesDeps,
  actorId: string,
  country: ReceiptCountry,
  language: AppLocale,
  lines: readonly ReceiptLine[],
): Promise<LineBinding[]> {
  const names = RECEIPT_NAME_LANGUAGE[country]
  const matcher = createLineMatcher(
    names === undefined ? [] : await items.nodes(names),
    TILL_WORDS_RU,
  )
  const bound: LineBinding[] = []
  for (const line of lines) {
    if (names === undefined) {
      // a delivery or a tip is no product: «проверьте», never a new item in silence (MOL-232, А6)
      if (serbianServiceLine(line.printed)) {
        bound.push({ itemId: null, match: 'weak', translation: null })
        continue
      }
      // a country with no names of its own in the catalogue, Serbia: its till prints the name in full,
      // the same every time, and the search — by meaning too — reads it as typed (MOL-232, В-3)
      bound.push(await bySearch(receiptLineName(line.printed, country)))
      continue
    }
    const gloss = matcher.gloss(line.printed)
    const translation = language === 'ru' && gloss !== '' ? gloss : null
    const found = matcher.match(line.printed, line.hs)
    if (found !== null) {
      bound.push({ itemId: found.itemId, match: found.far ? 'weak' : 'search', translation })
      continue
    }
    if (gloss !== '') {
      const answer = await items.search(
        gloss,
        SEARCH_ROWS,
        actorId,
        await queryMeaning(embedder, gloss),
      )
      const [first] = answer.items
      if (first !== undefined) {
        // a dish of a class of services is never sure among the catalogue's goods (MOL-226)
        const near = answer.nearIds.includes(first.id) && !isServiceClass(line.hs)
        bound.push({ itemId: first.id, match: near ? 'search' : 'weak', translation })
        continue
      }
    }
    bound.push({ itemId: null, match: 'new', translation })
  }
  return bound

  /**
   * The line's name whole (MOL-232, В-3). Measured on the 98 Serbian lines of MOL-223 and MOL-229
   * against the seed (`.scratch/tasks/status/MOL-232`): with meaning 14 near, 12 of them right, 2 far,
   * 82 new. Asked again by its first two words and its first, the search added 34 far lines, some 30 of
   * them wrong — «UBRUS» a vinegar, «SAPUN» a matsun — and a wrong «проверьте» taken at a glance is a
   * wrong purchase; new is a name typed once, which the shop's memory keeps.
   */
  async function bySearch(name: string): Promise<LineBinding> {
    if (name.length < SHORTEST_NAME) return { itemId: null, match: 'new', translation: null }
    const answer = await items.search(
      name,
      SEARCH_ROWS,
      actorId,
      await queryMeaning(embedder, name),
    )
    const [first] = answer.items
    if (first === undefined) return { itemId: null, match: 'new', translation: null }
    return {
      itemId: first.id,
      match: answer.nearIds.includes(first.id) ? 'search' : 'weak',
      translation: null,
    }
  }
}
