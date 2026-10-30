import { describe, expect, it } from 'vitest'
import { PENDING_VERDICTS_LIMIT } from '@molvia/model'
import type { PendingVerdicts } from '@molvia/model'
import type { ExpenseRepository } from '@/db/expenses-repository'
import { pendingVerdicts } from './pending-verdicts'

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

describe('pendingVerdicts', () => {
  const card = {
    itemId: '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c',
    name: 'Молоко Ашхар',
    placeName: 'SAS',
    boughtAt: new Date('2026-09-18T17:40:00.000Z'),
  }

  function repository(answer: PendingVerdicts, bought: boolean) {
    const calls: unknown[][] = []
    const expenses = {
      pendingVerdictsFor: (actorId: string, limit: number) => {
        calls.push(['pending', actorId, limit])
        return Promise.resolve(answer)
      },
      hasPurchases: (actorId: string) => {
        calls.push(['bought', actorId])
        return Promise.resolve(bought)
      },
    } as Pick<ExpenseRepository, 'pendingVerdictsFor' | 'hasPurchases'> as ExpenseRepository
    return { expenses, calls }
  }

  it('asks for this owner and one page, and hands the answer back as it came', async () => {
    const { expenses, calls } = repository({ items: [card], total: 7 }, false)

    expect(await pendingVerdicts(expenses, ACTOR)).toEqual({
      items: [card],
      total: 7,
      bought: true,
    })
    // Something waits, so something was bought — not asked again (MOL-214).
    expect(calls).toEqual([['pending', ACTOR, PENDING_VERDICTS_LIMIT]])
  })

  it('an empty queue asks whether anything was bought, after the queue', async () => {
    const nothing = repository({ items: [], total: 0 }, false)
    expect(await pendingVerdicts(nothing.expenses, ACTOR)).toEqual({
      items: [],
      total: 0,
      bought: false,
    })
    expect(nothing.calls).toEqual([
      ['pending', ACTOR, PENDING_VERDICTS_LIMIT],
      ['bought', ACTOR],
    ])

    const rated = repository({ items: [], total: 0 }, true)
    expect((await pendingVerdicts(rated.expenses, ACTOR)).bought).toBe(true)
  })
})
