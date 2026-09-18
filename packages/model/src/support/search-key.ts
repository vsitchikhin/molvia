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
  ц: 'ц',
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
  ծ: 'ц',
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
  ց: 'ц',
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
 * ц is ts or c, х is kh or h, щ is shch or sch. ц is a letter of its own in the key, `ц`,
 * since MOL-11: both `ts` and a soft Latin c land on it (see SOFT_C). Measured over a corpus of 46 queries:
 * without the fold four of them miss the distance threshold outright, with it none do,
 * at a cost of 0.26 extra candidates per query.
 *
 * It fires on everything the alphabet produced, not only on Latin the person typed. The
 * table hands out multi-letter values, so Cyrillic feeds the fold by itself: `тс` → `ts`
 * → `ц`, `сч` → `sch` → `sh`, `кх` → `kh` → `h`, `пх` → `ph` → `f`.
 * That is deliberate and useful — «счёт» and «щёт» become one key.
 *
 * The cost is merges across morpheme boundaries. «Советский» becomes `soveцki` — `тс` is
 * read as ц; `с` + `х` gives `sh`, the same as `ш`, so «исход» and «ишод» are one key. In a
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
  ['ts', 'ц'],
  ['ck', 'k'],
  ['ph', 'f'],
  ['qu', 'kv'],
  ['x', 'ks'],
  ['q', 'k'],
  ['w', 'v'],
  ['y', 'i'],
] as const)

/**
 * The к/c fork, closed by position rather than by folding the letter. Latin c is two
 * letters: soft before `e`, `i` and the diphthong `ae` — that is ц, in transliteration
 * (`cena`) and in Latin itself (`Caesar`) — and `k` everywhere else: `Coca-Cola`, `Nescafe`,
 * `Picnic`, `Tic Tac`. `ch` is ч and is left alone. `y` needs no place in the lookahead:
 * the fold has already made it `i`.
 *
 * Only Latin c is decided here. ц, ծ, ց and `ts` are the letter `ц` from the start, so
 * their spelling does not depend on the letter after them. The first version of this rule
 * hardened every c, whatever produced it, and a case ending or the next keystroke flipped
 * ц: «куриц» stopped being the start of «курицы», «огурцов» fell out of the budget,
 * «Пиццерия» split from «Пицерия» — found by the MOL-11 adversarial review. The key is no
 * longer Latin only; pg_trgm reads `ц` as a letter like any other.
 *
 * Doubling is collapsed before the decision, or `cc` before a soft vowel becomes `kц`.
 *
 * The price is a Russian word typed with c for ц in a hard position: `otec`, `cukaty` cost
 * an edit each, `jajca` left the MOL-5 corpus. `ts` spellings are untouched. Measured in
 * MOL-11: Coca-Cola against «Кока-Кола» went from 2, the whole budget, to 0.
 *
 * Frozen like the tables above, and it changed them without a recompute only because no key
 * was stored yet: production was not deployed and no copy held a real catalogue. The next
 * change to it is a migration.
 */
const SOFT_C = /c(?=[ei]|ae)/g
const HARD_C = /c(?!h)/g

const MARK = /\p{M}/gu
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u
// Doubling is a spelling fork of its own: «Анна», «Anna» and «Ана» are one name.
const DOUBLED = /(\p{L})\1+/gu
const SPACES = / +/g
const WHITESPACE = /\s+/gu

/**
 * Exactly what `visibleLine` calls blank before it asks whether anything is left. The two
 * definitions of «content» have to be the same one, and they were not: four Hangul fillers
 * — U+115F, U+1160, U+3164, U+FFA0 — are letters *and* default-ignorable, so «ㅤ!» passed
 * `visibleLine` as a name while its key came out as the filler alone, which the very same
 * `visibleLine` then refused. That is an item the server cannot parse back after building
 * it — the failure this whole fallback exists to prevent, arriving through the front door.
 */
const IGNORABLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}⠀]/gu

