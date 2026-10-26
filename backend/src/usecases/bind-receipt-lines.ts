import {
  createLineMatcher,
  headingRulesOut,
  isServiceClass,
  lineFitter,
  newLineName,
  receiptCard,
  receiptLineName,
  receiptLineParts,
  serbianServiceLine,
} from '@molvia/model'
import type { AppLocale, NameLexicon, ReceiptCountry, ReceiptLine } from '@molvia/model'
import type { ItemRepository } from '@/db/items-repository'
import type { LineBinding } from '@/db/receipts-repository'
import type { Embedder } from '@/embeddings/embedder'
import { CATALOGUE_SEED } from '@/catalogue-seed'
import { TILL_BRANDS } from '@/receipts/till-brands'
import { TILL_WORDS_RU } from '@/receipts/till-words-ru'
import { findByBarcode } from '@/usecases/find-by-barcode'
import { queryMeaning } from '@/usecases/query-meaning'

export interface BindReceiptLinesDeps {
  readonly items: Pick<ItemRepository, 'nodes' | 'search' | 'byBarcode'>
  /** The model of the search by meaning (MOL-105); without one, letters alone. */
  readonly embedder: Pick<Embedder, 'model' | 'query'>
  /**
   * The catalogue holds no names in the till's language where the country has them (MOL-293): only the
   * manual seed writes them, and production went nineteen days without — every line by the gloss alone.
   */
  readonly namesMissing?: (error: CatalogueNamesMissing) => void
}

/** The catalogue has no names in a till's language: a fault of ours the owner hears of (MOL-293). */
export class CatalogueNamesMissing extends Error {
  constructor(language: string) {
    super(`the catalogue has no item names in ${language}`)
    this.name = 'CatalogueNamesMissing'
  }
}

/**
 * The search's first items the line's kind and brand are looked for among (MOL-293): the owner's «Сметана
 * «Тамара» 18%» stood past the fifth for «сметана», and ten found 116 lines of the bench right against 87.
 */
const SEARCH_ROWS = 10

/** The seed's names: kinds, never brands — no branded line stands on one (MOL-293, «Бекон» for a sausage of «Բեկոն»). */
const SEED_NAMES = new Set(CATALOGUE_SEED.map(([name]) => name))

/** What a new item's name is written with beyond the till's words (MOL-261): the brands as their packages spell them. */
export function namingLexicon(): NameLexicon {
  return { brands: TILL_BRANDS }
}

/** A name shorter than this is no item to search by: «Ko», a unit's cut that stood alone. */
const SHORTEST_NAME = 3

/**
 * The lines of a parsed receipt to items, once, in the queue (MOL-126, Р-1): the catalogue's names in
 * the till's language with the line's customs heading (`createLineMatcher`), then the catalogue search
 * by the line's gloss — near is found, far is «проверьте» (MOL-124 В-4), and so is one whose headings
 * the line's printed heading rules out (MOL-255, В-6 «б») — and nothing is a new item, named by the
 * gloss. A line of a class of services, «56.10» of food service, is a dish: whatever the
 * catalogue's goods give it is «проверьте» (MOL-226). The shop's memory comes before all of it, but it
 * is laid over on every reading of the receipt rather than here: it changes with every receipt recorded.
 * A country with no names of its own, Serbia, goes by the search of the line's name alone (MOL-232, В-3)
 * — after the line's code, where the tax office gave one and an item holds it (MOL-234): a package's
 * code is the package, as the scanner's is (MOL-99). The memory is still laid over it on reading.
 *
 * The gloss is Russian, the catalogue's language, and is shown only to a receipt read out in Russian;
 * the search asks it whatever the receipt's language.
 */
export async function bindReceiptLines(
  { items, embedder, namesMissing }: BindReceiptLinesDeps,
  actorId: string,
  country: ReceiptCountry,
  language: AppLocale,
  lines: readonly ReceiptLine[],
  /** Each line's code, in their order, where the tax office gave one (MOL-234). */
  codes: readonly (string | null)[] = [],
): Promise<LineBinding[]> {
  const names = receiptCard(country).nameLanguage
  const nodes = names === null ? [] : await items.nodes(names)
  if (names !== null && nodes.length === 0) namesMissing?.(new CatalogueNamesMissing(names))
  const matcher = createLineMatcher(nodes, TILL_WORDS_RU)
  const lexicon = namingLexicon()
  // the headings the seed gave the catalogue's nodes; an item the search finds outside them has none known
  const headings = new Map(nodes.map((node) => [node.itemId, node.headings]))
  const bound: LineBinding[] = []
  for (const [position, line] of lines.entries()) {
    if (names === null) {
      const code = codes[position] ?? null
      const held = code === null ? null : await findByBarcode(items, code)
      if (held !== null) {
        bound.push({ itemId: held.id, match: 'search', translation: null })
        continue
      }
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
    const parts = receiptLineParts(line.printed)
    if (gloss !== '') {
      const answer = await items.search(
        gloss,
        SEARCH_ROWS,
        actorId,
        await queryMeaning(embedder, gloss),
      )
      // the first the line's kind and brand let stand (MOL-293, В-1 «а»): «йогурт клубника» found
      // «Клубника» first, and an item that names a flavour, a brand or a size the line has not is another;
      // nor one the printed heading rules out — a brush is no tomato however the gloss read (MOL-255) —
      // which was «проверьте» and is now a new item, as the rest
      const fits = lineFitter(parts, TILL_WORDS_RU, lexicon)
      const first = answer.items.find(
        (item) =>
          fits(item.name, { generic: SEED_NAMES.has(item.name) }) &&
          !headingRulesOut(line.hs, headings.get(item.id) ?? []),
      )
      if (first !== undefined) {
        // a dish of a class of services is never sure among the catalogue's goods (MOL-226)
        const near = answer.nearIds.includes(first.id) && !isServiceClass(line.hs)
        bound.push({ itemId: first.id, match: near ? 'search' : 'weak', translation })
        continue
      }
    }
    // a new item, named in full from the line and offered under «проверьте»: a guess (MOL-293, В-1 «а»)
    const named = language === 'ru' ? newLineName(parts, TILL_WORDS_RU, lexicon) : null
    bound.push({
      itemId: null,
      match: 'weak',
      // never the gloss, which reads a word one edit off: «Ռոլիկ.» was a «помидор» (adversarial А7)
      translation: named?.name ?? null,
      spelled: named?.spelled ?? false,
    })
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
