import { COUNTRY_CITIES } from '#model/contracts/settings'
import { levenshtein } from '#model/support/edits'

// A payee's name as a bank prints it, folded so that the person's own words for the same seller meet it
// (MOL-409, А4): «YEREVAN CITY» and «Ереван Сити», «Երևան Սիթի», «TAVISUPLEBA» and «თავისუფლება»,
// «MAXI ŠABAC» and «Макси Шабац». Not `toSearchKey`: its tables are frozen under the catalogue's stored
// keys and fold for search, and the two names above share not one word there (А4б). The sounds folded
// here are the ones banks and people spell apart — c/ц/s, z, x/ks, y/i, ye-, a doubled letter.

const CYRILLIC: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
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
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sh',
  ъ: '',
  ы: 'i',
  ь: '',
  э: 'e',
  ю: 'iu',
  я: 'ia',
  // Serbian (review №3): Serbia is a country of the settings, its banks print either script.
  ђ: 'dj',
  ј: 'j',
  љ: 'lj',
  њ: 'nj',
  ћ: 'ch',
  џ: 'dzh',
}

/** Serbian Latin as its Cyrillic reads (review №3); any other mark is taken off — «CAFÉ» is «CAFE». */
const LATIN: Readonly<Record<string, string>> = {
  č: 'ch',
  ć: 'ch',
  š: 'sh',
  ž: 'zh',
  đ: 'dj',
}

// «ու» is «u» — resolved before the letters (Б3). «Ե» opening a word is «e», as the bank's «YE-» folds.
const ARMENIAN: Readonly<Record<string, string>> = {
  ա: 'a',
  բ: 'b',
  գ: 'g',
  դ: 'd',
  ե: 'e',
  զ: 'z',
  է: 'e',
  ը: 'e',
  թ: 't',
  ժ: 'zh',
  ի: 'i',
  լ: 'l',
  խ: 'kh',
  ծ: 'ts',
  կ: 'k',
  հ: 'h',
  ձ: 'dz',
  ղ: 'gh',
  ճ: 'ch',
  մ: 'm',
  յ: 'y',
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
  ց: 'ts',
  ւ: 'v',
  փ: 'p',
  ք: 'k',
  օ: 'o',
  ֆ: 'f',
  և: 'ev',
}

const GEORGIAN: Readonly<Record<string, string>> = {
  ა: 'a',
  ბ: 'b',
  გ: 'g',
  დ: 'd',
  ე: 'e',
  ვ: 'v',
  ზ: 'z',
  თ: 't',
  ი: 'i',
  კ: 'k',
  ლ: 'l',
  მ: 'm',
  ნ: 'n',
  ო: 'o',
  პ: 'p',
  ჟ: 'zh',
  რ: 'r',
  ს: 's',
  ტ: 't',
  უ: 'u',
  ფ: 'p',
  ქ: 'k',
  ღ: 'gh',
  ყ: 'k',
  შ: 'sh',
  ჩ: 'ch',
  ც: 'ts',
  ძ: 'dz',
  წ: 'ts',
  ჭ: 'ch',
  ხ: 'kh',
  ჯ: 'j',
  ჰ: 'h',
}

/** The words of a name, folded; words under three letters — «AM», «GE», «19» — say nothing. */
export function payeeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[čćšžđ]/g, (ch) => LATIN[ch] ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[а-яђјљњћџ]/g, (ch) => CYRILLIC[ch] ?? '')
    .replace(/ու/g, 'u')
    .replace(/[ա-և]/g, (ch) => ARMENIAN[ch] ?? '')
    .replace(/[ა-ჰ]/g, (ch) => GEORGIAN[ch] ?? '')
    .split(/[^a-z]+/)
    .map((word) =>
      word
        .replace(/^ye/, 'e')
        .replace(/ts/g, 's')
        .replace(/c(?=[eiy])/g, 's')
        .replace(/c/g, 'k')
        .replace(/z/g, 's')
        .replace(/x/g, 'ks')
        .replace(/[yj]/g, 'i')
        .replace(/(.)\1+/g, '$1'),
    )
    .filter((word) => word.length >= 3)
}

/**
 * Two folded words are one: one edit apart, two from six letters. Words further apart in length than that
 * never are, and are not measured (adversarial А24).
 */
