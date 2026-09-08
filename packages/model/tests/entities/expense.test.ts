import { describe, expect, it } from 'vitest'
import { expensePatchSchema, expenseSchema, newExpenseSchema } from '#model/entities/expense'

const ids = {
  id: 'aa11bb22-cc33-4d44-8e55-ff6677889900',
  tripId: 'd2f1a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b',
  itemId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
}

const expense = {
  ...ids,
  quantity: { milli: 1128n, unit: 'kg' },
  amount: { minor: 540312n, currency: 'AMD' },
  createdAt: new Date('2026-09-08T10:05:00Z'),
}

describe('expenseSchema', () => {
  it('accepts a full line', () => {
    expect(expenseSchema.parse(expense).amount?.minor).toBe(540312n)
  })

  it('accepts a line with neither quantity nor price — only the item is required', () => {
    expect(() => expenseSchema.parse({ ...expense, quantity: null, amount: null })).not.toThrow()
  })

  it('has no unit price to store', () => {
    expect(Object.keys(expenseSchema.shape)).not.toContain('unitPrice')
  })
})

describe('newExpenseSchema', () => {
  it('decodes quantity and amount from the wire in one parse', () => {
    const parsed = newExpenseSchema.parse({
      tripId: ids.tripId,
      itemId: ids.itemId,
      quantity: { value: '1.128', unit: 'kg' },
      amount: { amount: '5403.12', currency: 'AMD' },
    })
    expect(parsed.quantity).toEqual({ milli: 1128n, unit: 'kg' })
    expect(parsed.amount).toEqual({ minor: 540312n, currency: 'AMD' })
  })

  it('takes the item alone', () => {
    expect(() => newExpenseSchema.parse({ tripId: ids.tripId, itemId: ids.itemId })).not.toThrow()
  })

  it('refuses an id: the server hands those out', () => {
    expect(() =>
      newExpenseSchema.parse({ tripId: ids.tripId, itemId: ids.itemId, id: ids.id }),
    ).toThrow()
  })
})

describe('expensePatchSchema', () => {
  it('clears a price with null, which absent cannot express', () => {
    expect(expensePatchSchema.parse({ amount: null })).toEqual({ amount: null })
  })

  it('corrects a price', () => {
    expect(expensePatchSchema.parse({ amount: { amount: '600.00', currency: 'AMD' } })).toEqual({
      amount: { minor: 60000n, currency: 'AMD' },
    })
  })

  it('refuses an empty patch, explicit undefined included', () => {
    expect(() => expensePatchSchema.parse({})).toThrow()
    expect(() => expensePatchSchema.parse({ amount: undefined })).toThrow()
  })

  it('refuses to move a line to another trip or another item', () => {
    expect(() => expensePatchSchema.parse({ amount: null, tripId: ids.tripId })).toThrow()
    expect(() => expensePatchSchema.parse({ amount: null, itemId: ids.itemId })).toThrow()
  })
})
