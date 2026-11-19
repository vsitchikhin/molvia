import { describe, expect, it } from 'vitest'
import { RECEIPT_MODEL, RECEIPT_MODEL_INPUT_MAX, worstCallMicroUsd } from '@molvia/model'
import type { ModelCall, ModelSpendRepository } from '@/db/model-spend-repository'
import type { ReceiptModel } from '@/receipts/model-reader'
import { modelRest, readsReceiptsByModel, receiptsAccessOf } from './read-receipts'

const refused = (what: string) => () => Promise.reject(new Error(`${what} is not asked`))

function spendAnswering(reads: boolean): ModelSpendRepository & {
  asked: { month: string; worst: number; call: ModelCall; receiptsMonth: string }[]
} {
  const asked: { month: string; worst: number; call: ModelCall; receiptsMonth: string }[] = []
  return {
    asked,
    reserve: refused('reserve'),
    settle: refused('settle'),
    keepInMonth: refused('keepInMonth'),
    month: refused('month'),
    readsFor: ({ spend: month, receipts: receiptsMonth }, worst, call) => {
      asked.push({ month, worst, call, receiptsMonth })
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
    // the phone's day already December in the east: the hundred is of its month, the money of UTC's (MOL-275)
    expect(await readsReceiptsByModel(deps, 'a-person', '2026-12-01')).toBe(true)
    expect(spend.asked).toEqual([
      {
        month: '2026-11-01',
        worst: worstCallMicroUsd(RECEIPT_MODEL_INPUT_MAX, RECEIPT_MODEL),
        call: { actorId: 'a-person', capMicroUsd: 200_000_000, shareMicroUsd: 2_000_000 },
        receiptsMonth: '2026-12-01',
      },
    ])
  })

  it('says what the share and the cap say', async () => {
    const spend = spendAnswering(false)
    const deps = {
      model: { reader: someModel, spend, capMicroUsd: 200_000_000, shareMicroUsd: 2_000_000 },
    }
    expect(await readsReceiptsByModel(deps, 'a-person', '2026-11-20')).toBe(false)
  })

  it('must not ask anything with no model on the server: no camera', async () => {
    expect(await readsReceiptsByModel({ model: null }, 'a-person', '2026-11-20')).toBe(false)
  })
})

describe('receiptsAccessOf (MOL-275)', () => {
  it('names the phone’s month, the ten and the hundred beside the person’s figures', async () => {
    const until = new Date('2026-12-20T08:00:00.000Z')
    const asked: string[] = []
    const actors = {
      modelAccess: (_actorId: string, month: string) => {
        asked.push(month)
        return Promise.resolve({ until, ended: null, trialLeft: 4, read: 6 })
      },
    }
    expect(await receiptsAccessOf(actors, 'a-person', '2026-11-30')).toEqual({
      until,
      ended: null,
      trialLeft: 4,
      trialOf: 10,
      month: '2026-11-01',
      read: 6,
      limit: 100,
    })
    expect(asked).toEqual(['2026-11-01'])
  })

  it('passes when a paid reading ran out (MOL-276, adversarial А2)', async () => {
    const ended = new Date('2026-11-02T09:30:00.000Z')
    const actors = {
      modelAccess: () => Promise.resolve({ until: null, ended, trialLeft: 0, read: 60 }),
    }
    expect(await receiptsAccessOf(actors, 'a-person', '2026-11-30')).toMatchObject({
      until: null,
      ended,
    })
  })

  it('says nothing of nobody', async () => {
    const actors = { modelAccess: () => Promise.resolve(null) }
    expect(await receiptsAccessOf(actors, 'gone', '2026-11-30')).toBeNull()
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
