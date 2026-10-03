import { describe, expect, it } from 'vitest'
import { nameIdentity, newItemSchema, toSearchKey } from '@molvia/model'
import { CATALOGUE_SEED } from './catalogue-seed'
import { CATALOGUE_SEED_NODES } from './catalogue-seed-nodes'

describe('the catalogue seed (MOL-112)', () => {
  it.each(CATALOGUE_SEED)('«%s» is an item «Предложить товар» would accept', (name, unit) => {
    const item = newItemSchema.parse({ kind: 'product', name, defaultUnit: unit })

    expect(item.name).toBe(name)
    expect(toSearchKey(name)).not.toBe('')
  })

  // The seed writes through `createUnlessNamed`, which answers a second line of the same identity
  // with the first — the second line would be silently lost, with its unit.
  it('has no two lines of one identity', () => {
    const seen = new Map<string, string>()
    const twins: string[] = []
    for (const [name] of CATALOGUE_SEED) {
      const earlier = seen.get(nameIdentity(name))
      if (earlier) twins.push(`${earlier} = ${name}`)
      seen.set(nameIdentity(name), name)
    }

    expect(twins).toEqual([])
  })

  // MOL-126: every line reaches a receipt — Armenian names and customs headings — and nothing is
  // there for a line the seed does not have, which would be written to no item at all.
  it('gives every line its Armenian names and customs headings, and no line more', () => {
    const names = CATALOGUE_SEED.map(([name]) => name)
    expect(Object.keys(CATALOGUE_SEED_NODES).sort()).toEqual([...names].sort())
    for (const node of Object.values(CATALOGUE_SEED_NODES)) {
      expect(node.hy.length).toBeGreaterThan(0)
      expect(node.hy.every((name) => /\p{Script=Armenian}/u.test(name) && name.length <= 200)).toBe(
        true,
      )
      expect(node.hs.every((hs) => /^\d{4}$/.test(hs))).toBe(true)
    }
  })
})
