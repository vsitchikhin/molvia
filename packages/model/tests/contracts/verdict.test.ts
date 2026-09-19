import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ratingSchema,
  verdictAmendmentSchema,
  verdictCardCodec,
  verdictCardOf,
  verdictPathSchema,
} from '#model/contracts/verdict'
import { verdictSchema } from '#model/entities/verdict'
import { ISSUE } from '#model/support/errors'

const OWNER = '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01'
const VERDICT_ID = 'e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7a8b'
const ITEM = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

const verdict = verdictSchema.parse({
  id: VERDICT_ID,
  actorId: OWNER,
  itemId: ITEM,
  placeId: null,
  score: 2,
  review: 'Пахнет крахмалом.\nМясом — нет',
  ratedAt: new Date('2026-09-18T10:00:00.000Z'),
  updatedAt: new Date('2026-09-19T08:30:00.000Z'),
})

describe('verdictCardOf', () => {
  it('keeps the item, the score, the text and both dates, and nothing else', () => {
    expect(Object.keys(verdictCardOf(verdict)).sort()).toEqual(
      ['itemId', 'ratedAt', 'review', 'score', 'updatedAt'].sort(),
    )
  })

  it('never carries the owner or the id of the row', () => {
    // The device identifier is the proof of identity in 0.1 (MOL-8): not a field and not a
    // value anywhere in the reply.
    const wire = JSON.stringify(z.encode(verdictCardCodec, verdictCardOf(verdict)))

    expect(wire).not.toContain(OWNER)
    expect(wire).not.toContain(VERDICT_ID)
    expect(wire).not.toContain('actorId')
    expect(wire).not.toContain('placeId')
  })
})

describe('verdictCardCodec', () => {
  it('carries the dates as ISO strings and back', () => {
    const card = verdictCardOf(verdict)
    const wire = z.encode(verdictCardCodec, card)

    expect(wire.ratedAt).toBe('2026-09-18T10:00:00.000Z')
    expect(verdictCardCodec.parse(JSON.parse(JSON.stringify(wire)))).toEqual(card)
  })

  it('refuses a reply that grew a field, on the client as much as on the server', () => {
    const wire = z.encode(verdictCardCodec, verdictCardOf(verdict))

    expect(verdictCardCodec.safeParse({ ...wire, actorId: OWNER }).success).toBe(false)
    expect(() => z.encode(verdictCardCodec, verdict)).toThrow()
  })

  it('refuses a date that is not one', () => {
    const wire = z.encode(verdictCardCodec, verdictCardOf(verdict))
    expect(verdictCardCodec.safeParse({ ...wire, ratedAt: 'вчера' }).success).toBe(false)
  })
})

describe('ratingSchema', () => {
  it('takes a score alone, and a score with a review', () => {
    expect(ratingSchema.parse({ score: 4 })).toEqual({ score: 4 })
    expect(ratingSchema.parse({ score: 1, review: ' плохо ' })).toEqual({
      score: 1,
      review: 'плохо',
    })
  })

  it('refuses what belongs to the path, the header or 0.3 — naming the field', () => {
    for (const [field, value] of [
      ['itemId', ITEM],
      ['actorId', OWNER],
      ['placeId', ITEM],
      ['ratedAt', '2026-09-18T10:00:00.000Z'],
    ] as const) {
      const issue = ratingSchema.safeParse({ score: 4, [field]: value }).error?.issues[0]
      expect(issue?.code).toBe('unrecognized_keys')
      expect(issue?.code === 'unrecognized_keys' ? issue.keys : []).toEqual([field])
    }
  })

  it('takes the ends of the scale and nothing past them, whole numbers only', () => {
    for (const score of [1, 5]) expect(ratingSchema.safeParse({ score }).success).toBe(true)
    for (const score of [0, 6, 4.5, '5', null]) {
      expect(ratingSchema.safeParse({ score }).success).toBe(false)
    }
    expect(ratingSchema.safeParse({}).success).toBe(false)
  })

  it('refuses a review of blanks: an empty textarea is not sent at all', () => {
    expect(ratingSchema.safeParse({ score: 3, review: '   ' }).success).toBe(false)
    expect(ratingSchema.safeParse({ score: 3, review: null }).success).toBe(false)
  })
})

describe('verdictAmendmentSchema', () => {
  it('erases the text with null and refuses an empty patch', () => {
    expect(verdictAmendmentSchema.parse({ review: null })).toEqual({ review: null })
    expect(verdictAmendmentSchema.safeParse({}).error?.issues[0]?.message).toBe(ISSUE.PATCH_EMPTY)
  })

  it('refuses the item and the owner beside the patch', () => {
    expect(verdictAmendmentSchema.safeParse({ score: 3, itemId: ITEM }).success).toBe(false)
    expect(verdictAmendmentSchema.safeParse({ score: 3, actorId: OWNER }).success).toBe(false)
  })
})

describe('verdictPathSchema', () => {
  it('takes a uuid and answers anything else with its own code', () => {
    expect(verdictPathSchema.parse({ itemId: ITEM })).toEqual({ itemId: ITEM })
    expect(verdictPathSchema.safeParse({ itemId: 'молоко' }).error?.issues[0]?.message).toBe(
      ISSUE.PATH_INVALID,
    )
  })
})
