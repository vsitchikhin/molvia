import { describe, expect, it } from 'vitest'
import { ERROR, ISSUE } from '#model/support/errors'
import { heldEstimate, lastReceipt, ownRates, walletRate } from '#model/entities/exchange'
import type { Exchange, OfficialRateOf } from '#model/entities/exchange'
import { incomeSchema } from '#model/entities/income'
import type { Income, IncomeSource } from '#model/entities/income'
import { money } from '#model/values/money'
import type { Currency } from '#model/values/money'
import { parseRate, yerevanMidnight } from '#model/values/rates'

let sequence = 0

function nextId(): string {
  sequence += 1
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
}

/** Major units: `'20000 RUB'`. */
function toMoney(text: string) {
  const [amount = '', currency = ''] = text.split(' ')
  const [whole = '', cents = ''] = amount.split('.')
  return money(BigInt(whole) * 100n + BigInt(cents.padEnd(2, '0')), currency as Currency)
}

function exchange(given: string, received: string, on: string, held: string | null = null) {
  return {
    id: nextId(),
    actorId: '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01',
    given: toMoney(given),
    received: toMoney(received),
    exchangedOn: on,
    heldBefore: held === null ? null : toMoney(held),
    note: null,
    revision: 1,
    createdAt: new Date(`${on}T12:00:00Z`),
    amendedAt: null,
  } satisfies Exchange
}

function income(
  amount: string,
  on: string,
  held: string | null = null,
  source: IncomeSource = 'salary',
  at = '12:00:00',
): Income {
  return {
    id: nextId(),
    actorId: '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01',
    amount: toMoney(amount),
    receivedOn: on,
    heldBefore: held === null ? null : toMoney(held),
    source,
    note: null,
    revision: 1,
    createdAt: new Date(`${on}T${at}Z`),
    amendedAt: null,
  }
}

/** The official rate of RUB into a currency, the same every day. */
function officialFrom(table: Partial<Record<Currency, string>>): OfficialRateOf {
  return (currency, day) => {
    const value = table[currency]
    return value === undefined
      ? null
      : {
          base: 'RUB',
          quote: currency,
          scaled: parseRate(value),
          source: 'official',
          asOf: yerevanMidnight(day),
        }
  }
}

// The owner's example (MOL-41): 115 000 ֏ that cost 24 000 ₽ — 4.791667.
const first = exchange('20000 RUB', '100000 AMD', '2026-09-01')
const second = exchange('20000 RUB', '95000 AMD', '2026-09-15', '20000 AMD')
const bank = officialFrom({ AMD: '4.3', USD: '0.0125' })

describe('incomeSchema', () => {
  it('holds an income as the person enters it', () => {
    expect(incomeSchema.safeParse(income('99615 RUB', '2026-09-15')).success).toBe(true)
  })

  it('refuses a zero, and what was held in a currency other than the one that came in', () => {
    const zero = { ...income('1 RUB', '2026-09-15'), amount: money(0n, 'RUB') }
    expect(incomeSchema.safeParse(zero).error?.issues[0]?.message).toBe(ERROR.INVALID_AMOUNT)
    const held = { ...income('1000 AMD', '2026-09-15'), heldBefore: money(100n, 'RUB') }
    expect(incomeSchema.safeParse(held).error?.issues[0]?.message).toBe(
      ISSUE.INCOME_HELD_NOT_RECEIVED,
    )
  })

  it('refuses a source outside the owner’s list (В-3)', () => {
    const odd = { ...income('1 RUB', '2026-09-15'), source: 'lottery' }
    expect(incomeSchema.safeParse(odd).success).toBe(false)
  })
})

