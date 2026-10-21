import { describe, expect, it } from 'vitest'
import {
  createLineMatcher,
  headingRulesOut,
  isServiceClass,
  receiptWords,
} from '#model/entities/receipt-match'
import type { CatalogueNode } from '#model/entities/receipt-match'

const node = (name: string, names: string[], headings: string[]): CatalogueNode => ({
  itemId: name,
  name,
  names,
  headings,
})

const NODES = [
  node('Молоко', ['կաթ', 'կովի կաթ'], ['0401', '0402']),
  node('Молоко 3,2%', ['կաթ 3.2%', 'կաթ 3,2%'], ['0401']),
  node('Клей', ['սոսինձ'], ['3506']),
  node('Шоколад', ['շոկոլադ'], ['1806']),
  node('Печенье', ['թխվածքաբլիթ'], ['1905']),
  node('Корм для кошек', ['կատվի կեր'], ['2309']),
  node('Корм для собак', ['շան կեր'], ['2309']),
  node('Наполнитель для лотка', ['լցանյութ'], ['3824']),
]
const WORDS = {
  կաթ: 'молоко',
  կատու: 'кошка',
  կատվի: 'кошка',
  ավազ: 'песок',
  շոկոլադ: 'шоколад',
  թխվածքաբլիթ: 'печенье',
  սոսինձ: 'клей',
  յոգուրտ: 'йогурт',
  ելակ: 'клубника',
  ելակի: 'клубника',
  դառը: 'горький',
}
const matcher = createLineMatcher(NODES, WORDS)

describe('the words of a line', () => {
  it('keeps Armenian words of two letters or more, lower case, «և» spelt out', () => {
    expect(receiptWords('0401/1163909 Կաթ «Իգիթ» 3.2% 1լ')).toEqual(['կաթ', 'իգիթ', '1լ'])
    expect(receiptWords('ԵՐԵՎԱՆ և')).toEqual(['երեվան', 'եվ'])
    expect(receiptWords('Milk 3.2% Б')).toEqual([])
  })
})

describe('a line to an item by its names (MOL-126)', () => {
  it('finds the item and picks the variety by the fat printed', () => {
    expect(matcher.match('Կաթ 3.2% 1լ', '0401')).toEqual({ itemId: 'Молоко 3,2%', far: false })
    expect(matcher.match('Կաթ 1լ', '0401')).toEqual({ itemId: 'Молоко', far: false })
  })

  it('takes a name’s word one edit off, the line’s kind being the dictionary’s', () => {
    expect(matcher.match('Շոկոլադ դառը', null)?.itemId).toBe('Шоколад')
    expect(matcher.match('Թխվածքաբլիթ կարագով', null)?.itemId).toBe('Печенье')
  })

  it('rules out by the heading what the line cannot be, a swapped digit of it allowed', () => {
    // milk is no glue, and the heading's one item is no milk either (MOL-293)
    expect(matcher.match('Կաթ', '3506')).toBeNull()
    expect(matcher.match('Կաթ', '9999')).toBeNull()
    expect(matcher.match('Թխվածքաբլիթ', '1906')?.itemId).toBe('Печенье')
  })

  it('needs every word of a name', () => {
    expect(matcher.match('կովի միս', null)).toBeNull()
  })

  it('falls back to the heading only for an item the line names whole and by its kind — far', () => {
    const heading = createLineMatcher(
      [node('Песок кошка', [], ['2508']), node('Песок', [], ['2508'])],
      WORDS,
    )
    expect(heading.match('Ավազ կատու', '2508')).toEqual({ itemId: 'Песок кошка', far: true })
    // the heading alone names nothing the line does not print (MOL-293): a cat's food, a litter
    expect(matcher.match('ՏՈՖՈՒ ՀՈՂ', '3824')).toBeNull()
    expect(matcher.match('ՎԻՆՆԻ կատու', '2309')).toBeNull()
    // a swapped digit rules out, never chooses: 3824 read as 8824 chooses nothing
    expect(heading.match('Ավազ կատու', '2509')).toBeNull()
  })

  it('finds nothing in a line with no Armenian word and no heading', () => {
    expect(matcher.match('Coca-Cola 1.5L', null)).toBeNull()
  })
})

