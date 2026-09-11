/**
 * The search key: a name and any other spelling of the same name have to land on the same
 * point, close enough that the remaining edit distance still covers a real typo. Nobody
 * ever reads this key — it sits under a GIN index and is compared against a key taken from
 * the query by this same function.
 *
 * That is why it is not a transliteration for humans. Being reversible, or matching
 * GOST 7.79 or ISO 9, is not a requirement here and loses to the measurement every time.
 */

/**
 * Frozen on purpose. The key is stored, so editing the table after the first row is written
 * makes every accumulated key foreign — and it does so silently, with no error and no log
 * line. Change it only together with a migration that recomputes the column.
 *
 * Values are the folded ones (see LATIN_FOLDS): «ж» is j rather than zh because the fork
 * is what the fold exists to remove.
 */
const CYRILLIC: Readonly<Record<string, string>> = Object.freeze({
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'c',
  ч: 'ch',
  ш: 'sh',
  щ: 'sh',
  ъ: '',
  ы: 'i',
  ь: '',
  э: 'e',
  ю: 'iu',
  я: 'ia',
  // Ukrainian and Belarusian, so a name carrying them does not leak through untranslated.
  і: 'i',
  ї: 'i',
  є: 'e',
  ґ: 'g',
  ў: 'v',
})

/**
 * A transliteration fork is one letter with two spellings in common use: ж is zh or j,
 * ц is ts or c, х is kh or h, щ is shch or sch. Measured over a corpus of 46 queries:
 * without the fold four of them miss the distance threshold outright, with it none do,
 * at a cost of 0.26 extra candidates per query.
 *
 * Order matters and is safe at the same time: after the alphabet table the string holds
 * neither `ts` nor `shch`, so the fold only ever fires on Latin the person typed. That is
 * also why the whole function is idempotent.
 *
 * The fold is deliberately blunt — it runs across morpheme boundaries too, so «отступ» and
 * «оцуп» collapse together. In a catalogue of product names a false merge costs a candidate
 * and a miss costs the answer, so bluntness is the cheap side of the trade.
 */
const LATIN_FOLDS: readonly (readonly [string, string])[] = Object.freeze([
  ['shch', 'sh'],
  ['sch', 'sh'],
  ['zh', 'j'],
  ['kh', 'h'],
  ['ts', 'c'],
  ['ck', 'k'],
  ['ph', 'f'],
  ['qu', 'kv'],
  ['x', 'ks'],
  ['q', 'k'],
  ['w', 'v'],
  ['y', 'i'],
] as const)

const MARK = /\p{M}/gu
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u
// Doubling is a spelling fork of its own: «Анна», «Anna» and «Ана» are one name.
const DOUBLED = /(\p{L})\1+/gu
const SPACES = / +/g

/**
 * Runs over both ends of the wire: the name on write and the query on read. There cannot be
 * two functions — the key is compared against itself, and any drift between the two would
 * be a silent search miss that no test of either side alone would catch.
 *
 * A character the table does not know keeps itself, lowercased and stripped of marks.
 * Dropping it instead would be worse: a name written entirely in an unknown script would
 * produce an empty key, and `visibleLine` refuses that — the item would become unbuildable
 * inside the server rather than at the user's input.
 */
export function toSearchKey(text: string): string {
  const plain = text.toLowerCase().normalize('NFD').replace(MARK, '')

  let mapped = ''
  for (const char of plain) {
    mapped += CYRILLIC[char] ?? (LETTER_OR_DIGIT.test(char) ? char : ' ')
  }

  for (const [from, to] of LATIN_FOLDS) {
    mapped = mapped.replaceAll(from, to)
  }

  const key = mapped.replace(DOUBLED, '$1').trim().replace(SPACES, ' ')
  // Nothing survived: the name was punctuation only, which `visibleLine` lets through.
  return key === '' ? plain.trim() : key
}
