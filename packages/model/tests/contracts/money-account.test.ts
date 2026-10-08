import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import {
  accountCheckBodySchema,
  accountsHeldQuerySchema,
  moneyAccountBodySchema,
  moneyAccountsCodec,
  tripPaymentBodySchema,
} from '#model/contracts/money-account'
import {
  spendingAmendBodySchema,
  spendingBodySchema,
  spendingViewCodec,
} from '#model/contracts/spending'
import { ISSUE } from '#model/support/errors'
import { money } from '#model/values/money'

const ID = '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c'
const ACCOUNT = '1c7a3d5f-9e2b-4a4c-8d8f-6b3e2f1a4c5d'

describe('moneyAccountBodySchema', () => {
  const body = {
    id: ID,
    name: 'Карта ₽',
    currency: 'RUB',
    savings: false,
    start: { amount: '-12400.00', currency: 'RUB' },
    startOn: '2026-09-16',
  }

  it('takes a start below zero', () => {
    expect(moneyAccountBodySchema.parse(body).start).toEqual(money(-1_240_000n, 'RUB'))
  })

  it('refuses a start in another currency, under the start', () => {
    const result = moneyAccountBodySchema.safeParse({
      ...body,
      start: { amount: '1', currency: 'AMD' },
    })
    expect(result.error?.issues[0]).toMatchObject({
      message: ISSUE.ACCOUNT_START_NOT_OF_CURRENCY,
      path: ['start'],
    })
  })

  it('refuses a blank name', () => {
    expect(moneyAccountBodySchema.safeParse({ ...body, name: ' ​ ' }).success).toBe(false)
  })
})

describe('the account of an operation on the wire', () => {
  const spending = {
    id: ID,
    spentOn: '2026-09-17',
    amount: { amount: '9891', currency: 'AMD' },
    categoryId: ACCOUNT,
  }

  it('leaves the account out of an amendment as «keep», and says null for «без счёта» (Р-26)', () => {
    const fields = {
      spentOn: spending.spentOn,
      amount: spending.amount,
      categoryId: spending.categoryId,
    }
    expect(spendingAmendBodySchema.parse({ revision: 1, ...fields }).accountId).toBeUndefined()
    expect(
      spendingAmendBodySchema.parse({ revision: 1, ...fields, accountId: null }).accountId,
    ).toBeNull()
  })

  it('reads an account in either case and answers it in lower case', () => {
    const parsed = spendingBodySchema.parse({ ...spending, accountId: ACCOUNT.toUpperCase() })
    expect(parsed.accountId).toBe(ACCOUNT)
  })

  it('refuses «списано» with no account', () => {
    const result = spendingBodySchema.safeParse({
      ...spending,
      accountId: null,
      debited: { amount: '2331.85', currency: 'RUB' },
    })
    expect(result.error?.issues[0]).toMatchObject({
      message: ISSUE.DEBITED_WITHOUT_ACCOUNT,
      path: ['debited'],
    })
    const trip = tripPaymentBodySchema.safeParse({
      accountId: null,
      debited: { amount: '1', currency: 'RUB' },
    })
    expect(trip.success).toBe(false)
  })

  it('reads a spending of a server older than accounts as one without an account', () => {
    const view = spendingViewCodec.parse({
      id: ID,
      spentOn: '2026-09-17',
      amount: { amount: '9891.00', currency: 'AMD' },
      categoryId: ACCOUNT,
      note: null,
      place: null,
      rate: null,
      revision: 1,
      amendedAt: null,
    })
    expect(view).toMatchObject({ accountId: null, debited: null })
  })
})

describe('the rest of the accounts contract', () => {
  it('takes a fact of zero and below', () => {
    expect(
      accountCheckBodySchema.parse({ id: ID, fact: { amount: '-5132', currency: 'AMD' } }).fact,
    ).toEqual(money(-513_200n, 'AMD'))
  })

  it('reads the hint query with an exception in either case', () => {
    expect(
      accountsHeldQuerySchema.parse({
        currency: 'AMD',
        day: '2026-09-23',
        except: ID.toUpperCase(),
      }).except,
    ).toBe(ID)
  })

  it('encodes the overview with signed balances', () => {
    const wire = z.encode(moneyAccountsCodec, {
      spendCurrency: 'AMD',
      accounts: [
        {
          id: ACCOUNT,
          name: 'Кредитка',
          currency: 'RUB',
          savings: false,
          start: money(-1_240_000n, 'RUB'),
          startOn: '2026-09-16',
          balance: money(-1_240_000n, 'RUB'),
          approximate: false,
          uncounted: 0,
          inSpend: money(-5_728_800n, 'AMD'),
          rate: null,
          lastCheckedOn: null,
          hasOperations: false,
          archivedAt: null,
          revision: 1,
        },
      ],
      totals: {
        total: money(-5_728_800n, 'AMD'),
        spendable: money(-5_728_800n, 'AMD'),
        savings: money(0n, 'AMD'),
        uncounted: 0,
      },
      incomeTotals: {
        currency: 'RUB',
        total: money(-1_240_000n, 'RUB'),
        spendable: money(-1_240_000n, 'RUB'),
        savings: money(0n, 'RUB'),
        uncounted: 0,
      },
      unassigned: 0,
      countedAt: new Date('2026-09-26T10:05:00Z'),
    })
    expect(wire.accounts[0]?.balance).toEqual({ amount: '-12400.00', currency: 'RUB' })
    expect(wire.incomeTotals?.total).toEqual({ amount: '-12400.00', currency: 'RUB' })
  })

  it('reads «Счета» kept before the totals in the income currency (MOL-183)', () => {
    const kept = {
      spendCurrency: 'AMD',
      accounts: [],
      totals: {
        total: { amount: '0.00', currency: 'AMD' },
        spendable: { amount: '0.00', currency: 'AMD' },
        savings: { amount: '0.00', currency: 'AMD' },
        uncounted: 0,
      },
      unassigned: 0,
      countedAt: '2026-09-26T10:05:00.000Z',
    }
    expect(moneyAccountsCodec.parse(kept).incomeTotals).toBeNull()
  })
})