/**
 * Folding runs to a fixed point, and the loop has no ceiling on purpose. A single pass is
 * not idempotent: `replaceAll` never re-reads what it just wrote, so a replacement and the
 * character before it can spell the pattern again — `kkh` gives `k` + `h`, which is `kh`
 * all over again. Overlapping runs need one pass each: `с` + six `ч` gives `s` + `chchchch`,
 * and `shch → sh` can only take one bite per pass. The depth grows with the length of the
 * name, so no constant is the right constant — a ceiling would return a string that is not
 * a fixed point, silently, which is the original defect one size up.
 *
 * It terminates, and the argument is this. `x → ks` is the only rule that lengthens, and
 * nothing produces `x`, so it fires at most once per `x` in the input; the same holds for
 * the length-preserving `q → k`, `w → v`, `y → i` and `qu → kv`, since nothing produces
 * `q`, `w` or `y` either. After the first pass the string therefore never grows, and every
 * pass that changes it either makes it shorter or, keeping the length, leaves fewer `c` in
 * it: SOFT_C and HARD_C turn each into `ц` or `k`, and no rule writes a `c`. A pair of
 * finite counts bounds a decreasing sequence.
 *
 * **A new rule must not produce its own left-hand side**, or this loop stops terminating.
 * The property test that runs one more pass over adversarial inputs is what stands behind
 * the claim; the three-character enumeration on its own never could, because a fixed point
 * needs five characters to fail.
 */
function foldToFixedPoint(text: string): string {
  let folded = text
  for (;;) {
    const before = folded
    for (const [from, to] of LATIN_FOLDS) {
      folded = folded.replaceAll(from, to)
    }
    folded = folded.replace(DOUBLED, '$1')
    folded = folded.replace(SOFT_C, 'ц')
    folded = folded.replace(HARD_C, 'k')
    if (folded === before) return folded
  }
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
  const plain = text.toLowerCase().normalize('NFD').replace(MARK, '').replace(IGNORABLE, '')

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
  // key in the whole catalogue would carry uncollapsed runs of whitespace and sit in the
  // column under different rules than every row beside it.
  return plain.replace(WHITESPACE, ' ').trim()
}

/**
 * Exported for exactly one reason: the tables are frozen, so an edit to them is a migration
 * with a recompute, and the test that holds them has to walk the real keys instead of a list
 * copied beside it. With a copied list a row *added* to the source is invisible — only a
 * changed or deleted one shows. Nothing in the applications reads this.
 */
export const SEARCH_KEY_TABLES = Object.freeze({
  cyrillic: CYRILLIC,
  armenian: ARMENIAN,
  latinFolds: LATIN_FOLDS,
  armenianDigraphs: ARMENIAN_DIGRAPHS,
})

/**
 * What makes two names the same item when one is proposed: case, spacing and what cannot be
 * seen aside, nothing else. Deliberately narrower than `toSearchKey`, which folds scripts,
 * forks and punctuation so that a search finds more — «Milo» and «Мыло» share a key, and a
 * false merge that costs the search a candidate would cost «Предложить товар» the item itself.
 * «3.2%» and «3,2%» stay two names here; merging what is merely similar is 0.2's.
 *
 * **Two names with the same identity always have the same key**, and `createUnlessNamed`
 * rests on it: it locks and looks up by key, then compares identities. So this is built from
 * the key's own first steps rather than beside them — the same lowercasing, the same set of
 * invisible characters dropped rather than read as a space (a byte-order mark inside a name
 * glues its words in the key, and has to glue them here too), dropped *before* composing, so
 * that a letter and its mark with an invisible character between them still compose into one.
 *
 * Armenian «և», «եւ» and «եվ» are one name (the owner, MOL-12): three spellings of one sound,
 * and «և» has no capital of its own — `toUpperCase` writes «ԵՒ», a label may write «ԵՎ», and
 * «Երեւան» is common beside «Երևան». Only the pair «եւ» folds, never a lone «ւ», which would
 * break «ու». The key already gives all three `ev`.
 *
 * Two property tests hold this: one identity is always one key, and case never changes the
 * identity. A change to either function has to keep both green.
 */
export function nameIdentity(name: string): string {
  return name
    .toLowerCase()
    .replace(IGNORABLE, '')
    .normalize('NFC')
    .replaceAll('և', 'եվ')
    .replaceAll('եւ', 'եվ')
    .replace(WHITESPACE, ' ')
    .trim()
}
