import { describe, expect, it } from 'vitest'
import {
  formKeyIsStable,
  statementLineKeys,
  statementLineSchema,
  statementLinkOf,
  statementSchema,
} from '#model/entities/statement-line'
import type { StatementLine } from '#model/entities/statement-line'

const PERSON = '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01'
const OTHER = '6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'
const ARDSHIN = '8b0c2f4e-1d3a-4b5c-9e7f-0a1b2c3d4e5f'

const line = (o: Partial<StatementLine> = {}): StatementLine => ({
  day: '2026-11-14',
  postedOn: null,
  time: null,
  amount: { minor: 120000n, currency: 'AMD' },
  debited: null,
  sign: '-',
  payee: 'YANDEX.GO YEREVAN',
  mcc: null,
  bankCategory: null,
  status: 'posted',
  kind: 'purchase',
  ...o,
})

describe('statementLineSchema', () => {
  it('holds a line of a file and a line of a screenshot', () => {
    expect(statementLineSchema.parse(line()).payee).toBe('YANDEX.GO YEREVAN')
    expect(statementLineSchema.parse(line({ time: '9:10 PM', sign: null })).time).toBe('9:10 PM')
  })

  it('refuses a zero amount, a day that is not one and an MCC that is not four digits', () => {
    expect(
      statementLineSchema.safeParse(line({ amount: { minor: 0n, currency: 'AMD' } })).success,
    ).toBe(false)
    expect(statementLineSchema.safeParse(line({ day: '2026-02-31' })).success).toBe(false)
    expect(statementLineSchema.safeParse(line({ mcc: '601' })).success).toBe(false)
  })

  it('refuses a form no reader has', () => {
    const statement = {
      form: 'tbank-pdf',
      accountId: null,
      accountNumber: null,
      period: null,
      lines: [line()],
    }
    expect(statementSchema.safeParse(statement).success).toBe(false)
  })
})

describe('formKeyIsStable', () => {
  it('holds a file to its key and never a screenshot', () => {
    expect(formKeyIsStable('ardshin-xlsx')).toBe(true)
    expect(formKeyIsStable('screenshot')).toBe(false)
  })
})

describe('statementLineKeys', () => {
  const keys = (lines: StatementLine[], actorId = PERSON, accountId: string | null = ARDSHIN) =>
    statementLineKeys(actorId, { accountId, lines })

  it('gives the same line uploaded again the same uuid', () => {
    const [first] = keys([line()])
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(keys([line({ payee: '  YANDEX.GO   YEREVAN ' })])).toEqual([first])
  })

  it('tells two equal rides of one day apart by their turn, and keeps the turn on a second upload', () => {
    const both = keys([line(), line({ payee: 'VEGA' }), line()])
    expect(new Set(both).size).toBe(3)
    expect(keys([line(), line()])).toEqual([both[0], both[2]])
  })

  it('keys by the number the bank’s head prints, before the account chosen in Molvia (adversarial А14)', () => {
    const numbered = (accountNumber: string, accountId: string | null = null) =>
      statementLineKeys(PERSON, { accountId, accountNumber, lines: [line()] })
    expect(numbered('4400 **** 1111')).not.toEqual(numbered('4400 **** 2222'))
    expect(numbered('4400 **** 1111', ARDSHIN)).toEqual(numbered('4400****1111'))
    expect(numbered('4400 **** 1111')).not.toEqual(keys([line()], PERSON, null))
  })

  it('keeps two people apart on a statement with no account', () => {
    expect(keys([line()], PERSON, null)).not.toEqual(keys([line()], OTHER, null))
  })

  it('moves with the account, the day, the sign, the amount and the payee', () => {
    const [base] = keys([line()])
    for (const other of [
      keys([line()], PERSON, null),
      keys([line({ day: '2026-11-15' })]),
      keys([line({ sign: '+' })]),
      keys([line({ amount: { minor: 120001n, currency: 'AMD' } })]),
      keys([line({ amount: { minor: 120000n, currency: 'RUB' } })]),
      keys([line({ payee: 'YANDEX GO YEREVAN' })]),
    ])
      expect(other[0]).not.toBe(base)
  })

  it('keeps a line’s turn whether a declined twin before it is printed or not (adversarial А5)', () => {
    const declined = line({ status: 'declined' })
    const [, paid] = keys([declined, line()])
    expect(keys([line()])).toEqual([paid])
    expect(keys([line(), declined])).toEqual([paid, keys([declined])[0]])
    expect(keys([declined])).not.toEqual([paid])
  })

  it('keeps a paid line’s turn whether a dropped hold beside it is printed or not (adversarial А9)', () => {
    const hold = line({ status: 'pending' })
    const [, paid] = keys([hold, line()])
    expect(keys([line()])).toEqual([paid])
    expect(keys([hold])).not.toEqual([paid])
  })

  it('does not move with what the reader adds: kind, time, the posting day', () => {
    const [base] = keys([line()])
    expect(keys([line({ kind: 'transfer', time: '14:35', postedOn: '2026-11-15' })])).toEqual([
      base,
    ])
  })
})

describe('statementLinkOf', () => {
  it('keeps what the rule reads of the line again', () => {
    const held = line({ status: 'pending', time: '14:35' })
    const posted = line({ postedOn: '2026-11-16' })
    expect(
      statementLinkOf(posted, 'k', { form: 'ardshin-xlsx', accountId: ARDSHIN }),
    ).toMatchObject({
      accountId: ARDSHIN,
      postedOn: '2026-11-16',
      pending: false,
    })
    expect(statementLinkOf(held, 'k', { form: 'screenshot', accountId: null })).toEqual({
      key: 'k',
      accountId: null,
      day: '2026-11-14',
      postedOn: null,
      pending: true,
      form: 'screenshot',
      amount: held.amount,
      payee: 'YANDEX.GO YEREVAN',
      time: '14:35',
    })
  })
})
