import { describe, expect, it } from 'vitest'
import {
  accountBalance,
  accountCheck,
  conversionsNeeded,
  heldOn,
  markOf,
  moneyAccountSchema,
  movementOf,
  operationKeyOf,
  unassignedOperations,
} from '#model/entities/money-account'
import type {
  AccountOperation,
  MoneyAccount,
  MoneyAccountCheck,
  RateBetween,
} from '#model/entities/money-account'
import { ISSUE } from '#model/support/errors'
import { money } from '#model/values/money'
import type { Currency, Money } from '#model/values/money'
import { parseRate, yerevanMidnight } from '#model/values/rates'
import type { ExchangeRate } from '#model/values/rates'

const OWNER = '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01'
let sequence = 0
const nextId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`

function toMoney(text: string): Money {
  const [amount = '', currency = ''] = text.split(' ')
  const negative = amount.startsWith('-')
  const [whole = '', cents = ''] = amount.replace('-', '').split('.')
  const minor = BigInt(whole) * 100n + BigInt(cents.padEnd(2, '0'))
  return money(negative ? -minor : minor, currency as Currency)
}

/** `rate('RUB', 'AMD', '4.15')`: one of the base is that much of the quote. */
function rate(base: Currency, quote: Currency, value: string, day = '2026-09-17'): ExchangeRate {
  return { base, quote, scaled: parseRate(value), source: 'personal', asOf: yerevanMidnight(day) }
}

function account(name: string, start: string, startOn = '2026-09-16', savings = false) {
  const amount = toMoney(start)
  return moneyAccountSchema.parse({
    id: nextId(),
    actorId: OWNER,
    name,
    currency: amount.currency,
    savings,
    start: amount,
    startOn,
    revision: 1,
    createdAt: new Date('2026-09-16T20:00:00Z'),
    archivedAt: null,
  })
}

function operation(
  kind: AccountOperation['kind'],
  amounts: string[],
  day: string,
  on: MoneyAccount | null,
  patch: Partial<AccountOperation> = {},
): AccountOperation {
  return {
    kind,
    id: nextId(),
    side: null,
    day,
    at: new Date(`${day}T12:00:00Z`),
    accountId: on?.id ?? null,
    amounts: amounts.map(toMoney),
    debited: null,
    rate: null,
    unpriced: 0,
    details: {
      categoryId: null,
      note: null,
      place: null,
      source: null,
      counterpart: null,
      items: null,
    },
    ...patch,
  }
}

const noRates: RateBetween = () => null
const rubAmd: RateBetween = (from, into) =>
  (from === 'AMD' && into === 'RUB') || (from === 'RUB' && into === 'AMD')
    ? rate('RUB', 'AMD', '4.15')
    : null

describe('moneyAccountSchema', () => {
  it('takes a start below zero — a card in debt is a name, not a kind', () => {
    expect(account('Кредитка', '-12400 RUB').start).toEqual(money(-1_240_000n, 'RUB'))
  })

  it('refuses a start in another currency than the account', () => {
    const result = moneyAccountSchema.safeParse({
      ...account('Наличные', '100 AMD'),
      start: money(100n, 'RUB'),
    })
    expect(result.error?.issues[0]?.message).toBe(ISSUE.ACCOUNT_START_NOT_OF_CURRENCY)
  })
})

describe('accountBalance', () => {
  it('is the start and what came after the start day — the start day itself is history', () => {
    const cash = account('Наличные', '241530 AMD')
    const ops = [
      operation('spending', ['-500 AMD'], '2026-09-16', cash),
      operation('spending', ['-500 AMD'], '2026-09-17', cash),
      operation('income', ['1000 AMD'], '2026-09-18', cash),
    ]
    expect(accountBalance(cash, ops, noRates)).toEqual({
      balance: toMoney('242030 AMD'),
      approximate: false,
      uncounted: 0,
    })
  })

  it('counts nothing of another account and nothing without one', () => {
    const cash = account('Наличные', '100 AMD')
    const card = account('Карта', '100 AMD')
    const ops = [
      operation('spending', ['-50 AMD'], '2026-09-17', card),
      operation('spending', ['-50 AMD'], '2026-09-17', null),
    ]
    expect(accountBalance(cash, ops, noRates).balance).toEqual(toMoney('100 AMD'))
  })

  it('goes below zero with its sign', () => {
    const cash = account('Наличные', '100 AMD')
    const ops = [operation('spending', ['-150 AMD'], '2026-09-17', cash)]
    expect(accountBalance(cash, ops, noRates).balance).toEqual(toMoney('-50 AMD'))
  })

  it('takes «списано» exactly and marks nothing approximate', () => {
    const card = account('Безнал RUB', '37776.21 RUB')
    const ops = [
      operation('spending', ['-9891 AMD'], '2026-09-17', card, {
        debited: toMoney('2331.85 RUB'),
      }),
    ]
    expect(accountBalance(card, ops, rubAmd)).toEqual({
      balance: toMoney('35444.36 RUB'),
      approximate: false,
      uncounted: 0,
    })
  })

  it('converts a spending in another currency by its day and says «≈» (Р-14)', () => {
    const card = account('Безнал RUB', '10000 RUB')
    const ops = [operation('spending', ['-9891 AMD'], '2026-09-17', card)]
    // 9 891 ֏ at 4,15 ֏ for a rouble is 2 383,37 ₽.
    expect(accountBalance(card, ops, rubAmd)).toEqual({
      balance: toMoney('7616.63 RUB'),
      approximate: true,
      uncounted: 0,
    })
  })

  it('counts by the spending’s own snapshot when it is of the pair — one number with the month', () => {
    const card = account('Безнал RUB', '10000 RUB')
    const ops = [
      operation('spending', ['-9891 AMD'], '2026-09-17', card, {
        rate: rate('RUB', 'AMD', '4.24'),
      }),
    ]
    // The snapshot of the day, not what the rules say today: 9 891 / 4,24 = 2 332,78.
    expect(accountBalance(card, ops, rubAmd).balance).toEqual(toMoney('7667.22 RUB'))
  })

  it('leaves out what no rate counts, and says so', () => {
    const card = account('Карта $', '100 USD')
    const ops = [
      operation('spending', ['-24.99 EUR'], '2026-09-17', card),
      operation('spending', ['-10 USD'], '2026-09-18', card),
    ]
    expect(accountBalance(card, ops, noRates)).toEqual({
      balance: toMoney('90 USD'),
      approximate: true,
      uncounted: 1,
    })
  })

  it('moves a trip by every currency it was paid in, and by «списано» whole when there is one', () => {
    const cash = account('Наличные', '10000 AMD')
    const mixed = operation('trip', ['-3000 AMD', '-100 RUB'], '2026-09-17', cash)
    // 3 000 ֏ exactly, and 100 ₽ at 4,15 is 415 ֏ — «≈».
    expect(movementOf(mixed, 'AMD', rubAmd)).toEqual({
      amount: toMoney('-3415 AMD'),
      approximate: true,
    })
    const card = account('Безнал RUB', '5000 RUB')
    const paid = { ...mixed, accountId: card.id, debited: toMoney('750 RUB') }
    expect(movementOf(paid, 'RUB', rubAmd)).toEqual({
      amount: toMoney('-750 RUB'),
      approximate: false,
    })
  })

  it('moves nothing for a trip with no price yet', () => {
    const cash = account('Наличные', '10000 AMD')
    const ops = [operation('trip', [], '2026-09-17', cash, { unpriced: 3 })]
    expect(accountBalance(cash, ops, noRates).balance).toEqual(toMoney('10000 AMD'))
  })
})

describe('accountCheck', () => {
  it('says the difference as the fact less the count, and what could have made it', () => {
    const cash = account('Наличные ֏', '195264 AMD')
    const card = account('Карта ₽', '1000 RUB')
    const coffee = operation('spending', ['-3932 AMD'], '2026-09-21', null)
    const taxi = operation('spending', ['-1200 AMD'], '2026-09-22', null)
    const inRoubles = operation('spending', ['-100 RUB'], '2026-09-22', null)
    const onCard = operation('spending', ['-100 RUB'], '2026-09-22', card)
    const result = accountCheck(
      cash,
      [coffee, taxi, inRoubles, onCard],
      null,
      toMoney('190132 AMD'),
      noRates,
    )
    expect(result.counted).toEqual(toMoney('195264 AMD'))
    expect(result.difference).toEqual(toMoney('-5132 AMD'))
    expect(result.since).toBe('2026-09-16')
    expect(result.reasons.map(({ kind, operation }) => [kind, operation.id])).toEqual([
      ['unassigned', taxi.id],
      ['unassigned', coffee.id],
    ])
  })

  it('names a spending in another currency without «списано», and not one with it', () => {
    const card = account('Карта ₽', '10000 RUB')
    const hosting = operation('spending', ['-24.99 EUR'], '2026-09-17', card)
    const delivery = operation('spending', ['-9891 AMD'], '2026-09-18', card, {
      debited: toMoney('2331.85 RUB'),
    })
    const groceries = operation('spending', ['-5000 AMD'], '2026-09-19', card)
    const result = accountCheck(
      card,
      [hosting, delivery, groceries],
      null,
      toMoney('0 RUB'),
      rubAmd,
    )
    expect(result.reasons.map(({ kind, operation }) => [kind, operation.id])).toEqual([
      ['noDebited', groceries.id],
      ['uncounted', hosting.id],
    ])
  })

  it('names a trip with purchases that have no price', () => {
    const cash = account('Наличные', '10000 AMD')
    const trip = operation('trip', ['-3480 AMD'], '2026-09-25', cash, { unpriced: 2 })
    const result = accountCheck(cash, [trip], null, toMoney('6520 AMD'), noRates)
    expect(result.difference).toEqual(toMoney('0 AMD'))
    expect(result.reasons).toEqual([{ kind: 'unpriced', operation: trip }])
  })

  it('looks from the last check, and past it for one dated back but written after', () => {
    const cash = account('Наличные', '10000 AMD')
    const last: MoneyAccountCheck = {
      id: nextId(),
      accountId: cash.id,
      checkedOn: '2026-09-20',
      fact: toMoney('10000 AMD'),
      counted: toMoney('10000 AMD'),
      createdAt: new Date('2026-09-20T18:00:00Z'),
    }
    const before = operation('spending', ['-100 AMD'], '2026-09-19', null)
    const sameDayEarlier = operation('spending', ['-100 AMD'], '2026-09-20', null, {
      at: new Date('2026-09-20T10:00:00Z'),
    })
    const sameDayLater = operation('spending', ['-100 AMD'], '2026-09-20', null, {
      at: new Date('2026-09-20T19:00:00Z'),
    })
    const datedBack = operation('spending', ['-100 AMD'], '2026-09-18', null, {
      at: new Date('2026-09-22T09:00:00Z'),
    })
    const result = accountCheck(
      cash,
      [before, sameDayEarlier, sameDayLater, datedBack],
      last,
      toMoney('10000 AMD'),
      noRates,
    )
    expect(result.since).toBe('2026-09-20')
    expect(new Set(result.reasons.map(({ operation }) => operation.id))).toEqual(
      new Set([sameDayLater.id, datedBack.id]),
    )
  })

  it('never names what is before the start, which no balance holds', () => {
    const cash = account('Наличные', '10000 AMD')
    const old = operation('spending', ['-100 AMD'], '2026-09-16', null, {
      at: new Date('2026-09-22T09:00:00Z'),
    })
    expect(accountCheck(cash, [old], null, toMoney('1 AMD'), noRates).reasons).toEqual([])
  })
})

describe('unassignedOperations', () => {
  it('keeps old cash spendings in view though the card was checked since (Р-16)', () => {
    const cash = account('Наличные ֏', '100 AMD')
    const card = account('Карта ֏', '100 AMD')
    const checks = new Map<string, MoneyAccountCheck>([
      [
        card.id,
        {
          id: nextId(),
          accountId: card.id,
          checkedOn: '2026-09-25',
          fact: toMoney('100 AMD'),
          counted: toMoney('100 AMD'),
          createdAt: new Date('2026-09-25T18:00:00Z'),
        },
      ],
    ])
    const old = operation('spending', ['-50 AMD'], '2026-09-18', null)
    expect(unassignedOperations([cash, card], checks, [old])).toEqual([old])
    // Checked on both, it is out of every window.
    const both = new Map(checks)
    both.set(cash.id, { ...checks.get(card.id)!, id: nextId(), accountId: cash.id })
    expect(unassignedOperations([cash, card], both, [old])).toEqual([])
  })

  it('asks nothing of a currency with no account, nor of what is on an account', () => {
    const cash = account('Наличные ֏', '100 AMD')
    const dollars = operation('spending', ['-5 USD'], '2026-09-18', null)
    const assigned = operation('spending', ['-5 AMD'], '2026-09-18', cash)
    const beforeStart = operation('spending', ['-5 AMD'], '2026-09-10', null)
    expect(unassignedOperations([cash], new Map(), [dollars, assigned, beforeStart])).toEqual([])
  })

  it('lists each half of an exchange under its own currency', () => {
    const cash = account('Наличные ֏', '100 AMD')
    const card = account('Карта ₽', '100 RUB')
    const id = nextId()
    const given = operation('exchange', ['-6250 RUB'], '2026-09-23', null, { id, side: 'given' })
    const received = operation('exchange', ['25000 AMD'], '2026-09-23', null, {
      id,
      side: 'received',
    })
    const listed = unassignedOperations([cash, card], new Map(), [given, received])
    expect(listed.map(operationKeyOf).map(({ id: key }) => key)).toEqual(
      expect.arrayContaining([`${id}:RUB`, `${id}:AMD`]),
    )
  })
})

describe('heldOn', () => {
  it('sums the accounts of the currency at the end of the day, the amended one left out', () => {
    const cash = account('Наличные', '1000 AMD')
    const card = account('Карта', '500 AMD')
    const exchange = operation('exchange', ['25000 AMD'], '2026-09-23', cash, {
      side: 'received',
    })
    const ops = [
      operation('spending', ['-100 AMD'], '2026-09-20', cash),
      operation('spending', ['-100 AMD'], '2026-09-24', card),
      exchange,
    ]
    expect(heldOn([cash, card], ops, 'AMD', '2026-09-23', noRates, exchange.id)).toEqual({
      held: toMoney('1400 AMD'),
      approximate: false,
    })
  })

  it('cannot say when an account of the currency starts on that day or later', () => {
    const cash = account('Наличные', '1000 AMD')
    const late = account('Карта', '500 AMD', '2026-09-23')
    expect(heldOn([cash, late], [], 'AMD', '2026-09-23', noRates)).toBeNull()
    expect(heldOn([cash], [], 'RUB', '2026-09-23', noRates)).toBeNull()
  })
})

describe('conversionsNeeded', () => {
  it('names a rate only for an amount on an account of another currency without «списано»', () => {
    const card = account('Карта ₽', '100 RUB')
    const ops = [
      operation('spending', ['-100 AMD'], '2026-09-17', card),
      operation('spending', ['-100 AMD'], '2026-09-17', card),
      operation('spending', ['-100 AMD'], '2026-09-18', card, { debited: toMoney('25 RUB') }),
      operation('spending', ['-100 AMD'], '2026-09-18', null),
      operation('spending', ['-100 RUB'], '2026-09-18', card),
    ]
    expect(conversionsNeeded([card], ops)).toEqual([
      { from: 'AMD', into: 'RUB', day: '2026-09-17' },
    ])
  })
})

describe('markOf', () => {
  it('is the evening of the start before any check', () => {
    const cash = account('Наличные', '1 AMD')
    expect(markOf(cash, null)).toEqual({ day: '2026-09-16', at: null })
  })
})
