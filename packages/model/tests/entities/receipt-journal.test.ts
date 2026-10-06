import { describe, expect, it } from 'vitest'
import {
  serbianCityOf,
  serbianItemName,
  serbianJournal,
  serbianServiceLine,
  serbianShopOf,
} from '#model/entities/receipt-journal'
import { madeUpJournal } from './serbian-receipt'

// item rows as the tax office renders them (MOL-223, MOL-229), under a head that names nobody
const journal = madeUpJournal(
  [
    { name: 'SECER KRISTAL 1KG SUNOKO KOM (Е)', price: '94,99', quantity: '2', sum: '189,98' },
    { name: 'BANANA KG (Е)', price: '199,99', quantity: '1,482', sum: '296,39' },
    { name: 'UBRUS JUMBO 2SL 1/1 NATU KOM (Ђ)', price: '279,99', quantity: '12', sum: '3.359,88' },
    { name: 'Filet lososa/KG/0238062 (Ђ)', price: '2.399,99', quantity: '0,408', sum: '979,20' },
    {
      name: 'OPTI BMB 95,2710124500 /LIT (Ђ)',
      price: '199,00',
      quantity: '45,91',
      sum: '9.136,09',
    },
    {
      name: 'BODI ŽERSEJ - MAJICA - 8683120043861 (КОМ) (Ђ)',
      price: '599,00',
      quantity: '1',
      sum: '599,00',
    },
  ],
  '14.560,54',
)

describe('serbianJournal', () => {
  it('reads every line: name, quantity, price and sum, in hundredths and thousandths', () => {
    const read = serbianJournal(journal)
    expect(read?.totalHundredths).toBe(1_456_054)
    expect(
      read?.lines.map(({ printed, quantityMilli, unit, priceHundredths, sumHundredths }) => [
        printed,
        quantityMilli,
        unit,
        priceHundredths,
        sumHundredths,
      ]),
    ).toEqual([
      ['SECER KRISTAL 1KG SUNOKO KOM', 2_000, 'piece', 9_499, 18_998],
      ['BANANA KG', 1_482, 'kg', 19_999, 29_639],
      ['UBRUS JUMBO 2SL 1/1 NATU KOM', 12_000, 'piece', 27_999, 335_988],
      ['Filet lososa/KG/0238062', 408, 'kg', 239_999, 97_920],
      ['OPTI BMB 95,2710124500 /LIT', 45_910, 'l', 19_900, 913_609],
      ['BODI ŽERSEJ - MAJICA - 8683120043861 (КОМ)', 1_000, 'piece', 59_900, 59_900],
    ])
  })

  it('settles a line whose price × quantity, half up to the hundredth, is its sum', () => {
    const settled = serbianJournal(journal)?.lines.map((line) => line.settled)
    // 1,482 × 199,99 = 296,385 → 296,39; 0,408 × 2 399,99 = 979,196 → 979,20
    expect(settled?.slice(0, 4)).toEqual([true, true, true, true])
    expect(serbianJournal(journal)?.lines.map((line) => line.discountHundredths)).toEqual(
      Array.from({ length: 6 }, () => null),
    )
  })

  it('reads a line paid less than price × quantity as discounted, and settled (adversarial А2)', () => {
    // as rs-11 of MOL-229 prints it: a fifth off, no line of its own for the discount
    const read = serbianJournal(
      madeUpJournal(
        [
          { name: 'Pesto (kom) (А)', price: '440,00', quantity: '4', sum: '1.408,00' },
          { name: 'Jaja Pro (kom) (Г)', price: '510,00', quantity: '2', sum: '1.020,00' },
        ],
        '2.428,00',
      ),
    )
    expect(read?.lines.map((line) => [line.discountHundredths, line.settled])).toEqual([
      [35_200, true],
      [null, true],
    ])
  })

  it('never settles a line paid more than price × quantity', () => {
    const read = serbianJournal(
      madeUpJournal(
        [{ name: 'HLEB KOM (Е)', price: '62,00', quantity: '1', sum: '124,00' }],
        '124,00',
      ),
    )
    expect(read?.lines[0]).toMatchObject({ settled: false, discountHundredths: null })
  })

  it('takes a bare «L» for a litre only when a fraction is poured (review 5)', () => {
    const read = serbianJournal(
      madeUpJournal(
        [
          { name: 'PIVO JELEN 0,5 L (Ђ)', price: '129,99', quantity: '2', sum: '259,98' },
          { name: 'MLEKO RINFUZ L (Е)', price: '140,00', quantity: '1,5', sum: '210,00' },
        ],
        '469,98',
      ),
    )
    expect(read?.lines.map((line) => line.unit)).toEqual(['piece', 'l'])
  })

  it('joins a name the fortieth column cut mid-word, its label on the next row', () => {
    const wrapped = serbianJournal(
      [
        'Назив   Цена         Кол.         Укупно',
        'BODI ŽERSEJ - MAJICA - 8683120043861 (КО',
        'М) (Ђ)',
        '       599,00          1          599,00',
        '----------------------------------------',
      ].join('\n'),
    )
    expect(wrapped?.lines[0]?.printed).toBe('BODI ŽERSEJ - MAJICA - 8683120043861 (КОМ)')
    expect(wrapped?.totalHundredths).toBeNull()
  })

  it('reads nothing of the head: the cashier and the buyer are in no line', () => {
    const text = JSON.stringify(serbianJournal(journal))
    expect(text).not.toContain('Тест Тестовић')
    expect(text).not.toContain('100000009')
  })

  it('gives null for a journal with no list of items, and no lines for an empty list', () => {
    expect(
      serbianJournal('============ ФИСКАЛНИ РАЧУН ============\nУкупан износ: 1,00'),
    ).toBeNull()
    expect(serbianJournal(madeUpJournal([], '0,00'))?.lines).toEqual([])
  })
})

