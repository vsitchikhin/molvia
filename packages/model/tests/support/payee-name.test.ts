import { describe, expect, it } from 'vitest'
import {
  payeeWords,
  payeeWordsNear,
  sameSeller,
  sellerWords,
  wordsShare,
} from '#model/support/payee-name'

/** The share as the rule reads it: a record's seller words a line's have. */
const share = (payee: string, name: string) => wordsShare(sellerWords(payee), sellerWords(name))

describe('payeeWords', () => {
  it('folds Cyrillic, Armenian and Georgian to the bank’s Latin', () => {
    expect(payeeWords('Ереван Сити')).toEqual(payeeWords('YEREVAN CITY'))
    expect(payeeWords('Երևան Սիթի')).toEqual(['erevan', 'siti'])
    expect(payeeWords('თავისუფლება')).toEqual(payeeWords('TAVISUPLEBA'))
  })

  it('folds Serbian in both scripts, «x» as «ks», and takes any other mark off (review №3)', () => {
    expect(payeeWords('MAXI ŠABAC')).toEqual(['maksi', 'shabak'])
    expect(payeeWords('Čačak')).toEqual(payeeWords('Чачак'))
    expect(payeeWords('Đurđevak Ćuprija Džep')).toEqual(payeeWords('Ђурђевак Ћуприја Џеп'))
    expect(payeeWords('Љиљана Њива')).toEqual(payeeWords('Ljiljana Njiva'))
    expect(payeeWords('CAFÉ')).toEqual(['kafe'])
    expect(payeeWords('TAXI')).toEqual(payeeWords('Такси'))
  })

  it('drops words under three letters: a country’s code, a terminal’s number', () => {
    expect(payeeWords('Ք: YEREVAN CITY AVAN YEREVAN AM 19')).toEqual([
      'erevan',
      'siti',
      'avan',
      'erevan',
    ])
  })
})

describe('payeeWordsNear', () => {
  it('lets one edit under six letters and two from six', () => {
    expect(payeeWordsNear('bolt', 'bold')).toBe(true)
    expect(payeeWordsNear('bolt', 'belk')).toBe(false)
    expect(payeeWordsNear('moskva', 'moskow')).toBe(true)
  })
})

describe('wordsShare', () => {
  it('is the share of the record’s words the payee has', () => {
    expect(share('YANDEX.GO YEREVAN', 'Yandex Taxi')).toBe(0.5)
    expect(share('YANDEX.GO YEREVAN', 'Yandex Go')).toBe(1)
    expect(share('Ք: YEREVAN CITY AVAN YEREVAN AM 19', 'Ереван Сити')).toBe(1)
    expect(share('NATALI FARM', 'Такси наличными')).toBe(0)
    expect(share('MAXI ŠABAC', 'Макси Шабац')).toBe(1)
  })

  it('leaves a city in the record’s name aside: it would meet every line of the city (adversarial А6)', () => {
    expect(share('Ք: SAS SUPERMARKET YEREVAN AM', 'Ереван Сити')).toBe(0)
    expect(share('YANDEX.GO YEREVAN', 'Гюмри')).toBe(0)
  })

  it('keeps a name that is nothing but a city’s word: none would be met by any line (adversarial А10)', () => {
    expect(sellerWords('Казан')).toEqual(['kasan'])
    expect(share('Ք: SAS SUPERMARKET YEREVAN AM', 'Казан')).toBe(0)
    expect(share('Ք: SAS SUPERMARKET YEREVAN AM', 'Ереван')).toBe(0)
    // The price, named: the line's city is aside too, so the cinema meets its own line in no word — a
    // doubt «другое имя», a tap; met by the city, «Ереван» would take every line of Yerevan silently.
    expect(share('KINOTEATR MOSKVA', 'Москва')).toBe(0)
  })

  it('is 0 for a record with no words', () => {
    expect(share('VEGA', '')).toBe(0)
  })
})

describe('sellerWords and sameSeller', () => {
  it('leave the places aside — exact under six letters, «SAS» is no «Сад»', () => {
    expect(sellerWords('Ереван Сити')).toEqual(['siti'])
    expect(sellerWords('SAS Нови-Сад')).toEqual(['sas'])
    expect(sellerWords('MOSCOW Store')).toEqual(['store'])
  })

  it('take one seller for every word of one name in the other, never one common word', () => {
    expect(sameSeller('AM\\YEREVAN\\ZOVQ BAR', 'ZOVQ BAR GYUMRI')).toBe(true)
    expect(sameSeller('SAS SUPERMARKET', 'YEREVAN CITY SUPERMARKET')).toBe(false)
  })
})
