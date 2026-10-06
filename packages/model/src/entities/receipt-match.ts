// MOL-126 — a receipt line straight to a catalogue item, with no model: the items carry their names as
// the country's tills print them (`item_names`), the line's words are matched against them fuzzily, and
// the customs heading printed on the line rules out what cannot be. The port of MOL-114's
// `dict-match.mjs`, without improvements: on the bench's readings it gives the prototype's items, line
// for line (`.scratch/tasks/status/MOL-126/parity.mjs`), so the measured figure — 54 of 70 lines of
// receipts its rules never saw — still holds.

import { levenshtein } from '#model/support/edits'

/** An item as a receipt reaches it: its own name, its names in the till's language, its headings. */
export interface CatalogueNode {
  readonly itemId: string
  readonly name: string
  readonly names: readonly string[]
  readonly headings: readonly string[]
}

/**
 * The item a line found; `far` — «проверьте»: by its heading alone, with no word of a name, or a dish
 * of a class of services found among the catalogue's goods by its name.
 */
export interface LineMatch {
  readonly itemId: string
  readonly far: boolean
}

export interface LineMatcher {
  match(printed: string, hs: string | null): LineMatch | null
  /** The line word by word in Russian, by the dictionary of till words; '' when no word is known. */
  gloss(printed: string): string
}

/**
 * A class of services, «56.10» of food service (MOL-226): no customs heading, so it rules nothing out,
 * and the catalogue holds goods — «16 Թև», sixteen wings at KFC, is no «Крылья куриные». A dish
 * found by its name is a guess for the person to check, and the shop's memory learns the answer.
 */
export const isServiceClass = (hs: string | null): boolean =>
  hs !== null && /^\d{2}\.\d{2}$/.test(hs)

const isHeading = (hs: string | null): hs is string => hs !== null && /^\d{4}$/.test(hs)

/** Below this a line's best name is no match: the heading alone decides, or nothing does. */
const MATCH_SCORE = 0.7

/**
 * Tesseract puts Cyrillic and Latin look-alikes into Armenian words; the match and the gloss need only
 * the words with an Armenian letter, two letters or more.
 */
export function receiptWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/և/gu, 'եվ')
    .split(/[^ա-ևԱ-Ֆa-zа-яё0-9%]+/u)
    .filter((word) => word.length >= 2 && /[ա-և]/u.test(word))
}

/**
 * How well one word of a name is found among the line's words: exact, one or two edits by its length
 * (as the catalogue search allows), the line's word the start of it — a till cuts names at a fixed
 * width — or it the start of the line's word, inflected («ձեռնոցներ»).
 */
function wordScore(word: string, tokens: readonly string[]): number {
  let score = 0
  for (const token of tokens) {
    if (token === word) return 1
    const edits = levenshtein(token, word)
    if (edits === 1 && word.length >= 4) score = Math.max(score, 0.85)
    else if (edits === 2 && word.length >= 7) score = Math.max(score, 0.7)
    else if (token.length >= 3 && word.startsWith(token)) score = Math.max(score, 0.7)
    else if (word.length >= 4 && token.startsWith(word)) score = Math.max(score, 0.8)
  }
  return score
}

// The heading is read by the same OCR as the sums: 1905 comes out 1906, 2105 as 2106.
const SWAP: Readonly<Record<string, string>> = {
  '5': '6',
  '6': '5',
  '1': '4',
  '4': '1',
  '3': '8',
  '8': '3',
  '0': '9',
  '9': '0',
}

function headingVariants(hs: string): string[] {
  const out = [hs]
  for (let i = 0; i < hs.length; i++) {
    const swapped = SWAP[hs.charAt(i)]
    if (swapped !== undefined) out.push(hs.slice(0, i) + swapped + hs.slice(i + 1))
  }
  return out
}

/**
 * Builds the matcher over the catalogue's nodes, in the order given — on a tie the first wins — and a
 * dictionary of till words (Armenian → Russian).
 */
export function createLineMatcher(
  nodes: readonly CatalogueNode[],
  dictionary: Readonly<Record<string, string>>,
): LineMatcher {
  const words = new Map(Object.entries(dictionary))
  const fuzzyWords = [...words].filter(([word]) => Array.from(word).length >= 4)
  const index = nodes.flatMap((node) =>
    node.names
      .map((name) => ({ node, words: receiptWords(name) }))
      .filter((entry) => entry.words.length > 0),
  )

  function gloss(printed: string): string {
    return receiptWords(printed)
      .map(
        (token) =>
          words.get(token) ??
          fuzzyWords.find(([word]) => levenshtein(word, token) <= 1)?.[1] ??
          null,
      )
      .filter((word): word is string => word !== null && word !== '')
      .join(' ')
  }

  // A fat or a strength printed on the line picks the variety: «Կաթ 3.2%» is «Молоко 3,2%».
  function refine(found: CatalogueNode, printed: string): CatalogueNode {
    const percent = /(\d+(?:[.,]\d+)?)\s*%/u.exec(printed)?.[1]?.replace('.', ',')
    if (percent === undefined) return found
    const kind = found.name.replace(/\s+\d.*$/u, '')
    return (
      nodes.find((node) => node.name.startsWith(kind) && node.name.includes(`${percent}%`)) ?? found
    )
  }

  // No name matched: the heading alone, when it leaves one item, or the item whose own name shares a
  // stem with the line's gloss («кошка» → «Корм для кошек»). Bound far — «проверьте».
  function byHeading(printed: string, hs: string | null): LineMatch | null {
    if (!isHeading(hs)) return null
    // the exact heading only: a swapped digit is fine for ruling out, not for choosing (3506 → 8506)
    const candidates = nodes.filter((node) => node.headings.includes(hs))
    if (candidates.length === 0) return null
    const stems = gloss(printed)
      .toLowerCase()
      .split(/\s+/u)
      .filter((word) => word.length >= 4)
      .map((word) => word.slice(0, 4))
    const scored = candidates
      .map((node) => ({
        node,
        hits: stems.filter((stem) =>
          node.name
            .toLowerCase()
            .split(/\s+/u)
            .some((word) => word.length >= 4 && word.startsWith(stem.slice(0, 3))),
        ).length,
      }))
      .sort((a, b) => b.hits - a.hits || a.node.name.length - b.node.name.length)
    const [first] = scored
    if (first !== undefined && first.hits > 0) return { itemId: first.node.itemId, far: true }
    const [only] = candidates
    return candidates.length === 1 && only !== undefined ? { itemId: only.itemId, far: true } : null
  }

  function match(printed: string, hs: string | null): LineMatch | null {
    const tokens = receiptWords(printed)
    const allowed = isHeading(hs) ? headingVariants(hs) : null
    let best: { node: CatalogueNode; score: number } | null = null
    for (const entry of index) {
      const { headings } = entry.node
      if (allowed !== null && headings.length > 0 && !allowed.some((h) => headings.includes(h))) {
        continue
      }
      const scores = entry.words.map((word) => wordScore(word, tokens))
      if (scores.some((score) => score === 0)) continue // every word of the name must be there
      // more words — more specific
      const score =
        scores.reduce((sum, x) => sum + x, 0) / entry.words.length + 0.05 * (entry.words.length - 1)
      if (best === null || score > best.score) best = { node: entry.node, score }
    }
    if (best !== null && best.score >= MATCH_SCORE) {
      return { itemId: refine(best.node, printed).itemId, far: isServiceClass(hs) }
    }
    return byHeading(printed, hs)
  }

  return { match, gloss }
}
