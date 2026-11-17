import { describe, expect, it } from 'vitest'
import { RECEIPT_MODEL, RECEIPT_MODEL_INPUT_MAX, worstCallMicroUsd } from '@molvia/model'
import type { ModelCall, ModelSpendRepository } from '@/db/model-spend-repository'
import type { ReceiptModel } from '@/receipts/model-reader'
import { modelRest, readsReceiptsByModel } from './read-receipts'

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
        worst: worstCallMicroUsd(RECEIPT_MODEL_INPUT_MAX, RECEIPT_MODEL),
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

describe('the second model’s rest once away (MOL-405, adversarial А5)', () => {
  const at = (ms: number) => new Date(Date.UTC(2026, 10, 17, 12) + ms)

  it('rests from the moment it was away, for its while and not a moment past it', () => {
    const rest = modelRest(600_000)
    expect(rest.resting(at(0))).toBe(false)
    rest.away(at(0))
    expect(rest.resting(at(0))).toBe(true)
    expect(rest.resting(at(599_999))).toBe(true)
    expect(rest.resting(at(600_000))).toBe(false)
  })

  it('rests from the last time it was away', () => {
    const rest = modelRest(600_000)
    rest.away(at(0))
    rest.away(at(600_000))
    expect(rest.resting(at(900_000))).toBe(true)
  })
})
