import { describe, expect, it } from 'vitest'
import { parseMoney } from '@molvia/model'
import type { Currency, MoneyAccountView } from '@molvia/model'
import { defaultAccount, pageOrder, pickerGroups, removedOf } from '@/components/accounts'

let next = 0
function account(
  name: string,
  currency: Currency,
  patch: Partial<MoneyAccountView> = {},
): MoneyAccountView {
  next += 1
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
    name,
    currency,
    savings: false,
    start: parseMoney('0', currency),
    startOn: '2026-09-16',
    balance: parseMoney('0', currency),
    approximate: false,
    uncounted: 0,
    inSpend: null,
    rate: null,
    lastCheckedOn: null,
    hasOperations: false,
    archivedAt: null,
    revision: 1,
    ...patch,
  }
}

const dollarsHome = account('Доллары дома', 'USD', { savings: true })
const cashAmd = account('Наличные ֏', 'AMD')
const cardRub = account('Карта ₽', 'RUB')
const oldCard = account('Вторая карта ₽', 'RUB', { archivedAt: new Date('2026-09-21') })
const cashRub = account('Наличные ₽', 'RUB')
const all = [dollarsHome, cashAmd, cardRub, oldCard, cashRub]

describe('accounts in the order of the page', () => {
  it('puts spending before savings, keeps the order they were added, leaves the removed out', () => {
    expect(pageOrder(all).map(({ name }) => name)).toEqual([
      'Наличные ֏',
      'Карта ₽',
      'Наличные ₽',
      'Доллары дома',
    ])
    expect(removedOf(all)).toEqual([oldCard])
  })

  it('starts an operation on the first live account of its currency, or none', () => {
    expect(defaultAccount(all, 'RUB')).toBe(cardRub)
    expect(defaultAccount(all, 'USD')).toBe(dollarsHome)
    expect(defaultAccount(all, 'EUR')).toBeNull()
    // A removed account is never offered, even when it is the only one of its currency.
    expect(defaultAccount([oldCard], 'RUB')).toBeNull()
    expect(defaultAccount([], 'AMD')).toBeNull()
  })

  it('offers the other currencies to a spending and a trip only', () => {
    expect(pickerGroups(all, 'AMD', false)).toEqual({
      own: [cashAmd],
      other: [cardRub, cashRub, dollarsHome],
    })
    expect(pickerGroups(all, 'RUB', true)).toEqual({ own: [cardRub, cashRub], other: [] })
    expect(pickerGroups(all, 'EUR', true)).toEqual({ own: [], other: [] })
  })
})
