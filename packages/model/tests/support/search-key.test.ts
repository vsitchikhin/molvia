import { describe, expect, it } from 'vitest'
import {
  SEARCH_KEY_TABLES,
  nameIdentity,
  toSearchKey,
  unfinishedFoldSpellings,
} from '#model/support/search-key'
import { INVISIBLE, visibleLine } from '#model/support/text'

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
    // `kafe`, not `cafe`: the mark goes, and then the hard c of MOL-11 applies.
    expect(toSearchKey('café')).toBe('kafe')
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
    // Latin c stands for ц only where it is soft; before a, o, u it is k since MOL-11, and
    // that half of the fork is pinned as a limit in the corpus file.
    expect(toSearchKey('Цена')).toBe(toSearchKey('cena'))
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

  it('reaches a fixed point on runs that need more than a handful of passes', () => {
    // The three-character enumeration cannot reach this: the shortest string that fails a
    // capped loop is eight characters, and the depth grows with the length of the name.
    // `с` + six `ч` becomes `s` + `chchchch`, and `shch → sh` takes one bite per pass.
    for (const text of [
      'xcqhchch',
      'scqhchch',
      'xчччч',
      'сччччч',
      'xцhчччw',
      'сччччччч',
      `с${'ч'.repeat(12)}`,
      `с${'ч'.repeat(60)}`,
      `x${'ч'.repeat(99)}`,
    ]) {
      const once = toSearchKey(text)
      expect(toSearchKey(once), text).toBe(once)
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

  it('agrees with visibleLine about what counts as content', () => {
    // Four Hangul fillers are letters *and* default-ignorable. `visibleLine` strips them
    // before asking whether anything is left, so «ㅤ!» is a valid name — while the key kept
    // the filler and nothing else, and the same `visibleLine` refused it at 800. A valid
    // name whose key its own schema rejects is the unbuildable item, arriving through the
    // front door rather than through the empty key this fallback was built for.
    for (const filler of ['ᅟ', 'ᅠ', 'ㅤ', 'ﾠ']) {
      const name = `${filler}!`
      expect(visibleLine(200).safeParse(name).success, name).toBe(true)
      expect(toSearchKey(name)).toBe('!')
      expect(visibleLine(800).safeParse(toSearchKey(name)).success, name).toBe(true)
    }
  })

  it('agrees with visibleLine for every character that draws nothing, not a chosen four', () => {
    // MOL-27: U+13441 joined the name's measure and not the key's, and «𓑁!» — a valid name —
    // got a key its own schema refused: a 500. Every code point the name's measure strips,
    // in front of a visible «!», must give a key that parses back.
    const name = visibleLine(200)
    const key = visibleLine(800)
    // Built from the list itself, so a character added to it later is walked too (С-23).
    const strips = new RegExp(`[\\p{Z}\\p{M}${INVISIBLE}]`, 'u')
    const broken: string[] = []
    for (let code = 0; code <= 0x10ffff; code += 1) {
      if (code >= 0xd800 && code <= 0xdfff) continue
      const char = String.fromCodePoint(code)
      if (!strips.test(char)) continue
      const candidate = `${char}!`
      if (!name.safeParse(candidate).success) continue
      if (!key.safeParse(toSearchKey(candidate)).success) broken.push(code.toString(16))
    }
    expect(broken).toEqual([])
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
    // Hebrew has no table here. Dropping its letters would produce an empty key.
    expect(toSearchKey('חלב')).toBe('חלב')
  })
})

describe('toSearchKey · грузинский и сербский (MOL-109)', () => {
  it('brings a Georgian name to the key of its Russian and Latin spellings', () => {
    expect(toSearchKey('ხაჭაპური')).toBe(toSearchKey('хачапури'))
    expect(toSearchKey('ბორჯომი')).toBe(toSearchKey('Боржоми'))
    expect(toSearchKey('ბორჯომი')).toBe(toSearchKey('Borjomi'))
    expect(toSearchKey('ჩურჩხელა')).toBe(toSearchKey('чурчхела'))
  })

  it('reads Mtavruli capitals as the letters they are', () => {
    expect(toSearchKey('ᲩᲘᲖᲘ')).toBe(toSearchKey('ჩიზი'))
  })

  it('makes one key of a Serbian word in Cyrillic, in Latin and in Russian', () => {
    for (const [cyrillic, latin, russian] of [
      ['ћевапи', 'ćevapi', 'чевапи'],
      ['чоколада', 'čokolada', 'чоколада'],
      ['џем', 'džem', 'джем'],
      ['шунка', 'šunka', 'шунка'],
      ['жито', 'žito', 'жито'],
    ] as const) {
      expect(toSearchKey(latin), latin).toBe(toSearchKey(cyrillic))
      expect(toSearchKey(russian), russian).toBe(toSearchKey(cyrillic))
    }
    for (const [cyrillic, latin] of [
      ['шљиве', 'šljive'],
      ['ђумбир', 'đumbir'],
      ['њоки', 'njoki'],
      ['ајвар', 'ajvar'],
      ['ћевапчићи', 'ćevapčići'],
    ] as const) {
      expect(toSearchKey(latin), latin).toBe(toSearchKey(cyrillic))
    }
  })

  it('reads a háček or an acute whether the letter came precomposed or decomposed', () => {
    for (const [precomposed, base, mark] of [
      ['č', 'c', 0x30c],
      ['ć', 'c', 0x301],
      ['š', 's', 0x30c],
      ['ž', 'z', 0x30c],
    ] as const) {
      const decomposed = `${base}${String.fromCodePoint(mark)}`
      expect(toSearchKey(`${precomposed}ips`)).toBe(toSearchKey(`${decomposed}ips`))
      expect(toSearchKey(`${precomposed.toUpperCase()}ips`)).toBe(toSearchKey(`${decomposed}ips`))
    }
    expect(toSearchKey('Čips')).toBe(toSearchKey('чипс'))
    expect(toSearchKey('Đumbir')).toBe(toSearchKey('ђумбир'))
  })

  it('the price, pinned: a Latin c and ј against Russian stay one edit apart, not one key (замечание 3)', () => {
    // Serbian c is always ц, but a Latin c is decided by the letter after it (MOL-11) — before a, o, u
    // it is k, for Coca-Cola — and ј is j as its Latin, where Russian й is i and я ia. The tables are
    // frozen and the fold has no language to tell Serbian from English: found within an edit, «рядом».
    expect([toSearchKey('pljeskavica'), toSearchKey('пљескавица')]).toEqual([
      'pljeskavika',
      'pljeskaviцa',
    ])
    expect([toSearchKey('ајвар'), toSearchKey('айвар')]).toEqual(['ajvar', 'aivar'])
    expect([toSearchKey('ракија'), toSearchKey('ракия')]).toEqual(['rakija', 'rakia'])
  })

  it('the price of В-1, pinned: Serbian Latin typed without its marks is not the label’s key (В-4, А1)', () => {
    // One key cannot be both «чевапчичи» and «cevapcici»: «č» is «ч» and a bare «c» at once. The
    // owner chose the Russian query (В-4 «а», 04.10.2026); a whole word typed bare is found by meaning.
    expect([toSearchKey('Ćevapčići'), toSearchKey('cevapcici')]).toEqual([
      'chevapchichi',
      'цevapцiцi',
    ])
    expect([toSearchKey('Šećer'), toSearchKey('secer')]).toEqual(['shecher', 'seцer'])
    expect(toSearchKey('Ćevapčići')).toBe(toSearchKey('чевапчичи'))
  })

  it('reads a háček past what draws nothing, as `nameIdentity` does (adversarial А4)', () => {
    const zeroWidth = String.fromCodePoint(0x200b)
    const softHyphen = String.fromCodePoint(0xad)
    const wordJoiner = String.fromCodePoint(0x2060)
    const caron = String.fromCodePoint(0x30c)
    for (const [plain, hidden] of [
      ['Čaj', `C${zeroWidth}${caron}aj`],
      ['Žito', `Z${softHyphen}${caron}ito`],
      ['Šljiva', `S${wordJoiner}${caron}ljiva`],
    ] as const) {
      expect(nameIdentity(hidden), plain).toBe(nameIdentity(plain))
      expect(toSearchKey(hidden), plain).toBe(toSearchKey(plain))
    }
  })

  it('leaves the other marks of Latin as they were: an acute on s or a caron on e is stripped', () => {
    // Only the four Serbian letters are letters of their own; Polish ś, Czech ě keep what NFD gives.
    expect(toSearchKey('ślad')).toBe('slad')
    expect(toSearchKey('něco')).toBe('neko')
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

/**
 * The tables are frozen: an edit after the first row is written is a migration with a
 * recompute, so a wrong line does not live until the next sprint, it lives forever. This
 * block is the second copy that has to agree — a change to the alphabet then shows up in
 * the diff of a test, not only in the diff of the data.
 */
describe('полнота таблиц', () => {
  // Wrapped in digits: they are never folded and never collapsed, so the wrapper cannot
  // take part in the answer. An empty value is a real expectation — «ъ» carries none.
  const through = (letter: string) => toSearchKey(`7${letter}7`).slice(1, -1)

  const CYRILLIC: readonly (readonly [string, string])[] = [
    ['а', 'a'],
    ['б', 'b'],
    ['в', 'v'],
    ['г', 'g'],
    ['д', 'd'],
    ['е', 'e'],
    ['ё', 'e'],
    ['ж', 'j'],
    ['з', 'z'],
    ['и', 'i'],
    ['й', 'i'],
    ['к', 'k'],
    ['л', 'l'],
    ['м', 'm'],
    ['н', 'n'],
    ['о', 'o'],
    ['п', 'p'],
    ['р', 'r'],
    ['с', 's'],
    ['т', 't'],
    ['у', 'u'],
    ['ф', 'f'],
    ['х', 'h'],
    ['ц', 'ц'],
    ['ч', 'ch'],
    ['ш', 'sh'],
    ['щ', 'sh'],
    ['ъ', ''],
    ['ы', 'i'],
    ['ь', ''],
    ['э', 'e'],
    ['ю', 'iu'],
    ['я', 'ia'],
    ['і', 'i'],
    ['ї', 'i'],
    ['є', 'e'],
    ['ґ', 'g'],
    ['ђ', 'dj'],
    ['ј', 'j'],
    ['љ', 'lj'],
    ['њ', 'nj'],
    ['ћ', 'ch'],
    ['џ', 'dj'],
  ]

  const ARMENIAN: readonly (readonly [string, string])[] = [
    ['ա', 'a'],
    ['բ', 'b'],
    ['գ', 'g'],
    ['դ', 'd'],
    ['ե', 'e'],
    ['զ', 'z'],
    ['է', 'e'],
    ['ը', 'e'],
    ['թ', 't'],
    ['ժ', 'j'],
    ['ի', 'i'],
    ['լ', 'l'],
    ['խ', 'h'],
    ['ծ', 'ц'],
    ['կ', 'k'],
    ['հ', 'h'],
    ['ձ', 'j'],
    ['ղ', 'g'],
    ['ճ', 'ch'],
    ['մ', 'm'],
    ['յ', 'i'],
    ['ն', 'n'],
    ['շ', 'sh'],
    ['ո', 'o'],
    ['չ', 'ch'],
    ['պ', 'p'],
    ['ջ', 'j'],
    ['ռ', 'r'],
    ['ս', 's'],
    ['վ', 'v'],
    ['տ', 't'],
    ['ր', 'r'],
    ['ց', 'ц'],
    ['ւ', 'v'],
    ['փ', 'p'],
    ['ք', 'k'],
    ['օ', 'o'],
    ['ֆ', 'f'],
  ]

  const GEORGIAN: readonly (readonly [string, string])[] = [
    ['ა', 'a'],
    ['ბ', 'b'],
    ['გ', 'g'],
    ['დ', 'd'],
    ['ე', 'e'],
    ['ვ', 'v'],
    ['ზ', 'z'],
    ['თ', 't'],
    ['ი', 'i'],
    ['კ', 'k'],
    ['ლ', 'l'],
    ['მ', 'm'],
    ['ნ', 'n'],
    ['ო', 'o'],
    ['პ', 'p'],
    ['ჟ', 'j'],
    ['რ', 'r'],
    ['ს', 's'],
    ['ტ', 't'],
    ['უ', 'u'],
    ['ფ', 'p'],
    ['ქ', 'k'],
    ['ღ', 'g'],
    ['ყ', 'k'],
    ['შ', 'sh'],
    ['ჩ', 'ch'],
    ['ც', 'ц'],
    ['ძ', 'dz'],
    ['წ', 'ц'],
    ['ჭ', 'ch'],
    ['ხ', 'h'],
    ['ჯ', 'j'],
    ['ჰ', 'h'],
  ]

  const LATIN: readonly (readonly [string, string])[] = [['đ', 'dj']]

  const LATIN_MARKED: readonly (readonly [string, string])[] = [
    ['č', 'ch'],
    ['ć', 'ch'],
    ['š', 'sh'],
    ['ž', 'j'],
  ]

  it.each(CYRILLIC)('кириллица: «%s» даёт «%s»', (letter, expected) => {
    expect(through(letter)).toBe(expected)
  })

  it.each(ARMENIAN)('армянский: «%s» даёт «%s»', (letter, expected) => {
    expect(through(letter)).toBe(expected)
  })

  it.each(GEORGIAN)('грузинский: «%s» даёт «%s»', (letter, expected) => {
    expect(through(letter)).toBe(expected)
  })

  it.each([...LATIN, ...LATIN_MARKED])('латиница: «%s» даёт «%s»', (letter, expected) => {
    expect(through(letter)).toBe(expected)
  })

  it('перечисляет ровно те буквы, что лежат в исходнике', () => {
    // Walking the real keys, not this list: with a copied list a row *added* to the table
    // stays invisible, and the table is frozen — an addition is a migration too.
    expect(Object.keys(SEARCH_KEY_TABLES.cyrillic).sort()).toEqual(
      CYRILLIC.map(([letter]) => letter).sort(),
    )
    expect(Object.keys(SEARCH_KEY_TABLES.armenian).sort()).toEqual(
      ARMENIAN.map(([letter]) => letter).sort(),
    )
    expect(Object.keys(SEARCH_KEY_TABLES.georgian).sort()).toEqual(
      GEORGIAN.map(([letter]) => letter).sort(),
    )
    expect(Object.keys(SEARCH_KEY_TABLES.latin).sort()).toEqual(
      LATIN.map(([letter]) => letter).sort(),
    )
    expect(SEARCH_KEY_TABLES.latinMarked.map(([letter]) => letter.normalize('NFC')).sort()).toEqual(
      LATIN_MARKED.map(([letter]) => letter).sort(),
    )
  })

  it('не держит букву в двух таблицах сразу', () => {
    // The two are merged into one record, so a key in both would silently take the second
    // value. This is the same remark that closed MOL-4 about merging two ISSUE registries.
    const letters = [...CYRILLIC, ...ARMENIAN, ...GEORGIAN, ...LATIN].map(([letter]) => letter)
    expect(new Set(letters).size).toBe(letters.length)
  })

  it('держит значения уже сведёнными', () => {
    // A row written as `zh` or `ts` would work by accident — the fold would clean it up on
    // the way out. It must not be written that way: the table is the statement of record.
    for (const [letter, value] of [
      ...CYRILLIC,
      ...ARMENIAN,
      ...GEORGIAN,
      ...LATIN,
      ...LATIN_MARKED,
    ]) {
      for (const fork of ['zh', 'ts', 'kh', 'shch', 'sch', 'gh', 'ck', 'ph', 'x', 'q', 'w', 'y']) {
        expect(value, `«${letter}»`).not.toContain(fork)
      }
    }
  })
})

describe('пределы, записанные явно', () => {
  it('склеивает пары, которые на полке различаются', () => {
    // The corpus invariant «no two names share a key» is a statement about those 24 names,
    // not a property of the key. These are real confectionery brands, and they collide.
    expect(toSearchKey('Мишка')).toBe(toSearchKey('Мышка'))
    // «Ицхак» and «Ичак» used to be here too — ц+х and ч both gave `ch`. Since MOL-11 ц is
    // a letter of its own and the pair is apart.
    expect(toSearchKey('Ицхак')).not.toBe(toSearchKey('Ичак'))
  })

  it('схлопывает серию повторов без предела', () => {
    // A 200-character name becomes a one-character key, and a one-character key sits inside
    // the radius of most of the catalogue. Unreachable from a real shelf, pinned so that
    // nobody meets it by surprise while retuning the thresholds (MOL-47).
    expect(toSearchKey('ц'.repeat(200))).toBe('ц')
  })

  it('не переходит границу слова', () => {
    // Typing a name without the space is ordinary on a phone, and the key keeps the space.
    expect(toSearchKey('кокакола')).not.toBe(toSearchKey('Кока-кола'))
  })
})

// Review Р-23, Р-26 (MOL-128): a Latin tail that may still fold is spelt out, never cut off.
describe('unfinishedFoldSpellings', () => {
  it('spells the start of a fold out into what it folds into', () => {
    expect(unfinishedFoldSpellings('k')).toEqual(['h'])
    expect(unfinishedFoldSpellings('bors')).toEqual(['borsh'])
    expect(unfinishedFoldSpellings('shc')).toEqual(expect.arrayContaining(['sh']))
    expect(unfinishedFoldSpellings('Z')).toEqual(['j'])
    expect(unfinishedFoldSpellings('p')).toEqual(['f'])
    expect(unfinishedFoldSpellings('c')).toEqual(expect.arrayContaining(['ц', 'ch']))
  })

  it('must not fire: a fold finished, a letter that folds alone, Cyrillic, nothing', () => {
    expect(unfinishedFoldSpellings('kh')).toEqual([])
    expect(unfinishedFoldSpellings('x')).toEqual([])
    expect(unfinishedFoldSpellings('сыр')).toEqual([])
    expect(unfinishedFoldSpellings('')).toEqual([])
  })

  it('every start of every fold is one, so a fold added is held too', () => {
    for (const [from, to] of SEARCH_KEY_TABLES.latinFolds) {
      for (let size = 1; size < from.length; size += 1) {
        expect(unfinishedFoldSpellings(from.slice(0, size))).toContain(to)
      }
    }
  })
})
