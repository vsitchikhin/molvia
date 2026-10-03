import { describe, expect, it } from 'vitest'
import {
  RESHOOT_TOTAL_SHARE,
  moneyOfHundredths,
  needsReshoot,
  receiptDateOf,
  STORE_MEMORY_KEY_MAX_OCTETS,
  receiptCityOf,
  receiptLineOf,
  receiptMomentOf,
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

describe('«разгладьте и переснимите» (В-4)', () => {
  it('asks for a new shot when no item line was read', () => {
    expect(needsReshoot(receipt([], 100_000))).toBe(true)
    expect(needsReshoot(receipt([]))).toBe(true)
  })

  it(`with the total read, asks below ${String(RESHOOT_TOTAL_SHARE * 100)} % of it: exactly the share, a luma under`, () => {
    expect(needsReshoot(receipt([line({ sumHundredths: 70_000 })], 100_000))).toBe(false)
    expect(needsReshoot(receipt([line({ sumHundredths: 69_999 })], 100_000))).toBe(true)
  })

  it('with the total read, one lost line of many is the review screen’s, not a new shot (am-03: 0,97)', () => {
    expect(needsReshoot(receipt([line({ sumHundredths: 97_000 })], 100_000))).toBe(false)
  })

  it('with the total read, counts a line whose sum was lost as nothing', () => {
    expect(
      needsReshoot(
        receipt([line({ sumHundredths: null }), line({ sumHundredths: 50_000 })], 100_000),
      ),
    ).toBe(true)
  })

  it('with no total, asks when fewer than half the lines add up: half is enough', () => {
    expect(needsReshoot(receipt([line(), line({ settled: false })]))).toBe(false)
    expect(
      needsReshoot(receipt([line(), line({ settled: false }), line({ settled: false })])),
    ).toBe(true)
  })

  it('must not fire on a short receipt whose total was missed but whose lines add up (am-01)', () => {
    expect(needsReshoot(receipt([line(), line(), line()]))).toBe(false)
  })

  it('counts no sum the domain throws away: past a safe integer, past the total (review Р11)', () => {
    const junk = line({ sumHundredths: Number.MAX_SAFE_INTEGER + 2 })
    expect(needsReshoot(receipt([junk], 1_000_000))).toBe(true)
    expect(needsReshoot(receipt([line({ sumHundredths: 2_000_000 })], 1_000_000))).toBe(true)
  })

  it('takes a total of zero for no total', () => {
    expect(needsReshoot(receipt([line()], 0))).toBe(false)
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
    expect(receiptCityOf(rows('DOG CITY', '62, Գորկու փ., ք. Գյումրի', 'ՀՎՀՀ 02615412'))).toBe(
      'Гюмри',
    )
  })

  // round 3, Р3-В2: a chain's legal address beside its shop's — two cities are no answer
  it('takes no city after «ք.» when another one is named in the head', () => {
    const chain = rows('"ԵՐԵՎԱՆ ՍԻԹԻ" ՍՊԸ', 'ՀՀ, ք. Երևան, Արշակունյաց 34', 'Գորկու 62, Գյումրի')
    expect(receiptCityOf(chain)).toBeNull()
    // the shop's address opening a row decides over the legal one
    expect(receiptCityOf(rows('ՀՀ, ք. Երևան, Արշակունյաց 34', 'Գյումրի, Գորկու 62'))).toBe('Гюмри')
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
})
