import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { ERROR, formatUnitPrice, parseMoney, parseQuantity, tripViewCodec } from '@molvia/model'
import type { CatalogueEntry, TripExpenseView, TripView } from '@molvia/model'
import { useItemDetails } from '@/composables/useItemDetails'
import type { ItemDetailsInput } from '@/composables/useItemDetails'

function entry(over: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return {
    id: 'dddddddd-0000-4000-8000-000000000001',
    kind: 'product',
    name: 'Молоко «Ашхар»',
    note: null,
    defaultUnit: 'l',
    typicalQuantity: null,
    ...over,
  }
}

function trip(rate: string | null = null): TripView {
  return tripViewCodec.parse({
    id: 'bbbbbbbb-0000-4000-8000-000000000001',
    startedAt: '2026-09-19T08:00:00.000Z',
    finishedAt: null,
    currency: 'AMD',
    rate: rate && {
      base: 'RUB',
      quote: 'AMD',
      rate,
      source: 'official',
      asOf: '2026-09-19T00:00:00.000Z',
    },
    rateProvider: rate && 'cba',
    rateJump: null,
    rateStale: false,
    place: { id: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'store', name: 'Ереван Сити' },
    expenses: [],
    total: [],
    converted: null,
  })
}

function details(over: Partial<ItemDetailsInput> = {}) {
  return useItemDetails({ entry: entry(), trip: trip(), currency: 'AMD', ...over })
}

const digits = (text: string): string => text.replace(/[\s\u00a0\u202f]/g, '')

