import { describe, expect, it } from 'vitest'
import { RECEIPT_MODEL_INPUT_MAX, worstCallMicroUsd } from '@molvia/model'
import type { ModelCall, ModelSpendRepository } from '@/db/model-spend-repository'
import type { ReceiptModel } from '@/receipts/model-reader'
import { readsReceiptsByModel } from './read-receipts'

const refused = (what: string) => () => Promise.reject(new Error(`${what} is not asked`))

function spendAnswering(reads: boolean): ModelSpendRepository & {
  asked: { month: string; worst: number; call: ModelCall }[]
} {
  const asked: { month: string; worst: number; call: ModelCall }[] = []
  return {
    asked,
    reserve: refused('reserve'),
    settle: refused('settle'),
    keepInMonth: refused('keepInMonth'),
    month: refused('month'),
    readsFor: (month, worst, call) => {
      asked.push({ month, worst, call })
      return Promise.resolve(reads)
    },
  }
}

// the route never calls the model: any object stands for one on the server
const someModel = {} as ReceiptModel

describe('readsReceiptsByModel (MOL-408, adversarial А3, Р2-А1)', () => {
  it('asks the share and the cap for one more call of the largest request, in the month of now', async () => {
    const spend = spendAnswering(true)
    const deps = {
      model: { reader: someModel, spend, capMicroUsd: 200_000_000, shareMicroUsd: 2_000_000 },
      now: () => new Date('2026-11-30T23:59:59.000Z'),
    }
    expect(await readsReceiptsByModel(deps, 'a-person')).toBe(true)
    expect(spend.asked).toEqual([
      {
        month: '2026-11-01',
        worst: worstCallMicroUsd(RECEIPT_MODEL_INPUT_MAX),
        call: { actorId: 'a-person', capMicroUsd: 200_000_000, shareMicroUsd: 2_000_000 },
      },
    ])
  })

  it('says what the share and the cap say', async () => {
    const spend = spendAnswering(false)
    const deps = {
      model: { reader: someModel, spend, capMicroUsd: 200_000_000, shareMicroUsd: 2_000_000 },
    }
    expect(await readsReceiptsByModel(deps, 'a-person')).toBe(false)
  })

  it('must not ask anything with no model on the server: no camera', async () => {
    expect(await readsReceiptsByModel({ model: null }, 'a-person')).toBe(false)
  })
})
