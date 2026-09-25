import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ERROR, ISSUE } from '#model/support/errors'
import {
  incomeAmendBodySchema,
  incomeBodySchema,
  incomesResponseCodec,
} from '#model/contracts/income'
import type { IncomesResponse } from '#model/contracts/income'
import { money } from '#model/values/money'

const body = {
  id: '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
  amount: { amount: '99615', currency: 'RUB' },
  receivedOn: '2026-09-15',
  source: 'salary',
}

const issueOf = (input: unknown) => incomeBodySchema.safeParse(input).error?.issues[0]

describe('incomeBodySchema', () => {
  it('reads an income as the form sends it, with or without what was held and a note', () => {
    expect(incomeBodySchema.parse(body).amount).toEqual(money(9_961_500n, 'RUB'))
    const full = {
      ...body,
      amount: { amount: '200000', currency: 'AMD' },
      heldBefore: { amount: '115000', currency: 'AMD' },
      note: 'Викаса',
    }
    expect(incomeBodySchema.parse(full)).toMatchObject({
      heldBefore: money(11_500_000n, 'AMD'),
      note: 'Викаса',
    })
  })

  it('refuses nothing that came in, and a remainder in another currency, under its field', () => {
    expect(issueOf({ ...body, amount: { amount: '0', currency: 'RUB' } })?.message).toBe(
      ERROR.INVALID_AMOUNT,
    )
    const held = issueOf({ ...body, heldBefore: { amount: '5', currency: 'AMD' } })
    expect(held?.message).toBe(ISSUE.INCOME_HELD_NOT_RECEIVED)
    expect(held?.path).toEqual(['heldBefore'])
  })

  it('requires a source from the list (В-3)', () => {
    expect(incomeBodySchema.safeParse({ ...body, source: undefined }).success).toBe(false)
    expect(incomeBodySchema.safeParse({ ...body, source: 'Зарплата' }).success).toBe(false)
  })

  it('refuses a day that is not one, an identifier in capitals, and extra fields', () => {
    expect(incomeBodySchema.safeParse({ ...body, receivedOn: '2026-02-31' }).success).toBe(false)
    expect(incomeBodySchema.safeParse({ ...body, id: body.id.toUpperCase() }).success).toBe(false)
    expect(incomeBodySchema.safeParse({ ...body, rate: '4.3' }).success).toBe(false)
  })

  it('takes a note of one visible line, no longer than an exchange’s', () => {
    expect(incomeBodySchema.safeParse({ ...body, note: 'a'.repeat(200) }).success).toBe(true)
    expect(incomeBodySchema.safeParse({ ...body, note: 'a'.repeat(201) }).success).toBe(false)
    expect(incomeBodySchema.safeParse({ ...body, note: 'a\nb' }).success).toBe(false)
  })
})

describe('incomeAmendBodySchema', () => {
  it('names the version it amends, and nothing of the device’s', () => {
    const fields = { amount: body.amount, receivedOn: body.receivedOn, source: body.source }
    expect(incomeAmendBodySchema.parse({ ...fields, revision: 2 }).revision).toBe(2)
    expect(incomeAmendBodySchema.safeParse(fields).success).toBe(false)
    expect(incomeAmendBodySchema.safeParse({ ...body, revision: 1 }).success).toBe(false)
  })
})

describe('incomesResponseCodec', () => {
  const view = {
    id: body.id,
    receivedOn: '2026-09-15',
    amount: money(9_961_500n, 'RUB'),
    heldBefore: null,
    source: 'salary' as const,
    note: 'Викаса',
    revision: 2,
    amendedAt: new Date('2026-09-25T10:00:00.000Z'),
    history: [
      {
        amount: money(9_900_000n, 'RUB'),
        receivedOn: '2026-09-15',
        heldBefore: null,
        source: 'salary' as const,
        note: null,
        replacedAt: new Date('2026-09-25T10:00:00.000Z'),
      },
    ],
  }
  const response: IncomesResponse = {
    base: 'RUB',
    baseSince: null,
    months: [{ month: '2026-09', sums: [money(9_961_500n, 'RUB')], incomes: [view] }],
    receipts: [{ id: body.id, currency: 'RUB', on: '2026-09-15', priced: false }],
    heldEstimates: [],
  }

  it('crosses the wire and comes back the same', () => {
    const wire = z.encode(incomesResponseCodec, response)
    expect(wire.months[0]?.sums[0]).toEqual({ amount: '99615.00', currency: 'RUB' })
    expect(z.decode(incomesResponseCodec, wire)).toEqual(response)
  })

  it('is strict, and a month is a month', () => {
    const wire = z.encode(incomesResponseCodec, response)
    expect(incomesResponseCodec.safeParse({ ...wire, actorId: 'x' }).success).toBe(false)
    const month = { ...wire, months: [{ ...wire.months[0], month: '2026-13' }] }
    expect(incomesResponseCodec.safeParse(month).success).toBe(false)
  })
})
