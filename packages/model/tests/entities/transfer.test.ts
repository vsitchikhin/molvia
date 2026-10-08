import { describe, expect, it } from 'vitest'
import { transferSchema } from '#model/entities/transfer'
import { ISSUE } from '#model/support/errors'

const row = {
  id: '6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
  actorId: '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01',
  fromAccountId: '8b0c2f4e-1d3a-4b5c-9e7f-0a1b2c3d4e5f',
  toAccountId: '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b',
  amount: { minor: 200000n, currency: 'USD' },
  fee: null,
  transferredOn: '2026-10-08',
  note: null,
  revision: 1,
  createdAt: new Date('2026-10-08T08:00:00Z'),
  amendedAt: null,
}

describe('transferSchema', () => {
  it('holds a transfer without a fee', () => {
    expect(transferSchema.parse(row).fee).toBeNull()
  })

  it('refuses one account on both sides', () => {
    const parsed = transferSchema.safeParse({ ...row, toAccountId: row.fromAccountId })
    expect(parsed.error?.issues[0]?.message).toBe(ISSUE.TRANSFER_SAME_ACCOUNT)
  })

  it('refuses a fee in another currency than the money moved', () => {
    const parsed = transferSchema.safeParse({ ...row, fee: { minor: 2000n, currency: 'AMD' } })
    expect(parsed.error?.issues[0]?.message).toBe(ISSUE.TRANSFER_FEE_NOT_OF_CURRENCY)
  })
})
