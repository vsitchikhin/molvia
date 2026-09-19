import { describe, expect, it } from 'vitest'
import { DomainError, ERROR, verdictSchema } from '@molvia/model'
import type { VerdictPatch } from '@molvia/model'
import type { VerdictRepository } from '@/db/verdicts-repository'
import { amendVerdict } from './amend-verdict'

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const MILK = '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c'

const verdict = verdictSchema.parse({
  id: 'e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7a8b',
  actorId: ACTOR,
  itemId: MILK,
  placeId: null,
  score: 3,
  review: null,
  ratedAt: new Date('2026-09-18T10:00:00.000Z'),
  updatedAt: new Date('2026-09-19T10:00:00.000Z'),
})

function fake(found: boolean, calls: [string, string, VerdictPatch][]) {
  return {
    amend: (actorId: string, itemId: string, patch: VerdictPatch) => {
      calls.push([actorId, itemId, patch])
      return Promise.resolve(found ? verdict : null)
    },
  } as Pick<VerdictRepository, 'amend'> as VerdictRepository
}

describe('amendVerdict', () => {
  it('hands the patch to the caller’s own verdict, the erased text included', async () => {
    const calls: [string, string, VerdictPatch][] = []

    await expect(amendVerdict(fake(true, calls), ACTOR, MILK, { review: null })).resolves.toBe(
      verdict,
    )
    expect(calls).toEqual([[ACTOR, MILK, { review: null }]])
  })

  it('answers «not found» when there is nothing of theirs to change', async () => {
    const refusal = amendVerdict(fake(false, []), ACTOR, MILK, { score: 4 })

    await expect(refusal).rejects.toBeInstanceOf(DomainError)
    await expect(refusal).rejects.toMatchObject({ code: ERROR.NOT_FOUND })
  })
})
