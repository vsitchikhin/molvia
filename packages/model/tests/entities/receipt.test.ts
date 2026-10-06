import { describe, expect, it } from 'vitest'
import {
  tellsQuietly,
  moneyOfHundredths,
  needsReshoot,
  withoutItems,
  receiptDateOf,
  STORE_MEMORY_KEY_MAX_OCTETS,
  receiptCityOf,
  receiptLineOf,
  receiptMomentOf,
  receiptClockOf,
  storeMemoryWords,
  receiptTimeOf,
} from '#model/entities/receipt'
import type { ReceiptText, ReceiptTextLine } from '#model/entities/receipt-text'

const line = (over: Partial<ReceiptTextLine> = {}): ReceiptTextLine => ({
  printed: 'Կաթ',
  hs: '0401',
  sku: '1163909',
  quantityMilli: 1_000,
  unit: 'piece',
  priceHundredths: 37_000,
  sumHundredths: 37_000,
  discountHundredths: 0,
  settled: true,
  rows: [],
  ...over,
})

const receipt = (lines: ReceiptTextLine[], totalHundredths: number | null = null): ReceiptText => ({
  layout: 'card',
  tin: null,
  date: null,
  time: null,
  receiptNo: null,
  totalHundredths,
  balanced: false,
  lines,
})

describe('«переснимите» — not one line found (MOL-222, В-1)', () => {
  it('asks for a new shot when no item line was read, the total read or not', () => {
    expect(needsReshoot(receipt([], 100_000))).toBe(true)
    expect(needsReshoot(receipt([]))).toBe(true)
  })

  it('must not fire on one line, however little of the total it makes up (am-06: 14 lines, 2 add up)', () => {
    expect(needsReshoot(receipt([line({ sumHundredths: 1_000 })], 1_000_000))).toBe(false)
    expect(needsReshoot(receipt([line({ settled: false }), line({ settled: false })]))).toBe(false)
  })
})

describe('a receipt with no items (MOL-227)', () => {
  it('asks for no new shot of a section read whole, its total read or not', () => {
    expect(needsReshoot({ ...receipt([], 170_000), layout: 'department' })).toBe(false)
    expect(needsReshoot({ ...receipt([]), layout: 'department' })).toBe(false)
  })

  it('is a receipt read with no line, and nothing else', () => {
    expect(withoutItems({ status: 'parsed', lineCount: 0 })).toBe(true)
    expect(withoutItems({ status: 'parsed', lineCount: 1 })).toBe(false)
    expect(withoutItems({ status: 'failed', lineCount: 0 })).toBe(false)
    expect(withoutItems({ status: 'reading', lineCount: 0 })).toBe(false)
    expect(withoutItems({ status: 'recorded', lineCount: 0 })).toBe(false)
  })
})

describe('the figures as the domain’s values', () => {
  it('reads a till’s hundredths as drams’ minor units', () => {
    expect(moneyOfHundredths(76_075, 'AMD')).toEqual({ minor: 76_075n, currency: 'AMD' })
  })

  it('takes no amount for a negative, a missing or a broken figure', () => {
    expect([
      moneyOfHundredths(-1, 'AMD'),
      moneyOfHundredths(null, 'AMD'),
      moneyOfHundredths(Number.NaN, 'AMD'),
    ]).toEqual([null, null, null])
  })

  it('keeps a weight in thousandths of a kilogram', () => {
    expect(receiptLineOf(line({ quantityMilli: 1_312, unit: 'kg' }), 'AMD').quantity).toEqual({
      milli: 1_312n,
      unit: 'kg',
    })
  })

  it('takes no count for a fraction read for pieces', () => {
    expect(receiptLineOf(line({ quantityMilli: 1_500 }), 'AMD').quantity).toBeNull()
  })

  it('takes no quantity for zero', () => {
    expect(receiptLineOf(line({ quantityMilli: 0 }), 'AMD').quantity).toBeNull()
  })

  it('carries the line as printed, its heading and article', () => {
    const got = receiptLineOf(line(), 'AMD')
    expect([got.printed, got.hs, got.sku, got.settled, got.sum]).toEqual([
      'Կաթ',
      '0401',
      '1163909',
      true,
      { minor: 37_000n, currency: 'AMD' },
    ])
  })
})

