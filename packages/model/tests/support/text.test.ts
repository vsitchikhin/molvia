import { describe, expect, it } from 'vitest'
import { nameIdentity } from '#model/support/text'
import { toSearchKey } from '#model/support/search-key'

describe('nameIdentity', () => {
  it('treats case and spacing as the same name', () => {
    expect(nameIdentity('Сыр  чанах Ашхар ')).toBe(nameIdentity('сыр чанах ашхар'))
    expect(nameIdentity('MILO')).toBe(nameIdentity('milo'))
    expect(nameIdentity('Сыр\tчанах')).toBe(nameIdentity('Сыр чанах'))
  })

  it('treats a composed and a decomposed letter as the same name', () => {
    expect(nameIdentity('Caf\u00e9')).toBe(nameIdentity('Cafe\u0301'))
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
