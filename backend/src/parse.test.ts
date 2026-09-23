import { describe, expect, it } from 'vitest'
import { ERROR, resourceIdOf } from '@molvia/model'
import { idOrNull } from '@/db/rows'
import { resourceId } from './parse'

const ID = 'a3f1c2d4-5e6b-4a7c-8d9e-0f1a2b3c4d5e'

/**
 * The rule itself lives in `packages/model` and is tested there. What is held here is that the
 * API's two readers of it — the path parser and the identifier a read hands to a query — agree
 * with it and with each other. They did not: `idOrNull` kept the case the other two folded
 * (MOL-25, З-6), which is how `INVISIBLE` drifted twice and cost a 500 each time.
 */
describe('both readers of a resource address', () => {
  const values = [ID, ID.toUpperCase(), 'молоко', '', ID.slice(0, -1), `${ID} `, 'DROP TABLE']

  it('answer the model’s rule, in the model’s spelling', () => {
    for (const value of values) {
      const expected = resourceIdOf(value)
      expect(idOrNull(value)).toBe(expected)
      if (expected === null) {
        expect(() => resourceId(value)).toThrow(ERROR.NOT_FOUND)
      } else {
        expect(resourceId(value)).toBe(expected)
      }
    }
  })

  it('makes malformed, missing and someone else’s look alike', () => {
    for (const value of [undefined, null, 42, {}, []]) {
      expect(() => resourceId(value)).toThrow(ERROR.NOT_FOUND)
    }
  })
})
