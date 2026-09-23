import { describe, expect, it } from 'vitest'
import { verdictPathSchema } from '#model/contracts/verdict'
import { isResourceId, resourceIdOf } from '#model/support/resource'

const ID = 'a3f1c2d4-5e6b-4a7c-8d9e-0f1a2b3c4d5e'

describe('the address of a resource', () => {
  it('takes a uuid in either case and answers in one spelling', () => {
    expect(resourceIdOf(ID)).toBe(ID)
    expect(resourceIdOf(ID.toUpperCase())).toBe(ID)
    expect(isResourceId(ID.toUpperCase())).toBe(true)
  })

  it('refuses anything that could never address a row', () => {
    for (const value of [
      '',
      'молоко',
      ID.slice(0, -1),
      `${ID} `,
      ` ${ID}`,
      `${ID}\n`,
      ID.replace('-', ''),
      'a3f1c2d4-5e6b-4a7c-8d9e-0f1a2b3c4d5g',
      42,
      null,
      undefined,
      {},
    ]) {
      expect(resourceIdOf(value)).toBeNull()
      expect(isResourceId(value)).toBe(false)
    }
  })

  /**
   * The rule lived in three places and two of them folded the case while the third did not
   * (MOL-25, З-6). `INVISIBLE` drifted the same way twice and cost a 500 each time, so the
   * copies are held equal by a test rather than by memory.
   */
  it('is the same rule the verdict path is parsed by', () => {
    for (const value of [ID, ID.toUpperCase(), 'молоко', ID.slice(0, -1), `${ID}-`, '']) {
      const path = verdictPathSchema.safeParse({ itemId: value })
      expect(path.success).toBe(isResourceId(value))
      if (path.success) expect(path.data.itemId).toBe(resourceIdOf(value))
    }
  })
})
