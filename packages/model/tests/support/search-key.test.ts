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
    // change the answer of the other. A migration that recomputes the column reads the
    // stored key, so the same property is what keeps that from rewriting half the rows.
    for (const text of ['Молоко Ашхар 3,2%', 'shcherbet', 'Цыплёнок', 'Coca-Cola', '!!!']) {
      expect(toSearchKey(toSearchKey(text))).toBe(toSearchKey(text))
    }
  })

  it('is idempotent by enumeration, not by a handful of literals', () => {
    // Five stable literals passed while `Bakkhus`, `CX-5` and «ккх» did not: a replacement
    // and the character before it spelled the pattern again, and the expanding rules fed
    // the ones that had already run. Enumeration is what makes this a property test, and
    // it is also what pins FOLD_PASSES — a rule needing a fifth pass turns this red.
    // Written out rather than spread from a string: the letters that make forks, on both
    // sides of the table.
    const alphabet = [
      'c',
      'k',
      'h',
      'q',
      'x',
      'w',
      'y',
      'z',
      's',
      'g',
      't',
      'p',
      'ц',
      'к',
      'х',
      'ш',
      'ч',
      'щ',
      'ж',
      'т',
      'с',
      'г',
      'п',
      'з',
    ]
    for (const a of alphabet) {
      for (const b of alphabet) {
        for (const c of alphabet) {
          const once = toSearchKey(a + b + c)
          expect(toSearchKey(once), a + b + c).toBe(once)
        }
      }
    }
  })

  it('closes the counterexamples that the literal list missed', () => {
    for (const text of ['Bakkhus', 'ккх', 'цx', 'cck', 'qh', 'CX-5', 'Mazda CX-30', 'ццк']) {
      const once = toSearchKey(text)
      expect(toSearchKey(once), text).toBe(once)
    }
    expect(toSearchKey('Bakkhus')).toBe('bahus')
    expect(toSearchKey('Mazda CX-30')).toBe('mazda ks 30')
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
    // Including the separators that do not look like ones. The guarantee «a key is never
    // empty» lives in the order of two calls, not in this function: `visibleLine` refuses
    // such a name first, and every write path has to run it before taking the key.
    expect(toSearchKey('')).toBe('')
    expect(toSearchKey('   ')).toBe('')
    expect(toSearchKey(' ')).toBe('')
    expect(toSearchKey('　 ')).toBe('')
  })

  it('tidies the fallback the same way it tidies a real key', () => {
    // Otherwise this one key in the whole catalogue would carry zero-width characters and
    // uncollapsed whitespace, and sit in the column under different rules than its
    // neighbours: «а   б» gives `a b`, so «!   ?» has to give `! ?`.
    expect(toSearchKey('!   ?')).toBe('! ?')
    expect(toSearchKey('!​!')).toBe('!!')
  })

  it('has no row that NFD makes unreachable', () => {
    // «ў» decomposes into «у» plus a breve, and the mark is stripped before the table is
    // consulted — a row for it could never fire, so it is not in the table. It lands on
    // the same `u` Latin does.
    expect(toSearchKey('ў')).toBe('u')
    expect(toSearchKey('Ваўкавыск')).toBe(toSearchKey('Vaukavysk'))
  })

  it('stays inside visibleLine(800) at the longest name the schema allows', () => {
    // 200 is the name limit. The tables double at most — but they are not the widest path:
    // NFD decomposes a precomposed Hangul syllable into three jamo, and jamo are letters,
    // so nothing strips them. The real ceiling is threefold, and the headroom the item
    // schema reserves is 200 characters rather than the 400 the alphabet alone suggests.
    expect(toSearchKey('щ'.repeat(200))).toHaveLength(400)
    expect(toSearchKey('ч'.repeat(200))).toHaveLength(400)

    const widest = toSearchKey('각'.repeat(200))
    expect(widest).toHaveLength(600)
    expect(() => visibleLine(800).parse(widest)).not.toThrow()
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

describe('toSearchKey · армянский', () => {
  it('brings all three scripts of one name to the same key', () => {
    // The point of the Armenian table: a label on the shelf is found by a Russian query
    // and by a Latin one without the person knowing which script the catalogue holds.
    expect(toSearchKey('Գյումրի')).toBe('giumri')
    expect(toSearchKey('Гюмри')).toBe('giumri')
    expect(toSearchKey('Gyumri')).toBe('giumri')

    expect(toSearchKey('Չանախ')).toBe(toSearchKey('Чанах'))
    expect(toSearchKey('Չանախ')).toBe(toSearchKey('Chanakh'))
    expect(toSearchKey('Մածուն')).toBe(toSearchKey('Мацун'))
    expect(toSearchKey('Մածուն')).toBe(toSearchKey('Matsun'))
  })

  it('resolves the two-code-point letters before the per-character pass', () => {
    // Left to that pass «ու» would come out as `ov`, and «և» as a letter nothing knows.
    expect(toSearchKey('ու')).toBe('u')
    expect(toSearchKey('Երևան')).toBe('erevan')
    expect(toSearchKey('Երևան')).toBe(toSearchKey('Ереван'))
  })

  it('folds the Armenian case, including the uppercase digraph', () => {
    expect(toSearchKey('ՄԱԾՈՒՆ')).toBe(toSearchKey('Մածուն'))
  })

  it('lands gh on the same key, which is why the fold learned it', () => {
    expect(toSearchKey('Ղափամա')).toBe(toSearchKey('Ghapama'))
    expect(toSearchKey('Ղափամա')).toBe('gapama')
  })

  it('collapses the aspirated pairs on purpose', () => {
    // A Russian speaker does not hear the distinction and will not type it either.
    for (const [plain, aspirated] of [
      ['պ', 'փ'],
      ['կ', 'ք'],
      ['տ', 'թ'],
      ['ծ', 'ց'],
      ['ճ', 'չ'],
      ['ռ', 'ր'],
    ]) {
      expect(toSearchKey(plain!)).toBe(toSearchKey(aspirated!))
    }
  })
})
