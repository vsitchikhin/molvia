import { describe, expect, it } from 'vitest'
import {
  TWIN_MERGE,
  TWIN_UNITS,
  mergeClock,
  nameParts,
  sameSizes,
  twinSpelling,
  twinVerdict,
} from '#model/entities/twins'

const spelling = (a: string, b: string) => twinSpelling(nameParts(a), nameParts(b))

describe('nameParts', () => {
  it('reads a number with its unit, glued or apart, in any script', () => {
    expect(nameParts('Молоко 1л').sizes).toEqual(['1 l'])
    expect(nameParts('Молоко 1 l').sizes).toEqual(['1 l'])
    expect(nameParts('Կաթ 1 լ').sizes).toEqual(['1 l'])
    expect(nameParts('Сыр 500 гр').sizes).toEqual(nameParts('Сыр 500г').sizes)
  })

  it('reads a fat by its value: a comma, a point, a trailing zero', () => {
    expect(nameParts('Молоко 3,2%').sizes).toEqual(['3.2 %'])
    expect(nameParts('Молоко 3.20 %').sizes).toEqual(['3.2 %'])
    expect(nameParts('Масло 82,5%').sizes).not.toEqual(nameParts('Масло 82%').sizes)
  })

  it('keeps a number with no unit as a size, and the word after it as a word', () => {
    expect(nameParts('Яйца С0 10 шт')).toMatchObject({
      sizes: ['0', '10 piece'],
      words: ['iaiцa', 's'],
      scripts: ['cyrillic'],
    })
    expect(nameParts('Сыр 2 вида')).toMatchObject({
      sizes: ['2'],
      words: ['sir', 'vida'],
      scripts: ['cyrillic'],
    })
  })

  it('sorts the sizes, so the order of a label does not matter', () => {
    expect(nameParts('Молоко 1 л 3,2%').sizes).toEqual(nameParts('Молоко 3.2% 1л').sizes)
  })

  it('has no words for a name of nothing but sizes', () => {
    expect(nameParts('500 г').words).toEqual([])
  })
})

describe('sameSizes', () => {
  it('tells two volumes apart', () => {
    expect(sameSizes(nameParts('Молоко 1 л'), nameParts('Молоко 2 л'))).toBe(false)
  })

  it('tells a unit apart by its number and its unit both', () => {
    expect(sameSizes(nameParts('Сахар 1 кг'), nameParts('Сахар 1 л'))).toBe(false)
    expect(sameSizes(nameParts('Сахар 1 кг'), nameParts('Сахар 1000 г'))).toBe(false)
  })

  it('tells a size apart from no size', () => {
    expect(sameSizes(nameParts('Молоко'), nameParts('Молоко 1 л'))).toBe(false)
  })
})

describe('twinSpelling', () => {
  it('is no distance at all for a fat written with a comma and a point', () => {
    expect(spelling('Молоко 3.2%', 'Молоко 3,2%')).toMatchObject({
      edits: 0,
      worst: 0,
      sameScripts: true,
    })
  })

  it('counts a typo in a word', () => {
    expect(spelling('Малоко 3,2%', 'Молоко 3,2 %')).toMatchObject({
      edits: 1,
      worst: 1,
      sameScripts: true,
    })
  })

  it('matches words in any order', () => {
    expect(spelling('Сыр чанах', 'Чанах сыр')).toMatchObject({
      edits: 0,
      worst: 0,
      sameScripts: true,
      sameLetters: false,
    })
  })

  it('counts every word of a transliteration', () => {
    expect(spelling('Ереван Сити', 'Yerevan City')).toMatchObject({
      edits: 2,
      worst: 1,
      sameScripts: false,
    })
  })

  it('is no pair with another size', () => {
    expect(spelling('Молоко 1 л', 'Молоко 2 л')).toBeNull()
    expect(spelling('Яйца С0 10 шт', 'Яйца С1 10 шт')).toBeNull()
  })

  it('is no pair with a word more: a brand is another item', () => {
    expect(spelling('Сыр чанах', 'Сыр чанах Ашхар')).toBeNull()
    expect(spelling('Молоко', 'Молоко Марианна')).toBeNull()
  })

  it('is no pair when a short word differs', () => {
    expect(spelling('SAS', 'SOS')).toBeNull()
    expect(spelling('Сыр SAS', 'Сыр SOS')).toBeNull()
  })

  it('is no distance for one key in two scripts: the spelling cannot tell «Milo» from «Мыло»', () => {
    // The spelling sees one key, and says the scripts differ: never a merge, at most a candidate.
    expect(spelling('Milo', 'Мыло')).toMatchObject({
      edits: 0,
      worst: 0,
      sameScripts: false,
      sameLetters: false,
    })
  })

  it('is no pair for names of sizes alone', () => {
    expect(spelling('500 г', '500 г')).toBeNull()
  })
})