describe('useItemDetails', () => {
  it.each([
    ['570', '1', 'l', '570,00֏'],
    ['520', '0,9', 'l', '577,78֏'],
    ['5 403,12', '1,128', 'kg', '4790,00֏'],
    ['250', '1', 'piece', '250,00֏'],
  ] as const)(
    '%s ֏ for %s %s is %s per unit — the check values of the sheet',
    (price, qty, unit, per) => {
      const sheet = details()
      sheet.amount.value = price
      sheet.quantity.value = qty
      sheet.unit.value = unit
      const shown = sheet.unitPrice.value
      expect(shown && digits(formatUnitPrice(shown))).toBe(per)
      expect(shown?.unit).toBe(unit)
    },
  )

  it('reads a comma and a point as the same quantity', () => {
    const comma = details()
    comma.quantity.value = '1,128'
    const point = details()
    point.quantity.value = '1.128'
    expect(comma.body(null).quantity).toEqual(point.body(null).quantity)
  })

  it('recomputes the moment the unit changes', () => {
    const sheet = details()
    sheet.amount.value = '500'
    sheet.quantity.value = '2'
    sheet.unit.value = 'kg'
    expect(sheet.unitPrice.value?.unit).toBe('kg')
    sheet.unit.value = 'piece'
    expect(sheet.unitPrice.value?.unit).toBe('piece')
  })

  it('has no unit price until both halves are there and valid', () => {
    const sheet = details()
    expect(sheet.unitPrice.value).toBeNull()
    sheet.amount.value = '520'
    expect(sheet.unitPrice.value).toBeNull()
    sheet.quantity.value = '1,'
    expect(sheet.unitPrice.value).toBeNull()
  })

  it('shows no error while a number is on its way, and shows it once the field is left', () => {
    const sheet = details()
    sheet.quantity.value = '1,'
    expect(sheet.errors.value.quantity).toBeNull()
    sheet.leave('quantity')
    expect(sheet.errors.value.quantity).toBe(ERROR.INVALID_QUANTITY)
    sheet.quantity.value = '1,5'
    expect(sheet.errors.value.quantity).toBeNull()
  })

  it('says at once that half a piece is not a quantity', async () => {
    const sheet = details()
    sheet.quantity.value = '0,5'
    sheet.unit.value = 'kg'
    await nextTick()
    expect(sheet.errors.value.quantity).toBeNull()

    sheet.unit.value = 'piece'
    await nextTick()
    expect(sheet.errors.value.quantity).toBe(ERROR.INVALID_QUANTITY)
  })

  it('does not touch an empty quantity when the unit changes', async () => {
    const sheet = details()
    sheet.unit.value = 'piece'
    await nextTick()
    expect(sheet.errors.value.quantity).toBeNull()
  })

  describe('what it opens with (В-4)', () => {
    it('takes the typical quantity of the item', () => {
      const sheet = details({ entry: entry({ typicalQuantity: parseQuantity('0.9', 'l') }) })
      expect(sheet.quantity.value).toBe('0,9')
      expect(sheet.unit.value).toBe('l')
    })

    it('counts a piece as one', () => {
      const sheet = details({ entry: entry({ defaultUnit: 'piece' }) })
      expect(sheet.quantity.value).toBe('1')
      expect(sheet.unit.value).toBe('piece')
    })

    it('leaves a weight empty rather than guess a kilo', () => {
      const sheet = details({ entry: entry({ defaultUnit: 'kg' }) })
      expect(sheet.quantity.value).toBe('')
      expect(sheet.unit.value).toBe('kg')
    })

    it('starts in the currency it was given, with the point of the interface', () => {
      const sheet = details({
        currency: 'RUB',
        separator: '.',
        entry: entry({ typicalQuantity: parseQuantity('1.5', 'kg') }),
      })
      expect(sheet.currency.value).toBe('RUB')
      expect(sheet.quantity.value).toBe('1.5')
    })
  })

  describe('the body of «Добавить в поход»', () => {
    it('carries the item and the query alone when nothing else is filled in', () => {
      const sheet = details({ entry: entry({ defaultUnit: 'kg' }) })
      expect(sheet.body('мол')).toEqual({
        id: sheet.expenseId,
        itemId: entry().id,
        query: 'мол',
      })
    })

    it('carries the quantity and the price in the currency chosen', () => {
      const sheet = details()
      sheet.quantity.value = '0,9'
      sheet.amount.value = '520'
      sheet.currency.value = 'RUB'
      expect(sheet.body(null)).toEqual({
        id: sheet.expenseId,
        itemId: entry().id,
        quantity: { milli: 900n, unit: 'l' },
        amount: { minor: 52000n, currency: 'RUB' },
      })
    })

    it('names the purchase once, when the sheet opens', () => {
      const sheet = details()
      expect(sheet.body(null).id).toBe(sheet.body('мол').id)
      expect(sheet.expenseId).toMatch(/^[0-9a-f-]{36}$/)
      expect(details().expenseId).not.toBe(sheet.expenseId)
    })
  })

  describe('validate (В-5)', () => {
    it('lets blanks through — they mean «later»', () => {
      expect(details({ entry: entry({ defaultUnit: 'kg' }) }).validate()).toBeNull()
    })

    it('names the first field that holds something that is not a value, and shows its error', () => {
      const sheet = details()
      sheet.amount.value = '57о'
      expect(sheet.validate()).toBe('amount')
      expect(sheet.errors.value.amount).toBe(ERROR.INVALID_AMOUNT)

      sheet.quantity.value = '0,5'
      sheet.unit.value = 'piece'
      expect(sheet.validate()).toBe('quantity')
    })
  })

  describe('the patch of «Сохранить»', () => {
    const row: TripExpenseView = {
      id: 'cccccccc-0000-4000-8000-000000000001',
      createdAt: new Date('2026-09-19T08:10:00.000Z'),
      item: entry(),
      quantity: parseQuantity('0.35', 'kg'),
      amount: parseMoney('1540', 'AMD'),
      unitPrice: null,
    }

    it('opens with the row as it was written', () => {
      const sheet = details({ expense: row, currency: 'AMD' })
      expect(sheet.quantity.value).toBe('0,35')
      expect(sheet.unit.value).toBe('kg')
      expect(sheet.amount.value).toBe('1540')
      expect(sheet.expenseId).toBe(row.id)
    })

    it('is nothing when nothing changed', () => {
      expect(details({ expense: row }).patch()).toBeNull()
    })

    it('carries only what changed', () => {
      const sheet = details({ expense: row })
      sheet.amount.value = '1600'
      expect(sheet.patch()).toEqual({ amount: { minor: 160000n, currency: 'AMD' } })
    })

    it('erases a cleared field with null', () => {
      const sheet = details({ expense: row })
      sheet.amount.value = ''
      expect(sheet.patch()).toEqual({ amount: null })
    })

    it('sees a change of unit or of currency alone', () => {
      const unit = details({ expense: { ...row, quantity: parseQuantity('2', 'kg') } })
      unit.unit.value = 'piece'
      expect(unit.patch()).toEqual({ quantity: { milli: 2000n, unit: 'piece' } })

      const currency = details({ expense: row })
      currency.currency.value = 'RUB'
      expect(currency.patch()).toEqual({ amount: { minor: 154000n, currency: 'RUB' } })
    })

    it('opens an unpriced row empty, in the currency it was given', () => {
      const sheet = details({ expense: { ...row, amount: null, quantity: null }, currency: 'AMD' })
      expect(sheet.amount.value).toBe('')
      expect(sheet.quantity.value).toBe('')
      expect(sheet.unit.value).toBe('l')
      expect(sheet.patch()).toBeNull()
    })
  })

  describe('the estimate in the income currency (В-7)', () => {
    it('converts the price of the package by the rate of the trip', () => {
      const sheet = details({ trip: trip('4.82') })
      sheet.amount.value = '520'
      // 520 / 4,82 = 107,88 ₽
      expect(sheet.converted.value).toEqual({ minor: 10788n, currency: 'RUB' })
    })

    it('has none without a rate, without a price, or for a price the rate does not convert', () => {
      const none = details()
      none.amount.value = '520'
      expect(none.converted.value).toBeNull()

      const blank = details({ trip: trip('4.82') })
      expect(blank.converted.value).toBeNull()

      const roubles = details({ trip: trip('4.82') })
      roubles.amount.value = '520'
      roubles.currency.value = 'RUB'
      expect(roubles.converted.value).toBeNull()
    })

    it('shows no estimate rather than failing on one that does not fit', () => {
      const sheet = details({ trip: trip('0.01') })
      sheet.amount.value = '92233720368547758'
      expect(sheet.converted.value).toBeNull()
    })
  })

  describe('after the adversarial round', () => {
    it('follows the trip that arrives after it opened, until a currency is picked (A5)', async () => {
      const arriving = ref<TripView | null>(null)
      const sheet = details({ trip: () => arriving.value, currency: 'USD' })
      expect(sheet.currency.value).toBe('USD')

      arriving.value = trip()
      await nextTick()
      expect(sheet.currency.value).toBe('AMD')

      sheet.currency.value = 'EUR'
      await nextTick()
      arriving.value = { ...trip(), currency: 'RUB' }
      await nextTick()
      expect(sheet.currency.value).toBe('EUR')
    })

    it('does not change the currency under a price already typed (Р-12, Б4)', async () => {
      const arriving = ref<TripView | null>(trip())
      const sheet = details({ trip: () => arriving.value, currency: 'AMD' })
      sheet.amount.value = '520'
      await nextTick()

      arriving.value = { ...trip(), currency: 'USD' }
      await nextTick()
      expect(sheet.currency.value).toBe('AMD')
      expect(sheet.body(null).amount).toEqual(parseMoney('520', 'AMD'))
    })

    it('takes a field holding only characters that draw nothing for an empty one (A7)', () => {
      const sheet = details()
      sheet.amount.value = String.fromCodePoint(0x200b)
      expect(sheet.validate()).toBeNull()
      expect(sheet.body(null).amount).toBeUndefined()

      sheet.amount.value = `52${String.fromCodePoint(0x200b)}0`
      expect(sheet.body(null).amount).toEqual(parseMoney('520', 'AMD'))
    })

    it('refuses a price the trip cannot add to what it holds (A9)', () => {
      const held = [{ minor: 5_000_000_000_000_000_000n, currency: 'AMD' as const }]
      const sheet = details({ occupied: held })
      sheet.amount.value = '50 000 000 000 000 000'
      expect(sheet.validate()).toBe('amount')
      expect(sheet.errors.value.amount).toBe(ERROR.INVALID_AMOUNT)

      sheet.currency.value = 'RUB'
      expect(sheet.validate()).toBeNull()
    })

    it('counts an amended row once, not twice, against what the trip holds', () => {
      const amount = { minor: 5_000_000_000_000_000_000n, currency: 'AMD' as const }
      const row: TripExpenseView = {
        id: 'cccccccc-0000-4000-8000-000000000001',
        createdAt: new Date('2026-09-19T08:10:00.000Z'),
        item: entry(),
        quantity: null,
        amount,
        unitPrice: null,
      }
      const sheet = details({ expense: row, occupied: [amount] })
      expect(sheet.validate()).toBeNull()
    })

    it('names a purchase where randomUUID is missing — plain http on the LAN (Р-6)', () => {
      const original = Object.getOwnPropertyDescriptor(crypto, 'randomUUID')
      Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
      try {
        const id = details().expenseId
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
        expect(details().expenseId).not.toBe(id)
      } finally {
        if (original) Object.defineProperty(crypto, 'randomUUID', original)
        else Reflect.deleteProperty(crypto, 'randomUUID')
      }
    })
  })
})
