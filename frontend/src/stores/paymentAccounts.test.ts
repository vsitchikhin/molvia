import { beforeEach, describe, expect, it } from 'vitest'
import { parseMoney } from '@molvia/model'
import type { Currency, MoneyAccountView } from '@molvia/model'
import { receiptSlots, rememberPaymentAccount, rememberedAccount } from '@/stores/paymentAccounts'

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
let next = 0
function account(name: string, currency: Currency, archived = false): MoneyAccountView {
  next += 1
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
    name,
    currency,
    savings: false,
    start: parseMoney('0', currency),
    startOn: '2026-09-16',
    balance: parseMoney('1000', currency),
    approximate: false,
    uncounted: 0,
    inSpend: null,
    rate: null,
    lastCheckedOn: null,
    hasOperations: false,
    archivedAt: archived ? new Date('2026-10-01') : null,
    revision: 1,
  }
}

describe('the account a purchase starts on (MOL-312)', () => {
  const cash = account('Наличные ֏', 'AMD')
  const card = account('Карта ֏', 'AMD')
  const roubles = account('Карта ₽', 'RUB')
  const old = account('Старая карта ֏', 'AMD', true)
  const all = [cash, card, roubles, old]

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('is the first account of the currency with nothing remembered', () => {
    expect(rememberedAccount(all, 'AMD', receiptSlots('card'), ME)?.id).toBe(cash.id)
    expect(rememberedAccount(all, 'AMD', ['hand'], null)?.id).toBe(cash.id)
  })

  it('is the one last recorded the same way, then by any receipt, then the first', () => {
    rememberPaymentAccount(ME, 'AMD', receiptSlots('card'), roubles.id)
    expect(rememberedAccount(all, 'AMD', receiptSlots('card'), ME)?.id).toBe(roubles.id)
    // a receipt paid in cash has no way of its own yet: any receipt's
    expect(rememberedAccount(all, 'AMD', receiptSlots('cash'), ME)?.id).toBe(roubles.id)
    rememberPaymentAccount(ME, 'AMD', receiptSlots('cash'), cash.id)
    expect(rememberedAccount(all, 'AMD', receiptSlots('card'), ME)?.id).toBe(roubles.id)
    expect(rememberedAccount(all, 'AMD', receiptSlots(null), ME)?.id).toBe(cash.id)
    // must not: a record by hand is its own, and a currency is its own
    expect(rememberedAccount(all, 'AMD', ['hand'], ME)?.id).toBe(cash.id)
    expect(rememberedAccount(all, 'RUB', receiptSlots('card'), ME)?.id).toBe(roubles.id)
  })

  it('passes over an account removed or gone since, and remembers no «Без счёта»', () => {
    rememberPaymentAccount(ME, 'AMD', ['hand'], old.id)
    expect(rememberedAccount(all, 'AMD', ['hand'], ME)?.id).toBe(cash.id)
    rememberPaymentAccount(ME, 'AMD', ['hand'], card.id)
    expect(rememberedAccount([cash, roubles], 'AMD', ['hand'], ME)?.id).toBe(cash.id)
    rememberPaymentAccount(ME, 'AMD', ['hand'], null)
    expect(rememberedAccount(all, 'AMD', ['hand'], ME)?.id).toBe(card.id)
  })
})
