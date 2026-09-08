import { describe, expect, it } from 'vitest'
import { ERROR } from './errors'
import { newVerdictSchema, verdictLevel, verdictPatchSchema, verdictSchema } from './verdict'

const verdict = {
  id: 'e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7a8b',
  actorId: '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01',
  itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  placeId: null,
  score: 5,
  review: 'сливочное, не водянистое',
  ratedAt: new Date('2026-09-08T10:00:00Z'),
  updatedAt: new Date('2026-09-08T10:00:00Z'),
}

describe('verdictSchema', () => {
  it('accepts a verdict on a product, where the place is null', () => {
    expect(verdictSchema.parse(verdict).placeId).toBeNull()
  })

  it('accepts one with a place filled in, which is how 0.3 rates a dish', () => {
    const place = 'b1e0f2a4-5c6d-4e8f-9a0b-1c2d3e4f5a6b'
    expect(verdictSchema.parse({ ...verdict, placeId: place }).placeId).toBe(place)
  })

  it('accepts a rating with no sentence behind it', () => {
    expect(() => verdictSchema.parse({ ...verdict, review: null })).not.toThrow()
  })

  it('takes both ends of the scale and nothing outside it', () => {
    for (const score of [1, 5]) {
      expect(() => verdictSchema.parse({ ...verdict, score })).not.toThrow()
    }
    for (const score of [0, 6, -1]) {
      expect(() => verdictSchema.parse({ ...verdict, score })).toThrow()
    }
  })

  it('refuses half a star: there is none on screen', () => {
    expect(() => verdictSchema.parse({ ...verdict, score: 3.5 })).toThrow()
  })
})

describe('newVerdictSchema', () => {
  it('takes an item and a score alone', () => {
    expect(newVerdictSchema.parse({ itemId: verdict.itemId, score: 4 }).score).toBe(4)
  })

  it('refuses the owner and the timestamps: the server owns them', () => {
    for (const smuggled of [{ actorId: verdict.actorId }, { ratedAt: new Date() }]) {
      expect(() =>
        newVerdictSchema.parse({ itemId: verdict.itemId, score: 4, ...smuggled }),
      ).toThrow()
    }
  })
})

describe('verdictPatchSchema', () => {
  it('re-rates without touching the sentence', () => {
    expect(verdictPatchSchema.parse({ score: 2 })).toEqual({ score: 2 })
  })

  it('clears the sentence with null and keeps the rating', () => {
    expect(verdictPatchSchema.parse({ review: null })).toEqual({ review: null })
  })

  it('refuses an empty patch', () => {
    expect(() => verdictPatchSchema.parse({})).toThrow()
  })

  it('refuses to move a verdict to another item', () => {
    expect(() => verdictPatchSchema.parse({ score: 2, itemId: verdict.itemId })).toThrow()
  })
})

describe('verdictLevel', () => {
  it('puts both thresholds on the inclusive side, at count = 1', () => {
    expect(verdictLevel(5, 1)).toBe('take')
    expect(verdictLevel(4, 1)).toBe('take')
    expect(verdictLevel(3, 1)).toBe('if_cheap')
    expect(verdictLevel(2, 1)).toBe('never')
    expect(verdictLevel(1, 1)).toBe('never')
  })

  it('holds the same thresholds on an average, which is what 0.3 brings', () => {
    // Exactly 4.0 and exactly 2.5 are the two values a float would fumble.
    expect(verdictLevel(8, 2)).toBe('take') // 4.0
    expect(verdictLevel(39, 10)).toBe('if_cheap') // 3.9
    expect(verdictLevel(5, 2)).toBe('if_cheap') // 2.5
    expect(verdictLevel(249, 100)).toBe('never') // 2.49
    expect(verdictLevel(9, 2)).toBe('take') // 4.5
  })

  it('refuses a count of zero rather than dividing by it', () => {
    for (const count of [0, -1]) {
      expect(() => verdictLevel(4, count)).toThrow(
        expect.objectContaining({ code: ERROR.INVALID_SCORE }),
      )
    }
  })

  it('refuses a fractional sum, which would mean a float got in upstream', () => {
    expect(() => verdictLevel(3.5, 1)).toThrow(
      expect.objectContaining({ code: ERROR.INVALID_SCORE }),
    )
  })
})