describe('an income in the wallet (MOL-66, В-1)', () => {
  it('weighs drams that came in, valued at the bank’s rate of their day, with what was held', () => {
    // 115 000 ֏ for 24 000 ₽, and 200 000 ֏ worth 200 000 / 4.3 = 46 511.63 ₽: 315 000 ֏ for
    // 70 511.63 ₽ — 4.467348.
    const salary = income('200000 AMD', '2026-09-20', '115000 AMD')
    const wallet = walletRate([first, second, salary], 'RUB', 'AMD', '2026-09-30', bank)
    expect(wallet).toMatchObject({ basis: 'weighted', estimated: true })
    expect(wallet?.rate.scaled).toBe(4_467_348n)
    expect(wallet?.rate.asOf).toEqual(yerevanMidnight('2026-09-20'))
  })

  it('without what was held, takes the income alone — the bank’s rate — and says so', () => {
    const salary = income('200000 AMD', '2026-09-20')
    const wallet = walletRate([first, second, salary], 'RUB', 'AMD', '2026-09-30', bank)
    expect(wallet).toMatchObject({ basis: 'income', estimated: true })
    expect(wallet?.rate.scaled).toBe(parseRate('4.3'))
  })

  it('must not move anything when it comes in the currency of conversion', () => {
    const roubles = income('99615 RUB', '2026-09-20')
    expect(walletRate([first, second, roubles], 'RUB', 'AMD', '2026-09-30', bank)).toEqual(
      walletRate([first, second], 'RUB', 'AMD', '2026-09-30', bank),
    )
  })

  it('is never valued at what the money already held cost — only at the bank’s rate', () => {
    // Drams cost 5 ₽ per 1 000 before; the income is not «more drams at 5».
    const salary = income('100000 AMD', '2026-09-20')
    expect(walletRate([first, salary], 'RUB', 'AMD', '2026-09-30', bank)?.rate.scaled).toBe(
      parseRate('4.3'),
    )
  })

  it('carries the bank’s price of dollars that came in into the drams bought with them', () => {
    // 500 $ at 0.0125 $/₽ — 80 ₽ a dollar; 100 $ → 36 150 ֏ cost 8 000 ₽: 4.51875.
    const freelance = income('500 USD', '2026-09-20', null, 'freelance')
    const drams = exchange('100 USD', '36150 AMD', '2026-09-25')
    const wallet = walletRate([freelance, drams], 'RUB', 'AMD', '2026-09-30', bank)
    expect(wallet).toMatchObject({ basis: 'last', estimated: true })
    expect(wallet?.rate.scaled).toBe(4_518_750n)
  })

  it('knows no cost without a rate of that day, and names the income it was lost on', () => {
    const salary = income('200000 AMD', '2026-09-20')
    const rates = ownRates([first, salary], 'RUB', 'AMD', '2026-09-30')
    expect(rates.wallet).toBeNull()
    expect(rates.unknownAt).toEqual({ on: '2026-09-20', given: null, reason: 'noRate' })
    // An exchange that starts the cost afresh finds it again.
    const next = exchange('20000 RUB', '95000 AMD', '2026-09-25')
    expect(walletRate([first, salary, next], 'RUB', 'AMD', '2026-09-30')?.rate.scaled).toBe(
      parseRate('4.75'),
    )
  })

  it('before the currency of conversion changed, asks no bank: the cost is of the old reckoning', () => {
    const salary = income('200000 AMD', '2026-09-20')
    const rates = ownRates([salary], 'RUB', 'AMD', '2026-09-30', bank, '2026-09-21')
    expect(rates.unknownAt).toEqual({ on: '2026-09-20', given: null, reason: 'oldReckoning' })
    // On the day of the change it counts.
    expect(ownRates([salary], 'RUB', 'AMD', '2026-09-30', bank, '2026-09-20').wallet?.basis).toBe(
      'income',
    )
  })

  it('walks an income and an exchange of one day in the order they were written', () => {
    const morning = income('200000 AMD', '2026-09-20', null, 'salary', '08:00:00')
    const evening = exchange('20000 RUB', '95000 AMD', '2026-09-20')
    expect(walletRate([evening, morning], 'RUB', 'AMD', '2026-09-30', bank)?.rate.scaled).toBe(
      parseRate('4.75'),
    )
    const late = income('200000 AMD', '2026-09-20', null, 'salary', '20:00:00')
    expect(walletRate([evening, late], 'RUB', 'AMD', '2026-09-30', bank)?.rate.scaled).toBe(
      parseRate('4.3'),
    )
  })

  it('counts nothing dated after the day asked about, and marks the incomes that gave a price', () => {
    const salary = income('200000 AMD', '2026-09-20')
    expect(walletRate([first, salary], 'RUB', 'AMD', '2026-09-19', bank)?.rate.scaled).toBe(
      parseRate('5'),
    )
    expect(ownRates([first, salary], 'RUB', 'AMD', '2026-09-30', bank).priced.has(salary.id)).toBe(
      true,
    )
  })
})

describe('the hint with incomes (Р-8)', () => {
  it('starts from an income when it is the latest money in', () => {
    const salary = income('200000 AMD', '2026-09-20')
    expect(lastReceipt([first, second, salary], 'AMD', '2026-09-30')).toBe(salary)
    expect(heldEstimate([first, second, salary], salary, 5_000_000n)).toEqual({
      held: money(15_000_000n, 'AMD'),
      whole: false,
    })
  })

  it('adds what came in after the last exchange', () => {
    const salary = income('200000 AMD', '2026-09-20')
    const dollars = income('500 USD', '2026-09-21')
    // 95 000 + 20 000 held + 200 000 that came in − 30 000 spent; the dollars are no drams.
    expect(heldEstimate([first, second, salary, dollars], second, 3_000_000n)?.held).toEqual(
      money(28_500_000n, 'AMD'),
    )
  })
})