export function payeeWordsNear(a: string, b: string): boolean {
  if (a === b) return true
  const edits = Math.min(a.length, b.length) >= 6 ? 2 : 1
  return Math.abs(a.length - b.length) <= edits && levenshtein(a, b) <= edits
}

/** The words of a city of the settings, folded: «Москва» is «MOSCOW», «Ереван» is «YEREVAN» (Р-4). */
const CITY_WORDS: ReadonlySet<string> = new Set(
  Object.values(COUNTRY_CITIES).flatMap((cities) => cities.flatMap((city) => payeeWords(city))),
)

/** Those of six letters and more, the only ones a word may meet within edits. */
const LONG_CITY_WORDS: readonly string[] = [...CITY_WORDS].filter((city) => city.length >= 6)

/**
 * A word the bank's format puts in every card line of a city — «…\AM\YEREVAN\…» — which says nothing of
 * the seller (М1). Exact under six letters, «SAS» is no «Сад»; from six, as any word. Two words further
 * apart in length than two edits never meet: they are not compared (review №1).
 */
function isPlaceWord(word: string): boolean {
  if (CITY_WORDS.has(word)) return true
  if (word.length < 6) return false
  return LONG_CITY_WORDS.some(
    (city) => Math.abs(city.length - word.length) <= 2 && payeeWordsNear(city, word),
  )
}

/**
 * What a bank prints for a payment where it names no seller — Ardshin's screen shows «Безналичная оплата»
 * for every card line (MOL-409) — folded: no seller's words (adversarial А15).
 */
const BANK_WORDS: ReadonlySet<string> = new Set(
  payeeWords('безналичная оплата покупка платёж payment purchase'),
)

/**
 * The words of a seller's name in a record, folded, the place's aside: «Ереван Сити» is «siti», since every
 * card line of Yerevan prints «YEREVAN» and the city would meet them all (adversarial А6). A name that is
 * nothing but a city's word — the restaurant «Казан», the cinema «Москва» — keeps it: with none it would be
 * no name, and met by any line (А10). A note «Покупка» is the person's word, and names the record (А17).
 */
export function sellerWords(text: string): string[] {
  return sellerOf(payeeWords(text))
}

/**
 * The words of a seller's name in a bank's line: as a record's (`sellerWords`), and the bank's own words
 * aside — «Безналичная оплата» names no seller (adversarial А15, review №25).
 */
export function bankSellerWords(payee: string): string[] {
  return sellerOf(payeeWords(payee).filter((word) => !BANK_WORDS.has(word)))
}

/**
 * The words of a seller's name a rule reads at most (adversarial А24): a name is a few words, and each is
 * weighed against each of the other name's. **The price, named:** a note listing a whole basket is read by
 * its first eight, each by its first twenty letters.
 */
export const SELLER_WORDS_MAX = 8

/** The letters of a seller's word a rule reads at most (А24): a longer one is cut — no seller's word is. */
export const SELLER_WORD_LETTERS = 20

function sellerOf(words: string[]): string[] {
  const seller = words.filter((word) => !isPlaceWord(word))
  return (seller.length > 0 ? seller : words)
    .slice(0, SELLER_WORDS_MAX)
    .map((word) => word.slice(0, SELLER_WORD_LETTERS))
}

/**
 * The share of a record's seller words a line's seller words have (`bankSellerWords`, `sellerWords`):
 * «YANDEX.GO YEREVAN» against «Yandex Taxi» is a half. A record with no words is 0.
 */
export function wordsShare(payee: readonly string[], seller: readonly string[]): number {
  if (seller.length === 0) return 0
  return seller.filter((v) => payee.some((w) => payeeWordsNear(w, v))).length / seller.length
}

/**
 * One seller in two bank lines, or a line and a record (В3, Г4), by their seller words — a bank's line's
 * by `bankSellerWords` (review №25): every word of one name is the other's (Н1: one shared word —
 * «SUPERMARKET», «PIZZA» — is no seller), and a name of none meets nothing.
 */
export function sameSeller(a: readonly string[], b: readonly string[]): boolean {
  const within = (xs: readonly string[], ys: readonly string[]) =>
    xs.length > 0 && xs.every((x) => ys.some((y) => payeeWordsNear(x, y)))
  return within(a, b) || within(b, a)
}
