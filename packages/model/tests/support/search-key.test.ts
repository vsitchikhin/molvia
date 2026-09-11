import { describe, expect, it } from 'vitest'
import { toSearchKey } from '#model/support/search-key'
import { visibleLine } from '#model/support/text'

describe('toSearchKey', () => {
  it('folds case, so the same name typed three ways is one key', () => {
    expect(toSearchKey('МОЛОКО')).toBe('moloko')
    expect(toSearchKey('Молоко')).toBe('moloko')
    expect(toSearchKey('молоко')).toBe('moloko')
  })

  it('drops diacritics but keeps the letter under them', () => {
    // A mark after a letter is ordinary text — «Молокó» is a name someone types, and café
    // is printed on the package itself.
    expect(toSearchKey('Молокó')).toBe('moloko')
    expect(toSearchKey('café')).toBe('cafe')
  })

  it('keeps digits and turns everything else into a word boundary', () => {
    // Digits are what one packaging differs from another by, so they stay.
    expect(toSearchKey('Молоко 3,2% 1л')).toBe('moloko 3 2 1l')
    expect(toSearchKey('Кока-кола   0.5')).toBe('koka kola 0 5')
    expect(toSearchKey('  Творог  ')).toBe('tvorog')
  })

  it('lands both halves of every fork on the same key', () => {
    // The whole point of the table: whichever spelling the person reaches for, the key is
    // the same one the catalogue stored.
    expect(toSearchKey('Жигули')).toBe(toSearchKey('zhiguli'))
    expect(toSearchKey('Жигули')).toBe(toSearchKey('jiguli'))
    expect(toSearchKey('Цукаты')).toBe(toSearchKey('tsukaty'))
    expect(toSearchKey('Цукаты')).toBe(toSearchKey('cukati'))
    expect(toSearchKey('Ашхар')).toBe(toSearchKey('ashkhar'))
    expect(toSearchKey('Ашхар')).toBe(toSearchKey('ashhar'))
    expect(toSearchKey('Щербет')).toBe(toSearchKey('shcherbet'))
    expect(toSearchKey('Щербет')).toBe(toSearchKey('scherbet'))
    expect(toSearchKey('Йогурт')).toBe(toSearchKey('yogurt'))
    expect(toSearchKey('Йогурт')).toBe(toSearchKey('iogurt'))
  })

  it('collapses doubled letters, because doubling is a fork of its own', () => {
    expect(toSearchKey('Анна')).toBe('ana')
    expect(toSearchKey('Anna')).toBe('ana')
    expect(toSearchKey('Ана')).toBe('ana')
    expect(toSearchKey('Нутелла')).toBe(toSearchKey('Nutella'))
  })

  it('does not collapse doubled digits: 22 is not 2', () => {
    expect(toSearchKey('Сок 22')).toBe('sok 22')
  })

  it('leaves a name that was already Latin alone', () => {
    // The fold must only ever touch a fork. If it starts rewriting ordinary Latin, it
    // breaks every name that came in that way to begin with.
    for (const name of ['moloko', 'kefir', 'lavash', 'basturma']) {
      expect(toSearchKey(name)).toBe(name)
    }
  })

  it('is idempotent: a query normalised twice is the query normalised once', () => {
    // The query passes through the route and then through the repository; neither may
    // change the answer of the other.
    for (const text of ['Молоко Ашхар 3,2%', 'shcherbet', 'Цыплёнок', 'Coca-Cola', '!!!']) {
      expect(toSearchKey(toSearchKey(text))).toBe(toSearchKey(text))
    }
  })

  it('never returns empty for a name visibleLine accepts', () => {
    // `visibleLine` lets a punctuation-only name through — those are visible characters.
    // An empty key would then make the item unbuildable inside the server.
    for (const name of ['!!!', '«»', '№']) {
      expect(visibleLine(200).parse(name)).toBe(name)
      expect(toSearchKey(name)).not.toBe('')
    }
  })

  it('returns empty for empty input rather than inventing something', () => {
    expect(toSearchKey('')).toBe('')
    expect(toSearchKey('   ')).toBe('')
  })

  it('stays inside visibleLine(800) at the longest name the schema allows', () => {
    // 200 is the name limit; «щ» and «ч» expand twofold, which is the widest the table
    // goes, so the key of the longest possible name is 400 — half the headroom the item
    // schema reserves.
    const key = toSearchKey('щ'.repeat(200))
    expect(key).toHaveLength(400)
    expect(() => visibleLine(800).parse(key)).not.toThrow()
    expect(toSearchKey('ч'.repeat(200))).toHaveLength(400)
  })

  it('handles a one-character name', () => {
    expect(toSearchKey('я')).toBe('ia')
    expect(toSearchKey('о')).toBe('o')
  })

  it('lets a script it does not know keep itself instead of dropping it', () => {
    // Georgian has no table here. Dropping its letters would produce an empty key.
    expect(toSearchKey('ხაჭაპური')).toBe('ხაჭაპური')
  })
})