describe('the date a receipt prints', () => {
  const latest = '2026-10-04'
  it('takes a real day, up to the latest one', () => {
    expect(receiptDateOf({ ...receipt([]), date: '2026-09-30' }, latest)).toBe('2026-09-30')
    expect(receiptDateOf({ ...receipt([]), date: latest }, latest)).toBe(latest)
  })

  it('drops a day OCR made up: 30 February, month 13', () => {
    expect(receiptDateOf({ ...receipt([]), date: '2026-02-30' }, latest)).toBeNull()
    expect(receiptDateOf({ ...receipt([]), date: '2026-13-01' }, latest)).toBeNull()
  })

  it('drops a year no receipt has: 0000, which Postgres refuses, 1999, and the future (review Р10, Р13)', () => {
    expect(receiptDateOf({ ...receipt([]), date: '0000-01-01' }, latest)).toBeNull()
    expect(receiptDateOf({ ...receipt([]), date: '1999-12-31' }, latest)).toBeNull()
    expect(receiptDateOf({ ...receipt([]), date: '2026-10-05' }, latest)).toBeNull()
    expect(receiptDateOf({ ...receipt([]), date: '2099-10-01' }, latest)).toBeNull()
  })

  it('has none when none was read', () => {
    expect(receiptDateOf(receipt([]), latest)).toBeNull()
  })
})

describe('the time a receipt prints (review Р12)', () => {
  it('takes a time a clock shows, the day’s edges included', () => {
    expect(receiptTimeOf({ ...receipt([]), time: '00:00' })).toBe('00:00')
    expect(receiptTimeOf({ ...receipt([]), time: '23:59' })).toBe('23:59')
  })

  it('drops one it does not', () => {
    expect(receiptTimeOf({ ...receipt([]), time: '99:99' })).toBeNull()
    expect(receiptTimeOf({ ...receipt([]), time: '24:00' })).toBeNull()
    expect(receiptTimeOf(receipt([]))).toBeNull()
  })
})