describe('twinVerdict', () => {
  const pair = (a: string, b: string, meaning: number | null, sameUnit = true) =>
    twinVerdict({ spelling: spelling(a, b), sameUnit, meaning })

  it('merges a fat with a comma and a point, close in meaning', () => {
    expect(pair('Молоко 3.2%', 'Молоко 3,2%', 0.97)).toBe('merge')
  })

  it('merges at the threshold exactly and not below it', () => {
    expect(pair('Малоко', 'Молоко', TWIN_MERGE.meaning)).toBe('merge')
    expect(pair('Малоко', 'Молоко', TWIN_MERGE.meaning - 0.001)).toBe('candidate')
  })

  it('merges nothing without a vector', () => {
    expect(pair('Молоко 3.2%', 'Молоко 3,2%', null)).toBe('candidate')
  })

  it('never merges two units of price, only names them', () => {
    expect(pair('Хлеб', 'Хлеб', 0.99, false)).toBe('candidate')
  })

  it('never merges one key in two scripts: «Milo» is not «Мыло»', () => {
    expect(pair('Milo', 'Мыло', 0.48)).toBe('candidate')
  })

  it('never merges two edits in a word, however close the meaning', () => {
    expect(pair('Хлеб белый', 'Хлеб балай', 0.99)).toBe('candidate')
    expect(pair('Лимоны', 'Лимонад', 0.91)).toBe('candidate')
  })

  it('leaves what is far by meaning, and what differs in size or a short word', () => {
    expect(pair('Курица', 'Корица', 0.79)).toBe('apart')
    expect(pair('Молоко 1 л', 'Молоко 2 л', 0.99)).toBe('apart')
    expect(pair('SAS', 'SOS', 0.99)).toBe('apart')
  })
})

describe('mergeClock', () => {
  it.each([
    ['2026-10-06T00:29:00Z', '2026-10-06', false, false],
    ['2026-10-06T00:30:00Z', '2026-10-06', true, false],
    ['2026-10-06T04:59:00Z', '2026-10-06', true, false],
    ['2026-10-06T05:00:00Z', '2026-10-06', true, true],
    ['2026-10-06T19:59:00Z', '2026-10-06', true, true],
    // midnight in Yerevan is a new day, and its night not yet due
    ['2026-10-06T20:00:00Z', '2026-10-07', false, false],
  ])('at %s it is the night of %s: merge %s, report %s', (at, day, merge, report) => {
    expect(mergeClock(new Date(at))).toEqual({ day, merge, report })
  })
})

describe('the units of a size (adversarial А2)', () => {
  it('reads no spelling as two units', () => {
    const spellings = Object.values(TWIN_UNITS).flat()
    expect(new Set(spellings).size).toBe(spellings.length)
  })

  it.each([
    ['Лента 50 мм', 'Лента 50 м'],
    ['Труба 20 mm', 'Труба 20 m'],
    ['Кабель 5 км', 'Кабель 5 см'],
    ['Кабель 5 km', 'Кабель 5 cm'],
    ['Батарейки AA 4 pc', 'Батарейки AA 4 уп'],
    ['Салфетки 100 pc', 'Салфетки 100 pk'],
  ])('tells «%s» from «%s», which the search key folds into one', (a, b) => {
    expect(sameSizes(nameParts(a), nameParts(b))).toBe(false)
    expect(twinVerdict({ spelling: spelling(a, b), sameUnit: true, meaning: 0.99 })).toBe('apart')
  })

  it('reads a unit in any case, and its spellings as one', () => {
    expect(nameParts('Лента 50 ММ').sizes).toEqual(nameParts('Лента 50 mm').sizes)
    expect(nameParts('Яйца 10 pc').sizes).toEqual(nameParts('Яйца 10 шт').sizes)
  })
})

