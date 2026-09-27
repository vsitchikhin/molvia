import { describe, expect, it } from 'vitest'
import { nameIdentity, newItemSchema, toSearchKey } from '@molvia/model'
import { CATALOGUE_SEED } from './catalogue-seed'

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
})
