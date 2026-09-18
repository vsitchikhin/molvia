import { describe, expect, it } from 'vitest'
import { nameIdentity, toSearchKey } from '#model/support/search-key'

describe('nameIdentity', () => {
  it('treats case and spacing as the same name', () => {
    expect(nameIdentity('Сыр  чанах Ашхар ')).toBe(nameIdentity('сыр чанах ашхар'))
    expect(nameIdentity('MILO')).toBe(nameIdentity('milo'))
    expect(nameIdentity('Сыр\tчанах')).toBe(nameIdentity('Сыр чанах'))
    expect(nameIdentity('Сыр чанах')).toBe(nameIdentity('Сыр чанах'))
  })

  it('treats a composed and a decomposed letter as the same name', () => {
    expect(nameIdentity('Café')).toBe(nameIdentity('Café'))
  })

  it('treats what cannot be seen as absent, not as a space', () => {
    // A soft hyphen, a zero-width space, a byte-order mark from a pasted label: on the screen
    // «Молоко» either way, so a second item would be a twin nobody can tell apart.
    for (const hidden of ['­', '​', '﻿', '᠎', '⁠']) {
      expect(nameIdentity(`Моло${hidden}ко`), JSON.stringify(hidden)).toBe(nameIdentity('Молоко'))
    }
  })

  it('reads an Armenian label in capitals as the same name, whichever capital it uses', () => {
    // «և» has no capital of its own: `toUpperCase` writes «ԵՒ», a label may write «ԵՎ».
    const name = nameIdentity('Պանիր Երևան')
    expect(nameIdentity('ՊԱՆԻՐ ԵՐԵՎԱՆ')).toBe(name)
    expect(nameIdentity('ՊԱՆԻՐ ԵՐԵՒԱՆ')).toBe(name)
    expect(nameIdentity('Պանիր Երևան'.toUpperCase())).toBe(name)
  })

  it('reads «և», «եւ» and «եվ» as one spelling (the owner, MOL-12)', () => {
    expect(nameIdentity('Պանիր Երեւան')).toBe(nameIdentity('Պանիր Երևան'))
    expect(nameIdentity('Պանիր Երեվան')).toBe(nameIdentity('Պանիր Երևան'))
    expect(nameIdentity('Սև սուրճ')).toBe(nameIdentity('ՍԵՒ ՍՈՒՐՃ'))
  })

  it('must not fold a lone «ւ»: «ու» is a letter of its own', () => {
    expect(nameIdentity('Թթու')).not.toBe(nameIdentity('Թթով'))
  })

  it('composes a letter and its mark even with an invisible character between them', () => {
    // A decomposed «й» from a macOS clipboard, with a zero-width space from a web page.
    expect(nameIdentity('И\u200b\u0306огурт')).toBe(nameIdentity('Йогурт'))
  })

  it('must not merge what only the search key folds together', () => {
    // Same key, different goods: a merge here would answer «Milo» with the soap.
    for (const [one, other] of [
      ['Мыло', 'Milo'],
      ['Молоко 3.2%', 'Молоко 3,2%'],
      ['Կաթ', 'Քաթ'],
      ['Уголь', 'Угол'],
    ] as const) {
      expect(toSearchKey(one), `${one} / ${other}`).toBe(toSearchKey(other))
      expect(nameIdentity(one), `${one} / ${other}`).not.toBe(nameIdentity(other))
    }
  })
})

describe('the same identity is always the same key', () => {
  /*
   * `createUnlessNamed` locks and looks up by key, then compares identities. If two names had
   * one identity and two keys, the lock would not meet and the lookup would not see the
   * duplicate — a second item, answered 201. So every way a name can vary without changing its
   * identity is run through both functions here.
   */
  const names = [
    'Сыр чанах Ашхар',
    'Молоко «Ашхар» 3.2%',
    'Պանիր Երևան',
    'Հաց Կաթ',
    'Coca-Cola',
    'Йогурт',
    'Սև սուրճ',
    'Թթու դրած',
    'Café',
    'M&M’s',
    'ㅤ!',
    '???',
  ]
  const hidden = ['­', '​', '‍', '﻿', '᠎', '⁠', '⠀', 'ㅤ']
  const spaces = [' ', '\t', ' ', '　', '  ', '\n']

  function variants(name: string): string[] {
    const out = [
      name.toUpperCase(),
      name.toLowerCase(),
      name.normalize('NFD'),
      ` ${name} `,
      name.replaceAll('և', 'ԵՎ'),
    ]
    for (const mark of hidden) {
      // Between a letter and its combining mark — composing only after dropping it holds this.
      out.push(name.normalize('NFD').replace(/(\p{L})(\p{M})/u, `$1${mark}$2`))
      out.push(
        name.replace(' ', `${mark} `),
        `${name.slice(0, 2)}${mark}${name.slice(2)}`,
        // In place of a space — the case the second adversarial round found with U+FEFF.
        name.replaceAll(' ', mark),
      )
    }
    for (const space of spaces) out.push(name.replaceAll(' ', space))
    return out
  }

  it('holds for every variant that keeps the identity', () => {
    for (const name of names) {
      for (const variant of variants(name)) {
        if (nameIdentity(variant) !== nameIdentity(name)) continue
        expect(toSearchKey(variant), `${JSON.stringify(variant)} ~ ${name}`).toBe(toSearchKey(name))
      }
    }
  })

  it('never lets case change the identity — the direction the check above cannot see', () => {
    // The check above skips a variant whose identity differs, so a case form that silently
    // became another name would pass it. «ԵՐԵՒԱՆ» from `toUpperCase` did exactly that.
    for (const name of names) {
      expect(nameIdentity(name.toUpperCase()), name).toBe(nameIdentity(name))
      expect(nameIdentity(name.toLowerCase()), name).toBe(nameIdentity(name))
    }
  })

  it('actually exercises the variants rather than skipping them all', () => {
    // A guard for the test above: if identity stopped treating these as the same name, the
    // property would pass on nothing at all.
    const kept = names.flatMap(variants).length
    const same = names.flatMap((name) =>
      variants(name).filter((variant) => nameIdentity(variant) === nameIdentity(name)),
    ).length
    expect(same / kept).toBeGreaterThan(0.75)
  })
})