describe('one key in two scripts (review №6)', () => {
  it.each([
    ['Булочки для бургеров', 'Bulochki dlya burgerov', 0.902],
    ['Ткемали', 'Tkemali', 0.891],
    ['Зовк', 'Զովք', 0.99],
    ['Сметана', 'Сметанa', 0.99],
  ])('never merges «%s» and «%s», whatever the model says (%s)', (a, b, meaning) => {
    expect(twinVerdict({ spelling: spelling(a, b), sameUnit: true, meaning })).toBe('candidate')
  })

  it('reads a unit after a number as no script of the name', () => {
    expect(nameParts('Молоко 1 l').scripts).toEqual(['cyrillic'])
    expect(
      twinVerdict({
        spelling: spelling('Молоко 1 l', 'Молоко 1 л'),
        sameUnit: true,
        meaning: 0.99,
      }),
    ).toBe('merge')
  })

  it('still merges «ё» and a comma, one script on both sides', () => {
    expect(twinVerdict({ spelling: spelling('Мёд', 'Мед'), sameUnit: true, meaning: 0.95 })).toBe(
      'merge',
    )
  })
})

describe("a proper name, a place's (adversarial Ж1)", () => {
  const place = (a: string, b: string, meaning: number) =>
    twinVerdict({ spelling: spelling(a, b), sameUnit: true, meaning, properName: true })

  it.each([
    ['Маркет Ширак', 'Маркет Шираз', 0.942],
    ['Магнит', 'Магнат', 0.919],
    ['Аптека Альфа', 'Аптека Альта', 0.91],
  ])('never merges «%s» and «%s», a letter apart (%s)', (a, b, meaning) => {
    expect(place(a, b, meaning)).toBe('candidate')
  })

  it.each([
    ['Ереван  Сити', 'Ереван Сити', 0.98],
    ['Ереван-Сити', 'Ереван Сити', 0.981],
    ['Перекрёсток', 'Перекресток', 0.954],
  ])('merges «%s» and «%s», no edit apart (%s)', (a, b, meaning) => {
    expect(place(a, b, meaning)).toBe('merge')
  })

  it("leaves the items' rule as it was", () => {
    expect(
      twinVerdict({ spelling: spelling('Малоко', 'Молоко'), sameUnit: true, meaning: 0.95 }),
    ).toBe('merge')
  })
})

describe('a proper name by its letters, not its key (adversarial З1)', () => {
  const place = (a: string, b: string, meaning: number) =>
    twinVerdict({ spelling: spelling(a, b), sameUnit: true, meaning, properName: true })

  it.each([
    ['Аптека Римма', 'Аптека Рима', 0.944],
    ['Салон Лилия', 'Салон Лиля', 0.967],
    ['Кафе Майя', 'Кафе Мая', 0.922],
    ['Магазин Милла', 'Магазин Мила', 0.967],
  ])('never merges «%s» and «%s», one key and two shops (%s)', (a, b, meaning) => {
    expect(spelling(a, b)?.edits).toBe(0)
    expect(place(a, b, meaning)).toBe('candidate')
  })

  it('reads the Armenian «և», «եւ» and «եվ» as one spelling (MOL-12)', () => {
    expect(nameParts('Երևան Սիթի').letters).toBe(nameParts('Երեւան Սիթի').letters)
    expect(nameParts('Երևան Սիթի').letters).toBe(nameParts('Երեվան Սիթի').letters)
  })

  it('reads case, spacing, punctuation and «ё» aside, nothing else', () => {
    expect(nameParts('Гранд-Кенди, ЁЛКИ').letters).toBe('гранд кенди елки')
  })

  it("leaves the items' rule to the key: «Майя» and «Мая» of a product may merge", () => {
    expect(
      twinVerdict({ spelling: spelling('Сок Майя', 'Сок Мая'), sameUnit: true, meaning: 0.95 }),
    ).toBe('merge')
  })
})
