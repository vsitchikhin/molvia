import { describe, expect, it } from 'vitest'
import { transferAmendBodySchema, transferBodySchema } from '#model/contracts/transfer'
import { ERROR, ISSUE } from '#model/support/errors'

const CARD = '8b0c2f4e-1d3a-4b5c-9e7f-0a1b2c3d4e5f'
const DOLLARS = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b'

const body = {
  id: '6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
  fromAccountId: CARD,
  toAccountId: DOLLARS,
  amount: { amount: '2000.00', currency: 'USD' },
  fee: { amount: '20.00', currency: 'USD' },
  transferredOn: '2026-10-08',
  note: 'на депозит',
}

function issues(input: unknown) {
  const parsed = transferBodySchema.safeParse(input)
  return parsed.success ? [] : parsed.error.issues.map(({ message, path }) => ({ message, path }))
}

describe('transferBodySchema', () => {
  it('takes a transfer with a fee and a note', () => {
    expect(transferBodySchema.parse(body)).toMatchObject({
      amount: { minor: 200000n, currency: 'USD' },
      fee: { minor: 2000n, currency: 'USD' },
    })
  })

  it('takes one with no fee and no note — both are optional', () => {
    const bare = Object.fromEntries(
      Object.entries(body).filter(([key]) => key !== 'fee' && key !== 'note'),
    )
    expect(transferBodySchema.parse(bare).fee).toBeUndefined()
  })

  it('takes the accounts in either case and keeps them in lower case', () => {
    const parsed = transferBodySchema.parse({ ...body, fromAccountId: CARD.toUpperCase() })
    expect(parsed.fromAccountId).toBe(CARD)
  })

  it('refuses an account onto itself, under «Куда»', () => {
    expect(issues({ ...body, toAccountId: CARD })).toEqual([
      { message: ISSUE.TRANSFER_SAME_ACCOUNT, path: ['toAccountId'] },
    ])
  })

  it('refuses a fee in another currency than the money, under «Комиссия»', () => {
    expect(issues({ ...body, fee: { amount: '20.00', currency: 'AMD' } })).toEqual([
      { message: ISSUE.TRANSFER_FEE_NOT_OF_CURRENCY, path: ['fee'] },
    ])
  })

  it('refuses a zero sum and a zero fee — a fee of nothing is left out', () => {
    expect(issues({ ...body, amount: { amount: '0.00', currency: 'USD' } })[0]?.message).toBe(
      ERROR.INVALID_AMOUNT,
    )
    expect(issues({ ...body, fee: { amount: '0.00', currency: 'USD' } })[0]?.message).toBe(
      ERROR.INVALID_AMOUNT,
    )
  })

  it('refuses a field it does not know — a rate has no place here', () => {
    expect(issues({ ...body, rate: '1' })).not.toEqual([])
  })
})

describe('transferAmendBodySchema', () => {
  it('is the transfer whole over a version, without an id', () => {
    const fields = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'id'))
    expect(transferAmendBodySchema.parse({ ...fields, revision: 2 }).revision).toBe(2)
    expect(transferAmendBodySchema.safeParse({ ...body, revision: 2 }).success).toBe(false)
  })
})