describe('the city of the address (MOL-126, Р-6)', () => {
  const rows = (...texts: string[]) => texts.map((text, line) => ({ text, part: 0, line }))

  it('ends the head of a fiscal till at its first class code (MOL-226)', () => {
    // a dish named after a city is a line, not a second city of the head
    const head = ['«ՖԱՍՏՖՈՒԴ»', 'ԳՅՈՒՄՐԻ Սայաթ-Նովա 7/9']
    const list = ['Դաս. 56.10, Ն/Կ 745030 1հատ 688.09 688.09', 'Երևան սենդվիչ']
    expect(receiptCityOf(rows(...head, ...list))).toBe('Гюмри')
    expect(receiptCityOf(rows(...list))).toBeNull()
  })

  it('ends the head where the class reading begins, «Դաս. 5б.10» as OCR reads it (review А6)', () => {
    const head = ['«ՖԱՍՏՖՈՒԴ»', 'ԳՅՈՒՄՐԻ Սայաթ-Նովա 7/9']
    const list = ['Դաս. 5б.10, Ն/Կ 745030 1հատ 688.09 688.09', 'Երևան սենդվիչ']
    expect(receiptCityOf(rows(...head, ...list))).toBe('Гюмри')
  })

  it('ends the head above the name of a terminal’s first dish whose code OCR lost (review 2, Б1b)', () => {
    const head = ['«ՖԱՍՏՖՈՒԴ»', 'ԳՅՈՒՄՐԻ Սայաթ Նովա 1']
    const list = ['Երևան սենդվիչ', '688.09x1.0 հատ=688.09դրամ', 'Դաս՝ 56.10', 'Թվիստեր']
    expect(receiptCityOf(rows(...head, ...list))).toBe('Гюмри')
  })

  it('keeps the head’s city out of a terminal’s first dish whose code OCR lost (review 3, № 11)', () => {
    const list = ['Պանրային սոուս', '120.0x1.0 հատ=120.00դրամ', 'Դաս՝ 56.10', 'Ֆրի']
    expect(receiptCityOf(rows('«ՖԱՍՏՖՈՒԴ»', 'ԳՅՈՒՄՐԻ Սայաթ-Նովա 7/9', ...list))).toBe('Гюмри')
  })

  it('ends the head above a first dish in capitals on a till that names in capitals (review 4, Г2)', () => {
    const head = ['«ՖԱՍՏՖՈՒԴ»', 'ԳՅՈՒՄՐԻ Սայաթ Նովա 1', '/շրջ հարկ/ = 851000']
    const list = ['ԵՐԵՎԱՆ ՍԵՆԴՎԻՉ', '688.09x1.0 հատ=688.09դրամ', 'Դաս՝ 56.10', 'ԹՎԻՍՏԵՐ']
    expect(receiptCityOf(rows(...head, ...list))).toBe('Гюмри')
  })

  it('reads the city that opens a row of the head', () => {
    expect(receiptCityOf(rows(': ԵՐԵՎԱՆ-ՍԻԹԻ', 'ԳՅՈՒՄՐԻ Գորկու 62 2.'))).toBe('Гюмри')
    expect(receiptCityOf(rows('DOG CITY', 'Gyumri Sayat-Nova Street, 42'))).toBe('Гюмри')
    expect(receiptCityOf(rows('ԵՐԵՎԱՆ Կոմիտասի 5'))).toBe('Ереван')
  })

  it('reads past one stray letter OCR puts at the paper’s edge, never past a word', () => {
    // am-08 of the bench, page mode 6
    expect(receiptCityOf(rows('— ԵՐԵՎԱՆ-ՍԻԹԻ :', 'է ԳՅՈՒՄՐԻ Գորկու 62 շ.'))).toBe('Гюмри')
    expect(receiptCityOf(rows('Մանրածախ ԳՅՈՒՄՐԻ'))).toBeNull()
  })

  it('reads the city after «ք.», the word for «город»', () => {
    expect(receiptCityOf(rows('ք. Երևան, Արշակունյաց 34'))).toBe('Ереван')
    expect(receiptCityOf(rows('Ք.ԳՅՈՒՄՐԻ ԳՈՐԿՈՒ 62'))).toBe('Гюмри')
    // after the country or the province (round 2, Р2-В4)
    expect(receiptCityOf(rows('ՀՀ, ք. Երևան, Արշակունյաց 34'))).toBe('Ереван')
    expect(receiptCityOf(rows('Շիրակի մարզ, ք. Գյումրի, Գորկու 62'))).toBe('Гюмри')
    // a word ending in «ք» is no «ք.» before a city
    expect(receiptCityOf(rows('Սուրճ ք.Երևանյան'))).toBeNull()
  })

  // round 4, Р4-В1: the head ends at the first item — an item named after a city is no address
  it('reads no city off an item line, a table’s or a card’s', () => {
    const table = (address: string, item: string) =>
      rows('Կտրոն 000018827', 'ԷԴԳԱՐ ԳԵՎՈ', address, 'DOG CITY', 'Թան:', item, 'ԴԵՂՁ 1')
    expect(receiptCityOf(table('ԵՐԵՎԱՆ Արշակունյաց 34', '(2203) ԳՅՈՒՄՐԻ ԳԱՐԵՋՈՒՐ 0.5լ'))).toBe(
      'Ереван',
    )
    expect(receiptCityOf(table('ՀՀ, ք. Երևան, Արշակունյաց 34', '(2203) ԳՅՈՒՄՐԻ ԳԱՐԵՋՈՒՐ'))).toBe(
      'Ереван',
    )
    expect(receiptCityOf(table('ԳՅՈՒՄՐԻ Շիրազի 57', '(2208) ԵՐԵՎԱՆ ԿՈՆՅԱԿ 0.5լ'))).toBe('Гюмри')
    // a card: the item's number before its name, its article on the next row
    expect(
      receiptCityOf(
        rows(
          'ԵՐԵՎԱՆ-ՍԻԹԻ',
          'Երևան, Կոմիտասի 5',
          '1.Գյումրի գարեջուր 0.5լ',
          '2203/1100001 1Հտ 450 450',
        ),
      ),
    ).toBe('Ереван')
  })

  // round 5, Р5-В1: a table's heading OCR read with its bracket and a digit lost still ends the head
  it('ends the head at an item row whose heading OCR read in part', () => {
    expect(
      receiptCityOf(
        rows('DOG CITY', 'ՀՀ, ք. Երևան, Շիրազի 57', 'Բաժին 1', '| |203) ԳՅՈՒՄՐԻ ԳԱՐԵՋՈՒՐ'),
      ),
    ).toBe('Ереван')
    expect(receiptCityOf(rows('ԳՅՈՒՄՐԻ Շիրազի 57', '| |208) ԵՐԵՎԱՆ ԿՈՆՅԱԿ'))).toBe('Гюмри')
  })

  // round 6, Р6-В1: the stray letter forgiven before a city is forgiven before an item's heading too
  it('ends the head at an item row behind a stray letter at the paper’s edge', () => {
    expect(
      receiptCityOf(rows('ՀՀ, ք. Երևան, Շիրազի 57', 'Բաժին 1', 'Ն (2203) ԳՅՈՒՄՐԻ ԳԱՐԵՋՈՒՐ')),
    ).toBe('Ереван')
    expect(receiptCityOf(rows('ԳՅՈՒՄՐԻ Շիրազի 57', 'Ն (2208) ԵՐԵՎԱՆ ԿՈՆՅԱԿ'))).toBe('Гюмри')
  })

  // round 6, Р6-В2: the head is the rows above the first item, however many — «Ереван Сити» runs to 17
  it('reads the address past the fifteenth row when the items begin below it', () => {
    const banner = Array.from({ length: 16 }, () => 'ՏՆՏԵՍԱԿԱՆ ԱՊՐԱՆՔՆԵՐ')
    expect(
      receiptCityOf(
        rows(
          ...banner,
          'ԳՅՈՒՄՐԻ Գորկու 62 2.',
          '1.Պոլիէթիլենային տոպրակ',
          '3923/1122223 1Հտ 50 50',
        ),
      ),
    ).toBe('Гюмри')
  })

  // round 7, Р7-В1: a card's first item's name stands above its article, its number often without a
  // dot — the head ends above the name; an article cut by OCR still ends it
  it('ends a card’s head above its first item’s name, its article whole or cut', () => {
    const banner = Array.from({ length: 6 }, () => 'ՏՆՏԵՍԱԿԱՆ ԱՊՐԱՆՔՆԵՐ')
    const card = (article: string) =>
      rows(...banner, 'ԵՐԵՎԱՆ Արշակունյաց 34', 'ՀՎՀՀ:01282006', '1 ԳՅՈՒՄՐԻ ԳԱՐԵՋՈՒՐ 0.5լ', article)
    expect(receiptCityOf(card('2203/1100001 1Հտ 450 450'))).toBe('Ереван')
    expect(receiptCityOf(card('2203/1100 1Հտ 450 450'))).toBe('Ереван')
  })

  // round 8, Р8-В1: a number with a dot is an item only right above the first article — a banner with
  // «9.» OCR read at its edge stands above the address (R-dwtrim-psm6 am-10 of the bench)
  it('does not end the head at a numbered row far above the first article', () => {
    const card = rows(
      'Ակցիան գործում է միայն բարտապան',
      '9. հաճախորդների համար` ապան',
      '= 4 - ԳՅՈՒՄՐԻ Գորկու 62 2.',
      '/ԱԱՀ-ով հարկվող/',
      'Որից ԱԱՀ',
      '1.Դդմի սերմեր',
      '2008/149263 1Հտ 640 640',
    )
    expect(receiptCityOf(card)).toBe('Гюмри')
  })

  // round 5, Р5-В2, review 16: must not fire — a phone's area code and a house number are the head
  it('does not end the head at a phone’s area code or a house number', () => {
    expect(receiptCityOf(rows('DOG CITY', 'Հեռ. (0312) 5-55-55', 'ԳՅՈՒՄՐԻ Շիրազի 57'))).toBe(
      'Гюмри',
    )
    expect(
      receiptCityOf(rows('DOG CITY', '62, Գորկու փ.', 'ք. Գյումրի, Գորկու 62', 'ՀՎՀՀ 02615412')),
    ).toBe('Гюмри')
    // the house first on the city's own row, «ք.» naming the city (round 12, №19)
    expect(receiptCityOf(rows('DOG CITY', '62, Գորկու փ., ք. Գյումրի', 'ՀՎՀՀ 02615412'))).toBe(
      'Гюмри',
    )
  })

  // round 3, Р3-В2: a chain's legal address beside its shop's — two cities are no answer
  it('takes no city after «ք.» when another one is named in the head', () => {
    const chain = rows('"ԵՐԵՎԱՆ ՍԻԹԻ" ՍՊԸ', 'ՀՀ, ք. Երևան, Արշակունյաց 34', 'Գորկու 62, Գյումրի')
    expect(receiptCityOf(chain)).toBeNull()
    // the legal address of one city beside a shop's of another: two cities, no answer (round 10) —
    // the place is looked for in the person's own city, never in a city the head may have misnamed
    expect(receiptCityOf(rows('ՀՀ, ք. Երևան, Արշակունյաց 34', 'Գյումրի, Գորկու 62'))).toBeNull()
    // two shops' addresses opening rows — no answer
    expect(receiptCityOf(rows('Գյումրի, Գորկու 62', 'Երևան, Կոմիտասի 5'))).toBeNull()
  })

  it('does not take the chain in Latin or Cyrillic letters for the city either', () => {
    expect(receiptCityOf(rows('YEREVAN CITY', 'Yerevan-City'))).toBeNull()
    expect(receiptCityOf(rows('Ереван Сити'))).toBeNull()
  })

  it('does not take the chain «Ереван Сити» or an item named after the capital for the city', () => {
    expect(receiptCityOf(rows(': ԵՐԵՎԱՆ-ՍԻԹԻ', 'ԵՐԵՎԱՆ ՍԻԹԻ'))).toBeNull()
    expect(receiptCityOf(rows('3.Յոգուրտ երեւան Փրոդաքթս 2%'))).toBeNull()
  })

  it('looks in the head of the first part only', () => {
    const late = [...rows(...Array.from({ length: 40 }, () => 'ՏՆՏԵՍԱԿԱՆ')), ...rows('ԳՅՈՒՄՐԻ')]
    expect(receiptCityOf(late)).toBeNull()
    expect(receiptCityOf([{ text: 'ԳՅՈՒՄՐԻ Գորկու 62', part: 1, line: 0 }])).toBeNull()
  })
})

