import { describe, expect, it } from 'vitest'
import { toSearchKey } from '#model/support/search-key'
import {
  ADJECTIVE_WORD,
  SYNONYM_TABLES,
  WORD_BREAK,
  kindKey,
  synonymDescribes,
  synonymKeys,
  synonymPairedKinds,
} from '#model/support/synonyms'

const key = toSearchKey
const { same, narrower, paired } = SYNONYM_TABLES
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

  it('takes a noun with an adjective ending for the kind: «Пирожное Картошка» is a cake (review Р)', () => {
    expect(kindKey('Пирожное Картошка')).toBe(key('пирожное'))
    expect(kindKey('МОРОЖЕНОЕ пломбир')).toBe(key('мороженое'))
    expect(kindKey('Шоколадное пирожное')).toBe(key('пирожное'))
  })

  it('is empty when every word describes, and a brand first stays first — the price, named', () => {
    expect(kindKey('Свежее')).toBe('')
    expect(kindKey('Barilla спагетти')).toBe(key('barilla'))
  })
})

describe('synonymDescribes', () => {
  it('knows a synonym that describes, which counts as any word of a name', () => {
    expect(synonymDescribes(key('минеральная'))).toBe(true)
    expect(synonymDescribes(key('газированная'))).toBe(true)
    // An adjective of a group of the same thing counts as the kind only (review С).
    expect(synonymDescribes(key('гречневая'))).toBe(false)
    expect(synonymDescribes(key('картофель'))).toBe(false)
    expect(synonymDescribes(key('вода'))).toBe(false)
  })
})

describe('WORD_BREAK', () => {
  it('holds every White_Space code point — the one class the domain and Postgres both split by', () => {
    const breaks = new RegExp(`^${WORD_BREAK}$`, 'u')
    const space = /^\p{White_Space}$/u
    // Collected and compared once: an assertion per code point is a million of them, and CI
    // ran out of its five seconds on the walk.
    const apart: string[] = []
    for (let code = 0; code <= 0x10ffff; code += 1) {
      const char = String.fromCodePoint(code)
      if (breaks.test(char) !== space.test(char)) apart.push(code.toString(16))
    }
    expect(apart).toEqual([])
  })

  it('splits a name at a no-break space, as the key does (review У)', () => {
    expect(kindKey('Молодой\u00a0картофель')).toBe(key('картофель'))
    expect(kindKey('\u00a0Копчёная\u202fскумбрия ')).toBe(key('скумбрия'))
  })
})

describe('an adjective of a group, beside a kind of its own (review Ф, Ц)', () => {
  it('names the kinds it counts beside, and none for any other word', () => {
    expect(synonymPairedKinds(key('гречневая'))).toEqual([key('крупа'), key('крупы')])
    expect(synonymPairedKinds(key('сгущённое'))).toEqual([key('молоко')])
    expect(synonymPairedKinds(key('овсяные'))).toContain(key('хлопья'))
    expect(synonymPairedKinds(key('минеральная'))).toEqual([])
    expect(synonymPairedKinds(key('гречка'))).toEqual([])
  })

  it('pairs every adjective of a group, and nothing outside one — an unpaired one is a dead target', () => {
    const adjective = new RegExp(ADJECTIVE_WORD, 'u')
    // Said, never printed: «синенькие» is a query word for the aubergines, not a target.
    const spoken = new Set([key('синенькие')])
    const inGroups = new Set(
      same
        .flat()
        .filter((word) => adjective.test(word))
        .map(key)
        .filter((word) => !spoken.has(word)),
    )
    const pairedAdjectives = new Set(paired.flatMap(([adjectives]) => adjectives).map(key))
    const grouped = new Set(same.flat().map(key))
    for (const word of inGroups) expect(pairedAdjectives.has(word), word).toBe(true)
    for (const word of pairedAdjectives) expect(grouped.has(word), word).toBe(true)
  })

  it('pairs with kinds, never with an adjective — the kind skips adjectives', () => {
    const adjective = new RegExp(ADJECTIVE_WORD, 'u')
    for (const kind of paired.flatMap(([, kinds]) => kinds)) {
      expect(adjective.test(kind), kind).toBe(false)
      expect(kindKey(kind), kind).toBe(key(kind))
    }
  })
})
