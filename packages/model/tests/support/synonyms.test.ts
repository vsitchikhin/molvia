import { describe, expect, it } from 'vitest'
import { toSearchKey } from '#model/support/search-key'
import { SYNONYM_TABLES, kindKey, synonymDescribes, synonymKeys } from '#model/support/synonyms'

const key = toSearchKey
const { same, narrower } = SYNONYM_TABLES
const heads = narrower.flatMap(([from]) => from)
const tails = narrower.flatMap(([, to]) => to)
const every = [...same.flat(), ...heads, ...tails]

describe('synonymKeys', () => {
  it('reaches what the shelf writes for the six words MOL-14 missed', () => {
    expect(synonymKeys(key('картошка'))).toContain(key('картофель'))
    expect(synonymKeys(key('булки'))).toContain(key('булочки'))
    expect(synonymKeys(key('бритва'))).toContain(key('станки'))
    expect(synonymKeys(key('отбеливатель'))).toContain(key('белизна'))
    expect(synonymKeys(key('орешки'))).toEqual(
      expect.arrayContaining([key('арахис'), key('фисташки')]),
    )
    expect(synonymKeys(key('мясо'))).toContain(key('фарш'))
  })

  it('knows the forms people type, not only the dictionary one: «селёдку», «хлеба»', () => {
    // A form left out misses where the target is far in letters — `seledku` against `seld`.
    expect(synonymKeys(key('селёдку'))).toContain(key('сельдь'))
    expect(synonymKeys(key('хлеба'))).toContain(key('лаваш'))
    expect(synonymKeys(key('колбасы'))).toContain(key('сервелат'))
    expect(synonymKeys(key('помидора'))).toContain(key('томаты'))
  })

  it('works both ways inside a group of the same thing', () => {
    expect(synonymKeys(key('картофель'))).toContain(key('картошка'))
    expect(synonymKeys(key('белизна'))).toContain(key('отбеливатель'))
  })

  it('never leads from a narrower word back to the wider one, or across to its neighbour', () => {
    // A peanut is not a pistachio: «арахис» asked for is «арахис» found.
    expect(synonymKeys(key('арахис'))).toEqual([])
    expect(synonymKeys(key('фарш'))).toEqual([])
    expect(synonymKeys(key('подгузники'))).not.toContain(key('памперсы'))
  })

  it('takes the key, so a word typed in Latin expands as the Cyrillic one does', () => {
    expect(synonymKeys(key('kartoshka'))).toEqual(synonymKeys(key('картошка')))
  })

  it('looks a word up exactly — a neighbour by one edit is another word', () => {
    // `belki` is one edit from `bulki`: with a budget, proteins would find buns.
    expect(synonymKeys(key('белки'))).toEqual([])
    // The price, named: a typo in the synonym itself is not expanded.
    expect(synonymKeys(key('картошак'))).toEqual([])
    // Nor is an unfinished word — the search expands what was typed in full.
    expect(synonymKeys(key('картош'))).toEqual([])
  })

  it('never hands a word itself back', () => {
    for (const word of every) expect(synonymKeys(key(word)), word).not.toContain(key(word))
  })
})

describe('the synonym tables', () => {
  it('hold single words, each with a key of letters only', () => {
    // The search compares word against word: a phrase here would never meet a name.
    for (const word of every) expect(key(word), word).toMatch(/^\p{L}+$/u)
  })

  it('name no brand as a target — a brand is Latin on the shelf, and none is written here', () => {
    // A target is a kind of product. Expanding into a maker's name would hand it a place in
    // the results (MOL-45, Р-2). Cyrillic brands are held by review; «белизна» is a kind.
    for (const word of [...same.flat(), ...tails]) expect(word, word).toMatch(/^[а-яё]+$/u)
  })

  it('put every word in one group only, so what a word means is never a matter of order', () => {
    const owner = new Map<string, number>()
    same.forEach((group, index) => {
      for (const word of group) {
        // «сгущенка» and «сгущёнка» share a key, and they are one group.
        expect(owner.get(key(word)) ?? index, word).toBe(index)
        owner.set(key(word), index)
      }
    })
    for (const word of heads) expect(owner.has(key(word)), word).toBe(false)
    expect(new Set(heads.map(key)).size).toBe(heads.length)
  })

  it('keep words of different groups on different keys — the alphabet folds, and must not merge two here', () => {
    const byKey = new Map<string, Set<string>>()
    const groups = [...same, ...narrower.map(([from]) => from)]
    groups.forEach((group, index) => {
      for (const word of group) {
        const seen = byKey.get(key(word)) ?? new Set<string>()
        seen.add(String(index))
        byKey.set(key(word), seen)
      }
    })
    for (const [folded, owners] of byKey) expect(owners.size, folded).toBe(1)
  })
})

describe('kindKey', () => {
  it('is the first word of a name, where a shelf writes the kind', () => {
    expect(kindKey('Вода Джермук 0,5 л')).toBe(key('вода'))
    expect(kindKey('Корм для кошек Whiskas тунец')).toBe(key('корм'))
  })

  it('skips the adjectives before it: «Молодой картофель», «Копчёная скумбрия» (review Н)', () => {
    expect(kindKey('Молодой картофель')).toBe(key('картофель'))
    expect(kindKey('Копчёная скумбрия')).toBe(key('скумбрия'))
    expect(kindKey('АРМЯНСКИЙ ЛАВАШ')).toBe(key('лаваш'))
    expect(kindKey('Свежие маринованные огурчики')).toBe(key('огурчики'))
  })

  it('reads the adjective off the name, not the key, where «солёный» ends like «огурцы»', () => {
    expect(kindKey('Огурцы солёные')).toBe(key('огурцы'))
    expect(kindKey('Фисташки жареные')).toBe(key('фисташки'))
  })

  it('is empty when every word describes, and a brand first stays first — the price, named', () => {
    expect(kindKey('Свежее')).toBe('')
    expect(kindKey('Barilla спагетти')).toBe(key('barilla'))
  })
})

describe('synonymDescribes', () => {
  it('knows a synonym that describes, which counts as any word of a name', () => {
    expect(synonymDescribes(key('минеральная'))).toBe(true)
    expect(synonymDescribes(key('гречневая'))).toBe(true)
    expect(synonymDescribes(key('картофель'))).toBe(false)
    expect(synonymDescribes(key('вода'))).toBe(false)
  })
})