describe('what the shop’s memory knows a line by (MOL-126)', () => {
  it('knows it by the article first, then by the line’s search key', () => {
    const words = storeMemoryWords({ printed: 'Կաթ «Իգիթ» 3.2% 1լ', sku: '1163909' })
    expect(words.map((word) => word.kind)).toEqual(['sku', 'text'])
    expect(words[0]?.key).toBe('1163909')
  })

  it('folds what OCR reads two ways into one key, and knows a line with no article by text', () => {
    const [one] = storeMemoryWords({ printed: 'ԵՐԵՎԱՆ', sku: null })
    const [other] = storeMemoryWords({ printed: 'Երեւան', sku: null })
    expect(one).toEqual(other)
    expect(one?.kind).toBe('text')
  })

  it('remembers nothing of a line with no letters, and no text past the key’s length', () => {
    expect(storeMemoryWords({ printed: '— ·', sku: '' })).toEqual([])
    // the search key folds a doubled letter, so words rather than one letter over and over
    const long = 'կաթ '.repeat(STORE_MEMORY_KEY_MAX_OCTETS / 3)
    expect(storeMemoryWords({ printed: long, sku: '1' })).toEqual([{ kind: 'sku', key: '1' }])
  })
})

describe('the moment a receipt prints', () => {
  it('is its day and time on the till’s clock, +4 in Armenia', () => {
    expect(receiptMomentOf('2026-09-26', '19:42', 'AM')).toEqual(
      new Date('2026-09-26T15:42:00.000Z'),
    )
  })

  it('is none without a time a clock shows', () => {
    expect(receiptMomentOf('2026-09-26', null, 'AM')).toBeNull()
    expect(receiptMomentOf('2026-09-26', '25:00', 'AM')).toBeNull()
  })

  it('places a Serbian receipt by Belgrade’s clock, summer time and winter (MOL-232)', () => {
    expect(receiptMomentOf('2025-07-18', '08:56', 'RS')).toEqual(new Date('2025-07-18T06:56:00Z'))
    expect(receiptMomentOf('2026-01-06', '08:57', 'RS')).toEqual(new Date('2026-01-06T07:57:00Z'))
    // the hour the clock goes forward and the one it goes back, 29 March and 25 October 2026
    expect(receiptMomentOf('2026-03-29', '03:30', 'RS')).toEqual(new Date('2026-03-29T01:30:00Z'))
    expect(receiptMomentOf('2026-10-25', '01:30', 'RS')).toEqual(new Date('2026-10-24T23:30:00Z'))
  })

  it('reads the till’s day and time off a moment, by the country’s zone', () => {
    expect(receiptClockOf(new Date('2025-07-18T06:56:53.834Z'), 'RS')).toEqual({
      day: '2025-07-18',
      time: '08:56',
    })
    // past midnight in Belgrade is still the evening before in UTC
    expect(receiptClockOf(new Date('2026-01-05T23:30:00Z'), 'RS')).toEqual({
      day: '2026-01-06',
      time: '00:30',
    })
    expect(receiptClockOf(new Date('2026-09-26T15:42:00Z'), 'AM')).toEqual({
      day: '2026-09-26',
      time: '19:42',
    })
  })
})

