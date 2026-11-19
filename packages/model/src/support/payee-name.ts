import { levenshtein } from '#model/support/edits'

// A payee's name as a bank prints it, folded so that the person's own words for the same seller meet it
// (MOL-409, А4): «YEREVAN CITY» and «Ереван Сити», «Երևան Սիթի», «TAVISUPLEBA» and «თავისუფლება». Not
// `toSearchKey`: its tables are frozen under the catalogue's stored keys and fold for search, and the two
// names above share not one word there (А4б). The sounds folded here are the ones banks and people spell
// apart — c/ц/s, z, y/i, ye-, a doubled letter.

const CYRILLIC: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
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
}

// «Ե» opening a word is «ye», «ու» is «u» — resolved before the letters (Б3).
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
    .replace(/[а-яё]/g, (ch) => CYRILLIC[ch] ?? '')
    .replace(/(^|[^ա-և])ե/g, '$1ye')
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
        .replace(/[yj]/g, 'i')
        .replace(/(.)\1+/g, '$1'),
    )
    .filter((word) => word.length >= 3)
}

/** Two folded words are one: one edit apart, two from six letters. */
export function payeeWordsNear(a: string, b: string): boolean {
  return levenshtein(a, b) <= (Math.min(a.length, b.length) >= 6 ? 2 : 1)
}

/**
 * The share of a record's name words the payee has: a city in the bank's line («YANDEX.GO YEREVAN»)
 * does not outweigh the name. A record with no name words is 0.
 */
export function payeeNameShare(payee: string, name: string): number {
  const ours = payeeWords(payee)
  const theirs = payeeWords(name)
  if (theirs.length === 0) return 0
  return theirs.filter((v) => ours.some((w) => payeeWordsNear(w, v))).length / theirs.length
}
