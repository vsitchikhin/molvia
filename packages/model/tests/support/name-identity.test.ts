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

  it('reads an Armenian label in capitals as the same name', () => {
    // «և» has no capital: «ԵՎ» lowercases to «եվ», so the two have to meet explicitly.
    expect(nameIdentity('ՊԱՆԻՐ ԵՐԵՎԱՆ')).toBe(nameIdentity('Պանիր Երևան'))
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
