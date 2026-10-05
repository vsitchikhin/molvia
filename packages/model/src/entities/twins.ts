// MOL-106 — when two names in the catalogue are one thing written twice. The nightly merge rests on
// this: a pair merges by itself only if every size is the same and the words are near by spelling and
// by meaning; anything less is a candidate the owner looks at. A false merge pours the ratings of two
// things into one — «Milo» and «Мыло», «Молоко 1 л» and «Молоко 2 л» — and is worse than a missed one.

import { levenshtein } from '#model/support/edits'
import { toSearchKey } from '#model/support/search-key'

/**
 * Units as a label writes them after a number, each to one name: «1л», «1 л» and «1 l» are one size,
 * «500 г» and «500 гр» too. Keyed by `toSearchKey`, so the scripts fold by themselves. A unit missing
 * here is read as a word after a number — two names that spell the same size two ways then differ by
 * a word and are a candidate, never a merge: the list errs towards the owner's eyes.
 */
const UNITS: Readonly<Record<string, readonly string[]>> = {
  l: ['л', 'литр', 'литра', 'литров', 'l', 'lt', 'լ'],
  ml: ['мл', 'ml', 'մլ'],
  kg: ['кг', 'kg', 'կգ'],
  g: ['г', 'гр', 'грамм', 'g', 'gr', 'գ', 'գր'],
  mg: ['мг', 'mg'],
  piece: ['шт', 'штук', 'штуки', 'штука', 'pcs', 'pc', 'հատ'],
  cm: ['см', 'cm', 'սմ'],
  m: ['м', 'm'],
  pack: ['уп', 'упак', 'пак', 'pack', 'pk', 'տուփ'],
  roll: ['рулон', 'рулона', 'рулонов'],
  bag: ['пакетик', 'пакетика', 'пакетиков'],
  tablet: ['таблеток', 'табл'],
  capsule: ['капсул'],
  watt: ['вт', 'w'],
}

const UNIT_OF: ReadonlyMap<string, string> = new Map(
  Object.entries(UNITS).flatMap(([unit, spellings]) =>
    spellings.map((spelling) => [toSearchKey(spelling), unit] as const),
  ),
)

/** A number, its fraction after a point or a comma, and what stands right after it — a sign or a word. */
const SIZE = /(\d+(?:[.,]\d+)?)(\s*)(%|[\p{L}]+)?/gu

/** Below this many letters a word must be the same: «SAS» and «SOS» are two shops one edit apart. */
const SHORT_WORD = 4

/** Past this many words a name is not compared at all — the matching is tried word against word. */
const MAX_WORDS = 12

/** «3,2» and «3.20» are one number, «05» is five. */
function plainNumber(digits: string): string {
  const [whole = '', fraction = ''] = digits.replace(',', '.').split('.')
  const wholePart = whole.replace(/^0+(?=\d)/u, '')
  const fractionPart = fraction.replace(/0+$/u, '')
  return fractionPart === '' ? wholePart : `${wholePart}.${fractionPart}`
}

/** What a name says about size, and what is left of it in words. */
export interface NameParts {
  /** Every number with its unit, `3.2 %`, `1 l`, `10` — sorted, so the order of a label does not matter. */
  readonly sizes: readonly string[]
  /** The words with every size taken out, as `toSearchKey` spells them. */
  readonly words: readonly string[]
}

export function nameParts(name: string): NameParts {
  const sizes: string[] = []
  const rest = name
    .normalize('NFC')
    .replace(SIZE, (_whole, digits: string, gap: string, after?: string) => {
      const number = plainNumber(digits)
      if (after === '%') {
        sizes.push(`${number} %`)
        return ' '
      }
      const unit = after === undefined ? undefined : UNIT_OF.get(toSearchKey(after))
      if (unit !== undefined) {
        sizes.push(`${number} ${unit}`)
        return ' '
      }
      sizes.push(number)
      // A word glued to the number that is not a unit is still a word: «7Up», «С0» keeps its «С».
      return ` ${gap}${after ?? ''}`
    })
  const key = toSearchKey(rest)
  return {
    sizes: sizes.sort(),
    words: key === '' ? [] : key.split(' ').filter((word) => !/^\d+$/u.test(word)),
  }
}