// round 9 and before: the city is read off an address, never off an item named after a city — the
// shapes OCR made of either on the bench, crossed every way, and no head may name the item's city
describe('an item named after a city never names the receipt’s city (MOL-126)', () => {
  const words = new Set(['գարեջուր', 'կոնյակ', 'սպիտակ', 'հնգամյա', 'lager', 'brandy'])
  const rows = (...texts: string[]) => texts.map((text, line) => ({ text, part: 0, line }))
  const marks = [
    '',
    '1.',
    '1. ',
    '1 ',
    '1',
    '10,',
    '10, ',
    '| |203) ',
    '(2203) ',
    'Ն (2203) ',
    '| | ',
    '= ',
    'Ն ',
    '2 1.',
    '= 4 - ',
    '9. ',
    '2..1 ',
  ]
  const items = {
    Гюмри: [
      'ԳՅՈՒՄՐԻ ԳԱՐԵՋՈՒՐ',
      'Գարեջուր «Գյումրի»',
      'Գարեջուր Գյումրի',
      'Գյումրի գարեջուր',
      'ԳԱՐԵՋՈՒՐ ԳՅՈՒՄՐԻ ՍՊԻՏԱԿ',
      'ԳՅՈՒՄՐԻ ԳԱՐԵՋՈԻՐ',
      'GYUMRI LAGER',
      'Գարեջուր "Գյումրի"',
    ],
    Ереван: [
      'ԵՐԵՎԱՆ ԿՈՆՅԱԿ',
      'Կոնյակ «Երևան»',
      'Կոնյակ Երևան',
      'Երեւան կոնյակ',
      'YEREVAN կոնյակ',
      'Կոնյակ «Երեւան» 5տ',
      'ԵՐԵՎԱՆ ԿՈՆՅԱԿ ՀՆԳԱՄՅԱ',
      'YEREVAN BRANDY',
    ],
  }
  const tails = [
    '',
    ' 0.5լ',
    ' 500գ',
    ' 1 450 450',
    ' 2 450 900',
    ' 5տ. 0.5լ',
    ' 3.2%',
    ' 1Հտ 450 450',
    ' 0,5',
    ' 1 450',
    ' 1 50 50',
    ' 1 120',
    ' 450',
    ' 12',
    ' 62 2.',
  ]
  const addresses = {
    Гюмри: ['ԳՅՈՒՄՐԻ Գորկու 62 2.', 'ՀՀ, ք. Գյումրի, Գորկու 62', null],
    Ереван: ['ԵՐԵՎԱՆ Արշակունյաց 34', 'ՀՀ, ք. Երևան, Արշակունյաց 34', null],
  } as const

  it.each([
    ['Ереван', 'Гюмри'],
    ['Гюмри', 'Ереван'],
  ] as const)('on a receipt of %s, never %s', (home, other) => {
    const wrong: string[] = []
    for (const address of addresses[home])
      for (const mark of marks)
        for (const name of items[other])
          for (const tail of tails) {
            const item = `${mark}${name}${tail}`
            const shop = address === null ? [] : [address]
            for (const head of [
              [
                'ЧЕК',
                ...shop,
                'ՀՎՀՀ:01282006',
                '/ԱԱՀ-ով հարկվող/',
                item,
                '2203/1100001 1Հտ 450 450',
              ],
              ['DOG CITY', ...shop, 'Թան:', item, '(3824) ՏՈՏՈՒՀՈՂ'],
              [item, ...shop, 'ՀՎՀՀ:01282006'],
              [...shop, item],
            ]) {
              if (receiptCityOf(rows(...head), words) === other)
                wrong.push(`«${item}» ${String(address)}`)
            }
          }
    expect(wrong).toEqual([])
  })

  // the strong half: an address read in any form names its city, and any other city named in the head is
  // no answer — so even a bare brand, a kind OCR cut mid-word, never names another city beside it
  it.each([
    ['Ереван', 'Гюмри'],
    ['Гюмри', 'Ереван'],
  ] as const)('with the address of %s read, nothing names %s', (home, other) => {
    const bare = {
      Гюмри: ['Գյումրի', 'ԳՅՈՒՄՐԻ ԳԱ ուր.', 'GYUMRI', 'Գյումրի 62 2.', 'ԳՅՈՒՄՐԻ ԳԱՐ.'],
      Ереван: ['Երևան', 'ԵՐԵՎԱՆ ԿՈ ակ.', 'YEREVAN', 'Երևան 34', 'ԵՐԵՎԱՆ ԿՈՆ.'],
    }
    const wrong: string[] = []
    for (const address of addresses[home])
      if (address !== null)
        for (const mark of marks)
          for (const name of [...items[other], ...bare[other]])
            for (const tail of tails) {
              const item = `${mark}${name}${tail}`
              for (const head of [
                ['ЧЕК', address, 'ՀՎՀՀ:01282006', item, '2203/1100001 1Հտ 450 450'],
                [item, address],
                [address, item],
              ]) {
                if (receiptCityOf(rows(...head), words) === other)
                  wrong.push(`«${item}» ${address}`)
              }
            }
    expect(wrong).toEqual([])
  })

  // round 11: the city and the street on two rows; the chain's site however OCR read it
  it('reads a city whose street stands on the next row, and no city off the chain’s site', () => {
    expect(receiptCityOf(rows('ք. Գյումրի,', 'Գորկու 62', 'ՀՎՀՀ:01282006'), words)).toBe('Гюмри')
    // a shop named after a city over a street without one is no address (round 12, Р12-В1)
    expect(receiptCityOf(rows('ԵՐԵՎԱՆ ՄԹԵՐՔ', 'Գորկու 62', 'ԳՀ:31025350'), words)).toBeNull()
    expect(receiptCityOf(rows('ԳՅՈՒՄՐԻ ՄԱՐԿԵՏ', 'Կոմիտասի 35', 'ԳՀ:31025350'), words)).toBeNull()
    // a country's code and OCR's noise on an address are not a site (round 12, Р12-В2)
    for (const address of [
      'ԳՅՈՒՄՐԻ Գորկու 62, AM',
      'Gyumri, Gorki 62, AM',
      'ԳՅՈՒՄՐԻ Գորկու 62 ат',
      'Ww ԳՅՈՒՄՐԻ Գորկու 62',
    ]) {
      expect(receiptCityOf(rows('DOG CITY', address, 'ԳՀ:31025350'), words)).toBe('Гюмри')
    }
    for (const site of ['Ww Yerevan: СПу. ат', 'www.yerevan.city.am', 'www yerevan—city am']) {
      expect(receiptCityOf(rows('ԵՐԵՎԱՆ-ՍԻԹԻ', site, 'ԳՅՈՒՄՐԻ Գորկու 62 2.'), words)).toBe('Гюмри')
    }
    // a tax number under a city is no street
    expect(receiptCityOf(rows('Գյումրի', 'ՀՎՀՀ:01282006'), words)).toBeNull()
  })

  it('still reads the address beside a street, whatever OCR put at its edge', () => {
    for (const address of [
      'ыы ԳՅՈՒՄՐԻ Գորկու 62 2 --',
      'Se .»ԳՅՈՒՄՐԻ Գորկու 62 2.',
      '«ՀԱՎԵՏ ԳՅՈՒՄՐԻ Գորկու 62 2 .-',
      'ԳՅՈՒՄՐԻ Գորկու 62 տ.',
      'ք. Գյումրի, Գորկու 62 տ. 3',
      'Գյումրի 3101, Ռիժկովի 104',
      'ԳՅՈՒՄՐԻ Գորկու 62 02.10.2026',
      'ԳՅՈՒՄՐԻ Գորկու 162/105',
      'ԳՅՈՒՄՐԻ Գորկու 62գ',
      'ԳՅՈՒՄՐԻ Շիր. 57',
      'ԳՅՈՒՄՐԻ Գոր. 62',
      'ԳՅՈՒՄՐԻ Վարդ. 12',
      'ԳՅՈՒՄՐԻ Գորկու 62 2.',
      '9. ԳՅՈՒՄՐԻ Գորկու 62 2.',
      '2..1 ԳՅՈՒՄՐԻ Գորկու 62 2,',
      '= 4 - ԳՅՈՒՄՐԻ Գորկու 62 2.',
      'ԳՅՈՒՄՐԻ Գորկուծ22. _',
      'ԳՅՈՒՄՐԻ Գորկու 62.2',
      'ԳՅՈՒՄՐԻ Շիրազի 57',
    ]) {
      expect(receiptCityOf(rows('ԵՐԵՎԱՆ-ՍԻԹԻ', address, 'ՀՎՀՀ:01282006'), words)).toBe('Гюмри')
    }
  })
})

describe('«чек разобран» without a sound at night (MOL-129)', () => {
  it('rings from 08:00 to 21:59 of the person’s zone, and is quiet from 22:00 to 07:59', () => {
    // Yerevan is UTC+4 all year
    const at = (utc: string) => tellsQuietly(new Date(utc), 'Asia/Yerevan')
    expect(at('2026-10-04T03:59:59Z')).toBe(true)
    expect(at('2026-10-04T04:00:00Z')).toBe(false)
    expect(at('2026-10-04T17:59:59Z')).toBe(false)
    expect(at('2026-10-04T18:00:00Z')).toBe(true)
  })

  it('follows Belgrade’s summer time', () => {
    // 20:30 UTC is 22:30 in summer (UTC+2), night, and 21:30 in winter (UTC+1), still evening
    expect(tellsQuietly(new Date('2026-07-01T19:30:00Z'), 'Europe/Belgrade')).toBe(false)
    expect(tellsQuietly(new Date('2026-07-01T20:30:00Z'), 'Europe/Belgrade')).toBe(true)
    expect(tellsQuietly(new Date('2026-12-01T20:30:00Z'), 'Europe/Belgrade')).toBe(false)
  })
})
