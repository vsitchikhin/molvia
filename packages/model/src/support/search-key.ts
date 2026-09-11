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
  // Ukrainian, so a name carrying these does not leak through untranslated. Belarusian «ў»
  // is deliberately absent: NFD decomposes it to «у» plus a breve and the mark is stripped
  // before this table is consulted, so a row for it could never fire. It lands on `u`,
  // which is also where Latin `Vaukavysk` lands — the shadowing costs nothing here.
  і: 'i',
  ї: 'i',
  є: 'e',
  ґ: 'g',
})

/**
 * Armenian. The first market is Gyumri and Yerevan, so an Armenian label on the shelf is
 * the norm rather than an exception, and the table is what lets an Armenian name be found
 * by a Russian query and by a Latin one alike: «Գյումրի», «Гюмри» and «Gyumri» all become
 * `giumri`.
 *
 * Letters are collapsed on purpose, and by more than the aspirated pairs: պ/փ, կ/ք, տ/թ,
 * ծ/ց, ճ/չ and ռ/ր merge pairwise, ժ/ջ/ձ all give j, խ/հ give h, ե/է/ը give e, ի/յ give i,
 * վ/ւ give v. A Russian speaker does not hear most of these and will not write them in
 * Latin either; this is the same trade as ш/щ both becoming sh.
 */
const ARMENIAN: Readonly<Record<string, string>> = Object.freeze({
  ա: 'a',
  բ: 'b',
  գ: 'g',
  դ: 'd',
  ե: 'e',
  զ: 'z',
  է: 'e',
  ը: 'e',
  թ: 't',
  ժ: 'j',
  ի: 'i',
  լ: 'l',
  խ: 'h',
  ծ: 'c',
  կ: 'k',
  հ: 'h',
  ձ: 'j',
  ղ: 'g',
  ճ: 'ch',
  մ: 'm',
  յ: 'i',
  ն: 'n',
  շ: 'sh',
  ո: 'o',
  չ: 'ch',
  պ: 'p',
  ջ: 'j',
  ռ: 'r',
  ս: 's',
  վ: 'v',
  տ: 't',
  ր: 'r',
  ց: 'c',
  ւ: 'v',
  փ: 'p',
  ք: 'k',
  օ: 'o',
  ֆ: 'f',
})

const LETTERS: Readonly<Record<string, string>> = Object.freeze({ ...CYRILLIC, ...ARMENIAN })

/**
 * One letter written with two code points, so it is resolved before the per-character pass:
 * left to that pass «ու» would come out as `ov` and the word would be unreachable.
 */
const ARMENIAN_DIGRAPHS: readonly (readonly [string, string])[] = Object.freeze([
  ['ու', 'u'],
  ['և', 'ev'],
] as const)

/**
 * A transliteration fork is one letter with two spellings in common use: ж is zh or j,
 * ц is ts or c, х is kh or h, щ is shch or sch. Measured over a corpus of 46 queries:
 * without the fold four of them miss the distance threshold outright, with it none do,
 * at a cost of 0.26 extra candidates per query.
 *
 * It fires on everything the alphabet produced, not only on Latin the person typed. The
 * table hands out multi-letter values, so Cyrillic feeds the fold by itself: `тс` → `ts`
 * → `c`, `сч` → `sch` → `sh`, `кх` → `kh` → `h`, `цк` → `ck` → `k`, `пх` → `ph` → `f`.
 * That is deliberate and useful — «счёт» and «щёт» become one key.
 *
 * The cost is merges across morpheme boundaries. «Советский» loses `цк` twice over and
 * becomes `soveki`; `ц` + `х` gives `ch`, the same as `ч`, so «Ицхак» and «Ичак» are one
 * key; `с` + `х` gives `sh`, the same as `ш`, so «исход» and «ишод» are one key. In a
 * catalogue of product names a false merge costs a candidate and a miss costs the answer,
 * so this is the cheap side of the trade — but it is a trade, not a free win, and none of
 * it says anything about the order being safe. That is what foldToFixedPoint is for.
 */
const LATIN_FOLDS: readonly (readonly [string, string])[] = Object.freeze([
  ['shch', 'sh'],
  ['sch', 'sh'],
  // ղ becomes g, and Latin spells it gh — without this Ghapama and Tsaghkunk each cost an
  // extra edit. Measured: the Russian corpus did not move, 46 of 46 as before.
  ['gh', 'g'],
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
const FORMATTING = /\p{Cf}/gu
const WHITESPACE = /\s+/gu

/**
 * Folding is run to a fixed point, not once. A single pass is not idempotent, and that is
 * not cosmetic: `replaceAll` never re-reads what it just wrote, so a replacement and the
 * character before it can spell the pattern again — `kkh` gives `k` + `h`, which is `kh`
 * all over again. The expanding rules make it worse from the other side: `x → ks` produces
 * the input that `ck → k` has already walked past.
 *
 * It terminates. Every rule either shortens the string or keeps its length, and the
 * length-preserving ones (`q → k`, `w → v`, `y → i`, `qu → kv`) produce nothing any rule
 * matches, so they fire at most once. After that each pass strictly shortens or changes
 * nothing. Four passes cover every input reachable from these tables — the enumeration test
 * is what holds that claim, so a new rule needing a fifth turns it red instead of quietly
 * returning a string that is not a fixed point.
 */
const FOLD_PASSES = 4

function foldToFixedPoint(text: string): string {
  let folded = text
  for (let pass = 0; pass < FOLD_PASSES; pass += 1) {
    const before = folded
    for (const [from, to] of LATIN_FOLDS) {
      folded = folded.replaceAll(from, to)
    }
    folded = folded.replace(DOUBLED, '$1')
    if (folded === before) break
  }
  return folded
}

/**
 * Runs over both ends of the wire: the name on write and the query on read. There cannot be
 * two functions — the key is compared against itself, and any drift between the two would
 * be a silent search miss that no test of either side alone would catch.
 *
 * A character the table does not know keeps itself, lowercased and stripped of marks.
 * Dropping it instead would be worse: a name written entirely in an unknown script would
 * produce an empty key. The flip side is that such a name is then reachable only from its
 * own script — `ბორჯომი` is 7 away from `borjomi`, well past any threshold.
 *
 * **The key is empty for input that carries nothing but separators**, and that is on
 * purpose: the function cannot invent content. What keeps an unbuildable item out of the
 * server is the order of two calls — `visibleLine` refuses such a name first. Every caller
 * that writes an item has to validate the name before taking its key.
 */
export function toSearchKey(text: string): string {
  const plain = text.toLowerCase().normalize('NFD').replace(MARK, '')

  let joined = plain
  for (const [from, to] of ARMENIAN_DIGRAPHS) {
    joined = joined.replaceAll(from, to)
  }

  let mapped = ''
  for (const char of joined) {
    mapped += LETTERS[char] ?? (LETTER_OR_DIGIT.test(char) ? char : ' ')
  }

  const key = foldToFixedPoint(mapped).trim().replace(SPACES, ' ')
  if (key !== '') return key

  // Nothing survived: the name was punctuation only, which `visibleLine` lets through.
  // The fallback still goes through the same tidying as the main path — otherwise this one
  // key in the whole catalogue would carry zero-width characters and uncollapsed runs of
  // whitespace, and sit in the column under different rules than every row beside it.
  return plain.replace(FORMATTING, '').replace(WHITESPACE, ' ').trim()
}
