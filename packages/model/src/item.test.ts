import { describe, expect, it } from 'vitest'
import { itemSchema, newItemSchema } from './item'

const item = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  kind: 'product',
  name: 'Молоко «Ашхар»',
  searchKey: 'moloko ashkhar',
  barcodes: ['4850001234567'],
  note: 'пастеризованное, 3,2%',
  defaultUnit: 'l',
  typicalQuantity: { milli: 1000n, unit: 'l' },
  createdBy: null,
  createdAt: new Date('2026-09-08T10:00:00Z'),
}

describe('itemSchema', () => {
  it('accepts a catalogue product', () => {
    expect(itemSchema.parse(item).name).toBe('Молоко «Ашхар»')
  })

  it("parses kind 'dish', so 0.3 needs no migration", () => {
    expect(itemSchema.parse({ ...item, kind: 'dish' }).kind).toBe('dish')
  })

  it('takes an item with no barcode and one with two', () => {
    // Loose goods have none, and that is exactly where the price spread is widest.
    expect(itemSchema.parse({ ...item, barcodes: [] }).barcodes).toEqual([])
    expect(
      itemSchema.parse({ ...item, barcodes: ['4850001234567', '048500012345'] }).barcodes,
    ).toHaveLength(2)
  })

  it('rejects a barcode that is not a run of digits', () => {
    for (const code of ['485000123', 'abcdefgh', '485-000-123-4567', '123456789012345']) {
      // 9 digits is not a GTIN length; neither is 15.
      expect(() => itemSchema.parse({ ...item, barcodes: [code] })).toThrow()
    }
  })

  it('allows an item with neither note nor typical quantity', () => {
    expect(() => itemSchema.parse({ ...item, note: null, typicalQuantity: null })).not.toThrow()
  })
})

describe('newItemSchema', () => {
  const input = {
    kind: 'product',
    name: 'Молоко «Ашхар»',
    defaultUnit: 'l',
  }

  it('defaults the barcodes to an empty list rather than leaving them absent', () => {
    expect(newItemSchema.parse(input).barcodes).toEqual([])
  })

  it('decodes the quantity from the wire in the same parse', () => {
    const parsed = newItemSchema.parse({
      ...input,
      typicalQuantity: { value: '1.000', unit: 'l' },
    })
    expect(parsed.typicalQuantity).toEqual({ milli: 1000n, unit: 'l' })
  })

  it('refuses a searchKey: MOL-5 fills it, a client never does', () => {
    expect(() => newItemSchema.parse({ ...input, searchKey: 'moloko' })).toThrow()
  })

  it('refuses an id: the server hands those out', () => {
    expect(() => newItemSchema.parse({ ...input, id: item.id })).toThrow()
  })

  it('refuses a blank name instead of storing whitespace', () => {
    expect(() => newItemSchema.parse({ ...input, name: '   ' })).toThrow()
  })
})
