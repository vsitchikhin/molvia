import { describe, expect, it } from 'vitest'
import { PENDING_VERDICTS_LIMIT } from '@molvia/model'
import type { ExpenseRepository } from '@/db/expenses-repository'
import { pendingVerdicts } from './pending-verdicts'

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

describe('pendingVerdicts', () => {
  it('asks for this owner and one page, and hands the answer back as it came', async () => {
    const calls: [string, number][] = []
    const answer = {
      items: [
        {
          itemId: '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c',
          name: 'Молоко Ашхар',
          placeName: 'SAS',
          boughtAt: new Date('2026-09-18T17:40:00.000Z'),
        },
      ],
      total: 7,
    }
    const expenses = {
      pendingVerdictsFor: (actorId: string, limit: number) => {
        calls.push([actorId, limit])
        return Promise.resolve(answer)
      },
    } as Pick<ExpenseRepository, 'pendingVerdictsFor'> as ExpenseRepository

    expect(await pendingVerdicts(expenses, ACTOR)).toBe(answer)
    expect(calls).toEqual([[ACTOR, PENDING_VERDICTS_LIMIT]])
  })
})
