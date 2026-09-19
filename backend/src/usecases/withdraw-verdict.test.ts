import { describe, expect, it } from 'vitest'
import { DomainError, ERROR } from '@molvia/model'
import type { VerdictRepository } from '@/db/verdicts-repository'
import { withdrawVerdict } from './withdraw-verdict'

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const MILK = '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c'

function fake(withdrawn: boolean, calls: [string, string][]) {
  return {
    withdraw: (actorId: string, itemId: string) => {
      calls.push([actorId, itemId])
      return Promise.resolve(withdrawn)
    },
  } as Pick<VerdictRepository, 'withdraw'> as VerdictRepository
}

describe('withdrawVerdict', () => {
  it('takes back the caller’s own verdict on the item', async () => {
    const calls: [string, string][] = []

    await expect(withdrawVerdict(fake(true, calls), ACTOR, MILK)).resolves.toBeUndefined()
    expect(calls).toEqual([[ACTOR, MILK]])
  })

  it('answers «not found» when there was nothing of theirs to take back', async () => {
    const refusal = withdrawVerdict(fake(false, []), ACTOR, MILK)

    await expect(refusal).rejects.toBeInstanceOf(DomainError)
    await expect(refusal).rejects.toMatchObject({ code: ERROR.NOT_FOUND })
  })
})
