import { describe, expect, it } from 'vitest'
import { nameParts, sameSizes, twinSpelling } from '#model/entities/twins'

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
    expect(nameParts('Яйца С0 10 шт')).toEqual({ sizes: ['0', '10 piece'], words: ['iaiцa', 's'] })
    expect(nameParts('Сыр 2 вида')).toEqual({ sizes: ['2'], words: ['sir', 'vida'] })
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
    expect(spelling('Молоко 3.2%', 'Молоко 3,2%')).toEqual({ edits: 0, worst: 0 })
  })

  it('counts a typo in a word', () => {
    expect(spelling('Малоко 3,2%', 'Молоко 3,2 %')).toEqual({ edits: 1, worst: 1 })
  })

  it('matches words in any order', () => {
    expect(spelling('Сыр чанах', 'Чанах сыр')).toEqual({ edits: 0, worst: 0 })
  })

  it('counts every word of a transliteration', () => {
    expect(spelling('Ереван Сити', 'Yerevan City')).toEqual({ edits: 2, worst: 1 })
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
    // The meaning tells them apart; the spelling is half of the rule, never the whole.
    expect(spelling('Milo', 'Мыло')).toEqual({ edits: 0, worst: 0 })
  })

  it('is no pair for names of sizes alone', () => {
    expect(spelling('500 г', '500 г')).toBeNull()
  })
})
