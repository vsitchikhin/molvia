import { describe, expect, it } from 'vitest'
import { createLineMatcher, receiptWords } from '#model/entities/receipt-match'
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
const WORDS = { կաթ: 'молоко', կատու: 'кошка', կատվի: 'кошка', ավազ: 'песок' }
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
    expect(matcher.match('Կաթ «Իգիթ» 3.2% 1լ', '0401')).toEqual({
      itemId: 'Молоко 3,2%',
      far: false,
    })
    expect(matcher.match('Կաթ «Իգիթ» 1լ', '0401')).toEqual({ itemId: 'Молоко', far: false })
  })

  it('takes a word one edit off, and a word the till cut', () => {
    expect(matcher.match('Շոկալադ «Գրանդ»', null)?.itemId).toBe('Шоколад')
    expect(matcher.match('Թխվածքաբլ. կարագով', null)?.itemId).toBe('Печенье')
  })

  it('rules out by the heading what the line cannot be, a swapped digit of it allowed', () => {
    // milk is no glue: what is left is the heading's one item, far
    expect(matcher.match('Կաթ', '3506')).toEqual({ itemId: 'Клей', far: true })
    expect(matcher.match('Կաթ', '9999')).toBeNull()
    expect(matcher.match('Թխվածքաբլիթ', '1906')?.itemId).toBe('Печенье')
  })

  it('needs every word of a name', () => {
    expect(matcher.match('կովի միս', null)).toBeNull()
  })

  it('falls back to the heading: one item left, or the one sharing a stem with the gloss — far', () => {
    expect(matcher.match('ՏՈՖՈՒ ՀՈՂ', '3824')).toEqual({
      itemId: 'Наполнитель для лотка',
      far: true,
    })
    expect(matcher.match('ՎԻՆՆԻ կատու', '2309')).toEqual({ itemId: 'Корм для кошек', far: true })
    expect(matcher.match('ՎԻՆՆԻ', '2309')).toBeNull()
    // a swapped digit rules out, never chooses: 3824 read as 8824 chooses nothing
    expect(matcher.match('ՏՈՖՈՒ ՀՈՂ', '8824')).toBeNull()
  })

  it('finds nothing in a line with no Armenian word and no heading', () => {
    expect(matcher.match('Coca-Cola 1.5L', null)).toBeNull()
  })
})

describe('the gloss', () => {
  it('reads the known words, one edit off too, and drops the rest', () => {
    expect(matcher.gloss('ԿԱԹ ԻԳԻԹ')).toBe('молоко')
    expect(matcher.gloss('ավազ կատուն')).toBe('песок кошка')
    expect(matcher.gloss('ԻԳԻԹ')).toBe('')
  })
})