describe('an item only by the line’s kind and brand (MOL-293, В-1 «а»)', () => {
  const branded = createLineMatcher(
    [...NODES, node('Клубника', ['ելակ'], ['0810']), node('Йогурт', ['յոգուրտ'], ['0403'])],
    WORDS,
  )

  it('never finds an item by a word of a flavour: a strawberry yoghurt is no strawberry', () => {
    expect(branded.match('Յոգուրտ ելակի 2% 130գր', null)).toEqual({ itemId: 'Йогурт', far: false })
    // with no yoghurt in the catalogue there is nothing, never the fruit
    const noYoghurt = createLineMatcher([node('Клубника', ['ելակ'], ['0810'])], WORDS)
    expect(noYoghurt.match('Յոգուրտ ելակի 2% 130գր', null)).toBeNull()
    // a milk of a flavour is a milk: the item names nothing the line has not
    expect(branded.match('Կաթ ելակով', null)?.itemId).toBe('Молоко')
  })

  it('takes for two things side by side only a name that says both (adversarial Б1)', () => {
    // a yoghurt of strawberries, or strawberries: the till does not say which comes first
    expect(branded.match('Ելակ յոգուրտ', null)).toBeNull()
    expect(branded.match('Յոգուրտ ելակ', null)).toBeNull()
    const both = createLineMatcher(
      [...NODES, node('Йогурт клубничный', ['յոգուրտ ելակ'], [])],
      WORDS,
    )
    expect(both.match('Ելակ յոգուրտ', null)?.itemId).toBe('Йогурт клубничный')
  })

  it('gives a line printing a brand no item without that brand', () => {
    expect(branded.match('Յոգուրտ «Երեմյան Փրոդաքթս» ելակ 2%', null)).toBeNull()
    expect(matcher.match('Կաթ «Իգիթ» 3.2% 1լ', '0401')).toBeNull()
  })

  it('finds no item whose name the line’s kind is not in, however its words are', () => {
    expect(branded.match('Շոկոլադ', '1806')?.itemId).toBe('Шоколад')
    // a kind the dictionary has not may be a letter lost, and its seed's name says it then: «Շոկլադ» is
    // chocolate; a letter misread is another word, «Շոկալադ» nothing (adversarial Б4)
    expect(branded.match('Շոկլադ', null)?.itemId).toBe('Шоколад')
    expect(branded.match('Շոկալադ', null)).toBeNull()
    expect(branded.match('Շոկ', null)).toBeNull()
  })
})

describe('a dish of a class of services (MOL-226)', () => {
  it('rules nothing out by a class of services: it is no customs heading', () => {
    // with the filter, «56.10» left no item at all of the seven names of KFC's receipt
    expect(matcher.match('Կաթ', '56.10')?.itemId).toBe('Молоко')
    expect(matcher.match('ՏՈՖՈՒ ՀՈՂ', '56.10')).toBeNull()
  })

  it('finds a dish among the goods only as «проверьте»', () => {
    expect(matcher.match('Շոկոլադ', '56.10')).toEqual({ itemId: 'Шоколад', far: true })
    expect(matcher.match('Շոկոլադ', null)).toEqual({ itemId: 'Шоколад', far: false })
  })

  it('tells a class of services from a heading by its point', () => {
    expect([isServiceClass('56.10'), isServiceClass('5610'), isServiceClass(null)]).toEqual([
      true,
      false,
      false,
    ])
    // «5610» read without its point is a heading: it rules out what it is not
    expect(matcher.match('Կաթ', '5610')).toBeNull()
  })
})

describe('the gloss', () => {
  it('reads the known words, one edit off too, and drops the rest', () => {
    expect(matcher.gloss('ԿԱԹ ԻԳԻԹ')).toBe('молоко')
    expect(matcher.gloss('ավազ կատուն')).toBe('песок кошка')
    expect(matcher.gloss('ԻԳԻԹ')).toBe('')
  })
})

describe('a printed heading ruling an item out (MOL-255, В-6 «б»)', () => {
  it('rules out an item none of whose headings is the line’s: brushes are no tomatoes', () => {
    expect(headingRulesOut('9603', ['0702'])).toBe(true)
  })

  it('must not rule out the line’s own heading, one OCR swap of it, or one of several', () => {
    expect(headingRulesOut('0702', ['0702'])).toBe(false)
    expect(headingRulesOut('0705', ['0702', '0706'])).toBe(false)
    expect(headingRulesOut('1906', ['1905'])).toBe(false)
  })

  it('must not rule out by no heading, a class of services, or an item with none', () => {
    expect(headingRulesOut(null, ['0702'])).toBe(false)
    expect(headingRulesOut('56.10', ['0702'])).toBe(false)
    expect(headingRulesOut('9603', [])).toBe(false)
  })
})