/** Every size the same, with its unit: «Молоко 1 л» and «Молоко 2 л» never are one thing. */
export function sameSizes(a: NameParts, b: NameParts): boolean {
  return a.sizes.length === b.sizes.length && a.sizes.every((size, i) => size === b.sizes[i])
}

/** How far two names stand by spelling, word matched to word in whatever order. */
export interface Spelling {
  /** Edits over all the words. */
  readonly edits: number
  /** Edits in the word that needs the most. */
  readonly worst: number
}

/**
 * The spelling of two names whose sizes are the same, or null when they cannot be one thing by their
 * spelling: another size, another number of words — «Сыр чанах Ашхар» is a brand of «Сыр чанах» — or a
 * short word that differs. Words are matched one to one in whichever order costs fewest edits:
 * «Чанах сыр» is «Сыр чанах».
 */
export function twinSpelling(a: NameParts, b: NameParts): Spelling | null {
  if (!sameSizes(a, b)) return null
  const n = a.words.length
  if (n === 0 || n !== b.words.length || n > MAX_WORDS) return null

  const cost = a.words.map((x) =>
    b.words.map((y) => {
      if (x === y) return 0
      if (Array.from(x).length < SHORT_WORD || Array.from(y).length < SHORT_WORD) return Infinity
      return levenshtein(x, y)
    }),
  )

  // The cheapest one-to-one matching: for the first i words of `a`, which words of `b` they took.
  const full = (1 << n) - 1
  const best = new Map<number, Spelling>([[0, { edits: 0, worst: 0 }]])
  for (let mask = 0; mask < full; mask++) {
    const here = best.get(mask)
    if (here === undefined) continue
    const i = bitCount(mask)
    for (let j = 0; j < n; j++) {
      if (mask & (1 << j)) continue
      const step = cost[i]?.[j] ?? Infinity
      if (step === Infinity) continue
      const next = { edits: here.edits + step, worst: Math.max(here.worst, step) }
      const was = best.get(mask | (1 << j))
      if (
        was === undefined ||
        next.edits < was.edits ||
        (next.edits === was.edits && next.worst < was.worst)
      ) {
        best.set(mask | (1 << j), next)
      }
    }
  }
  return best.get(full) ?? null
}

function bitCount(mask: number): number {
  let count = 0
  for (let rest = mask; rest !== 0; rest &= rest - 1) count++
  return count
}

/**
 * Merged by itself: one edit a word, two a name, and a meaning at least this close. Measured on the
 * seed (MOL-106, `.scratch/tasks/status/MOL-106-measure.md`): of its 178 000 pairs not one merges, the
 * nearest one edit apart being «Курица» and «Корица» at 0.856; two edits a word let in «Хлеб» and
 * «Хлебцы» at 0.937. What it takes: a fat with a comma or a point, «ё», the order of words, half of
 * the typos. **A name in another script is not taken**: the model reads a transliteration by its
 * letters, «Moloko» against «Молоко» is 0.69 at the median — as far as «Milo» from «Мыло», 0.48 — so
 * one key in two scripts is always a candidate, never a merge.
 */
export const TWIN_MERGE = Object.freeze({ worst: 1, edits: 2, meaning: 0.9 })

/** Named to the owner: two edits a word, and a meaning this close or one key in two scripts. */
export const TWIN_CANDIDATE = Object.freeze({ worst: 2, meaning: 0.8 })

/** What the night does with a pair: merges it, names it to the owner, or leaves it. */
export type TwinVerdict = 'merge' | 'candidate' | 'apart'

export interface TwinPair {
  readonly spelling: Spelling | null
  /** The unit a price is compared by — a kilo of bread is not a loaf. Always true for places. */
  readonly sameUnit: boolean
  /** The cosine of the two names' vectors; null when either has none, and then nothing merges. */
  readonly meaning: number | null
}

export function twinVerdict({ spelling, sameUnit, meaning }: TwinPair): TwinVerdict {
  if (spelling === null || spelling.worst > TWIN_CANDIDATE.worst) return 'apart'
  if (
    sameUnit &&
    meaning !== null &&
    spelling.worst <= TWIN_MERGE.worst &&
    spelling.edits <= TWIN_MERGE.edits &&
    meaning >= TWIN_MERGE.meaning
  ) {
    return 'merge'
  }
  if (spelling.edits === 0 || (meaning ?? 0) >= TWIN_CANDIDATE.meaning) return 'candidate'
  return 'apart'
}
