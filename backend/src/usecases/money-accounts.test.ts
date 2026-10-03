import { describe, expect, it } from 'vitest'
import { INT8_MAX, money, moneyAccountSchema, placeSchema } from '@molvia/model'
import type { Currency, Expense, Money, MoneyAccount, Trip } from '@molvia/model'
import { keptSide, paymentOf } from './account-of'
import { moneyAccountsOf, payTrip } from './money-accounts'
import type { TripRepositories } from '@/db/unit-of-work'

/**
 * The use cases of accounts (MOL-115, review Р-2) on fake repositories. Any method a case does not
 * hand in throws, so reaching for one is a failure to see.
 */
function fake<T extends object>(name: string, methods: Partial<T>): T {
  return new Proxy(methods, {
    get(target, key) {
      if (key in target) return target[key as keyof typeof target]
      if (key === 'then') return undefined
      return () => {
        throw new Error(`unexpected ${name}.${String(key)}`)
      }
    },
  }) as T
}

const OWNER = '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01'
let sequence = 0
const nextId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`

function account(currency: Currency, start = 0n, savings = false): MoneyAccount {
  return moneyAccountSchema.parse({
    id: nextId(),
    actorId: OWNER,
    name: `Счёт ${String(sequence)}`,
    currency,
    savings,
    start: money(start, currency),
    startOn: '2026-09-16',
    revision: 1,
    createdAt: new Date('2026-09-16T20:00:00Z'),
    archivedAt: null,
  })
}

const byId = (...accounts: MoneyAccount[]) => new Map(accounts.map((one) => [one.id, one]))
const amd = (minor: bigint): Money => money(minor, 'AMD')
const rub = (minor: bigint): Money => money(minor, 'RUB')

describe('paymentOf (Р-26, Д2, Д3)', () => {
  const cash = account('AMD')
  const card = account('RUB')
  const accounts = byId(cash, card)

  it('keeps «списано» when the account is left out and still applies', () => {
    const held = { accountId: card.id, debited: rub(233_185n) }
    expect(paymentOf(accounts, held, {}, ['AMD'])).toEqual(held)
  })

  it('drops a kept «списано» when the account changes, or the money becomes the account’s', () => {
    const held = { accountId: card.id, debited: rub(233_185n) }
    expect(paymentOf(accounts, held, { accountId: cash.id }, ['AMD'])).toEqual({
      accountId: cash.id,
      debited: null,
    })
    expect(paymentOf(accounts, held, {}, ['RUB'])).toEqual({ accountId: card.id, debited: null })
  })

  it('refuses nothing (Р-31, Е1): «списано» that does not apply is dropped', () => {
    // A spending in drams from the dram account: nothing was converted, the account stays.
    expect(paymentOf(accounts, null, { accountId: cash.id, debited: amd(100n) }, ['AMD'])).toEqual({
      accountId: cash.id,
      debited: null,
    })
  })

  it('writes one whose «списано» is not in the account’s currency without the account (Е1)', () => {
    // The phone saw a dram card; the card is in roubles now — not the account it meant.
    expect(paymentOf(accounts, null, { accountId: card.id, debited: amd(100n) }, ['USD'])).toEqual({
      accountId: null,
      debited: null,
    })
  })

  it('takes «списано» for a trip in the account’s currency with a purchase in another (Д2)', () => {
    expect(
      paymentOf(accounts, null, { accountId: cash.id, debited: amd(400_000n) }, ['AMD', 'USD']),
    ).toEqual({ accountId: cash.id, debited: amd(400_000n) })
  })

  it('writes an account the owner has not got as none, «списано» with it (Д3)', () => {
    expect(paymentOf(accounts, null, { accountId: nextId(), debited: rub(100n) }, ['AMD'])).toEqual(
      { accountId: null, debited: null },
    )
    expect(
      paymentOf(accounts, { accountId: null, debited: null }, { debited: rub(1n) }, ['AMD']),
    ).toEqual({ accountId: null, debited: null })
  })
})

describe('keptSide (Р-26)', () => {
  const cash = account('AMD')
  const accounts = byId(cash)

  it('keeps the account left out while the money still fits it, and drops it when not', () => {
    expect(keptSide(accounts, cash.id, undefined, 'AMD')).toBe(cash.id)
    expect(keptSide(accounts, cash.id, undefined, 'RUB')).toBeNull()
    expect(keptSide(accounts, cash.id, null, 'AMD')).toBeNull()
  })
})

describe('payTrip (Р-18, Д2)', () => {
  const place = placeSchema.parse({
    id: nextId(),
    kind: 'store',
    name: 'SAS',
    country: 'AM',
    city: 'Гюмри',
    createdAt: new Date('2026-09-18T09:00:00Z'),
  })
  const trip: Trip = {
    id: nextId(),
    actorId: OWNER,
    placeId: place.id,
    currency: 'AMD',
    rate: null,
    rateProvider: null,
    rateJumped: false,
    previousRate: null,
    manualRate: null,
    rateChoice: null,
    startedAt: new Date('2026-09-20T10:00:00Z'),
    finishedAt: null,
    accountId: null,
    debited: null,
    receipt: null,
  }

  function world(accounts: MoneyAccount[], purchases: Currency[]) {
    const written: unknown[] = []
    const expenses: Expense[] = purchases.map((currency) => ({
      id: nextId(),
      tripId: trip.id,
      itemId: nextId(),
      quantity: null,
      amount: money(1000n, currency),
      createdAt: new Date('2026-09-20T10:05:00Z'),
    }))
    const repositories = {
      trips: fake<TripRepositories['trips']>('trips', { byId: () => Promise.resolve(trip) }),
      expenses: fake<TripRepositories['expenses']>('expenses', {
        forTrip: () => Promise.resolve(expenses),
      }),
      places: fake<TripRepositories['places']>('places', { byId: () => Promise.resolve(place) }),
      items: fake<TripRepositories['items']>('items', { byIds: () => Promise.resolve([]) }),
      receipts: fake<TripRepositories['receipts']>('receipts', {
        sourceOf: () => Promise.resolve(null),
      }),
      moneyAccounts: fake<TripRepositories['moneyAccounts']>('moneyAccounts', {
        known: () => Promise.resolve(accounts),
        setTripPayment: (_, __, accountId, debited) => {
          written.push({ accountId, debited })
          return Promise.resolve(true)
        },
      }),
    }
    return { repositories, written }
  }

  it('drops «списано» when the trip and every purchase are in the account’s currency (Е3)', async () => {
    const cash = account('AMD')
    // A trip in drams with nothing priced in another currency.
    const { repositories, written } = world([cash], [])
    await payTrip(repositories, { id: OWNER }, trip.id, { accountId: cash.id, debited: amd(1n) })
    expect(written).toEqual([{ accountId: cash.id, debited: null }])
  })

  it('takes the account off with «списано» together', async () => {
    const { repositories, written } = world([], [])
    const view = await payTrip(repositories, { id: OWNER }, trip.id, { accountId: null })
    expect(written).toEqual([{ accountId: null, debited: null }])
    expect(view).toMatchObject({ accountId: null, debited: null })
  })
})

describe('moneyAccountsOf: what the totals leave out (С-2)', () => {
  function world(accounts: MoneyAccount[]) {
    return {
      moneyAccounts: fake<TripRepositories['moneyAccounts']>('moneyAccounts', {
        list: () => Promise.resolve(accounts),
        operations: () => Promise.resolve([]),
        lastChecks: () => Promise.resolve(new Map()),
      }),
      exchanges: fake<TripRepositories['exchanges']>('exchanges', {
        rateSettings: () => Promise.resolve({ preference: 'official', since: null }),
        list: () => Promise.resolve([]),
      }),
      incomes: fake<TripRepositories['incomes']>('incomes', { list: () => Promise.resolve([]) }),
      rates: fake<TripRepositories['rates']>('rates', {
        latestOnOrBefore: () => Promise.resolve([]),
      }),
    }
  }
  const owner = { id: OWNER, incomeCurrency: 'RUB' as const, spendCurrency: 'AMD' as const }

  it('an account nothing converts today is left out and counted, not summed as zero', async () => {
    const view = await moneyAccountsOf(world([account('AMD', 1000n), account('USD', 500n)]), owner)
    expect(view.totals).toEqual({
      total: amd(1000n),
      spendable: amd(1000n),
      savings: amd(0n),
      uncounted: 1,
    })
  })

  it('an account the totals could not hold is left out, not a failed page', async () => {
    const huge = INT8_MAX - 10n
    const view = await moneyAccountsOf(
      world([account('AMD', huge), account('AMD', huge, true)]),
      owner,
    )
    expect(view.totals).toMatchObject({ spendable: amd(huge), savings: amd(0n), uncounted: 1 })
  })
})