describe('serbianItemName', () => {
  it('drops the unit word and the till’s article, and sets capitals as a sentence', () => {
    expect(serbianItemName('SECER KRISTAL 1KG SUNOKO KOM')).toBe('Secer kristal 1kg sunoko')
    expect(serbianItemName('Zitopek beli hleb /kom')).toBe('Zitopek beli hleb')
    expect(serbianItemName('Filet lososa/KG/0238062')).toBe('Filet lososa')
    expect(serbianItemName('BODI ŽERSEJ - MAJICA - 8683120043861 (КОМ)')).toBe(
      'Bodi žersej - majica',
    )
    expect(serbianItemName('BANANA KG')).toBe('Banana')
    expect(serbianItemName('OPTI BMB 95,2710124500 /LIT')).toBe('Opti bmb 95,2710124500')
  })

  it('keeps a size: a bare «L» after a number is a litre of the package, not how it is sold', () => {
    expect(serbianItemName('MLEKO 2,8% 1 L KOM')).toBe('Mleko 2,8% 1 l')
    expect(serbianItemName('COCA COLA 0.33L')).toBe('Coca cola 0.33l')
  })

  it('drops the till’s article or a GTIN opening the name (adversarial А5)', () => {
    expect(serbianItemName('383841701269 KESICA M TT 32+12*41 CM / KOM')).toBe(
      'Kesica m tt 32+12*41 cm',
    )
    expect(serbianItemName('[528195] KASIKA PLASTICNA BELA FRESH 20/1 [KOM]')).toBe(
      'Kasika plasticna bela fresh 20/1',
    )
    expect(serbianItemName('0252491 TRAKA ZA PROZORE 9MM X 6 KOM')).toBe('Traka za prozore 9mm x 6')
    expect(serbianItemName('4911785 Torba MY BLUE BAG recikl./KOM')).toBe(
      'Torba MY BLUE BAG recikl.',
    )
    // a size or a count of five digits and less opens a name as its own word
    expect(serbianItemName('175G GRAND SIN ORIGI KO')).toBe('175g grand sin origi')
    expect(serbianItemName('10/1 VIGO ZIPER KESA KO')).toBe('10/1 vigo ziper kesa')
  })

  it('keeps a name that is nothing but its unit word, and one in mixed case as it is', () => {
    expect(serbianItemName('KOM')).toBe('Kom')
    expect(serbianItemName('Pionir medeno srce 150gr /kom')).toBe('Pionir medeno srce 150gr')
  })
})

describe('serbianShopOf', () => {
  it('splits the premises’ code from the shop’s name', () => {
    expect(serbianShopOf('1113343-RODA MEGAMARKET 463')).toEqual({
      unit: '1113343',
      name: 'RODA MEGAMARKET 463',
    })
    expect(serbianShopOf(' 1162807-AMANDA ')).toEqual({ unit: '1162807', name: 'AMANDA' })
    expect(serbianShopOf('Prodavnica bez šifre')).toEqual({
      unit: null,
      name: 'Prodavnica bez šifre',
    })
    expect(serbianShopOf('  ')).toBeNull()
  })
})

describe('serbianCityOf', () => {
  it('reads Belgrade and Novi Sad off a municipality or a town, in either script', () => {
    expect(serbianCityOf('Београд-Земун')).toBe('Белград')
    expect(serbianCityOf('Beograd-Vračar')).toBe('Белград')
    expect(serbianCityOf('Нови Сад')).toBe('Нови-Сад')
    expect(serbianCityOf(null, 'NOVI SAD')).toBe('Нови-Сад')
  })

  it('gives null for a city the settings have not got', () => {
    expect(serbianCityOf('Ниш-Медијана', 'НИШ (МЕДИЈАНА)')).toBeNull()
    expect(serbianCityOf(null, null)).toBeNull()
  })
})

describe('serbianServiceLine', () => {
  it('knows a delivery, a tip and a service in either script (adversarial А6)', () => {
    for (const printed of ['Достава', 'DOSTAVA 0', 'Напојница', 'napojnica', 'Usluga pakovanja']) {
      expect(serbianServiceLine(printed), printed).toBe(true)
    }
  })

  it('takes no product for one', () => {
    for (const printed of ['SECER KRISTAL 1KG SUNOKO KOM', 'BANANA KG', 'Dostavljac igracka']) {
      expect(serbianServiceLine(printed), printed).toBe(false)
    }
  })
})
