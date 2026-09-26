import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CATALOGUE_QUERY_MAX,
  catalogueEntryCodec,
  catalogueEntryOf,
  catalogueSearchQuerySchema,
  catalogueSearchResponseSchema,
  proposedItemSchema,
} from '#model/contracts/catalogue'
import { itemSchema } from '#model/entities/item'
import { ISSUE } from '#model/support/errors'

const CREATOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

const milk = itemSchema.parse({
  id: '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c',
  kind: 'product',
  name: 'Молоко «Ашхар» 3.2%',
  searchKey: 'moloko ashkhar 3.2',
  barcodes: ['4850001234567'],
  note: 'пастеризованное',
  defaultUnit: 'l',
  typicalQuantity: { milli: 900n, unit: 'l' },
  createdBy: CREATOR,
  createdAt: new Date('2026-09-18T10:00:00.000Z'),
})

const carbonara = itemSchema.parse({
  id: '1c7a3d5f-9e2b-4a4c-8d8f-6b3e2f1a4c5d',
  kind: 'dish',
  name: 'Карбонара',
  searchKey: 'karbonara',
  barcodes: [],
  note: null,
  defaultUnit: 'piece',
  typicalQuantity: null,
  createdBy: null,
  createdAt: new Date('2026-09-18T10:00:00.000Z'),
})

describe('catalogueEntryOf', () => {
  it('keeps what a result row and the sheet need, and nothing else', () => {
    expect(Object.keys(catalogueEntryOf(milk)).sort()).toEqual(
      ['defaultUnit', 'id', 'kind', 'name', 'note', 'typicalQuantity'].sort(),
    )
  })

  it('never carries the identity of whoever added the item', () => {
    // In 0.1 the device identifier is the proof of identity: a creator's id on the wire is
    // their account, handed to anyone who searches.
    const wire = JSON.stringify(z.encode(catalogueEntryCodec, catalogueEntryOf(milk)))

    expect(wire).not.toContain(CREATOR)
    expect(wire).not.toContain('createdBy')
    expect(wire).not.toContain('searchKey')
    expect(wire).not.toContain('barcodes')
  })
})

describe('catalogueEntryCodec', () => {
  it('carries a quantity as a decimal string and back', () => {
    const wire = z.encode(catalogueEntryCodec, catalogueEntryOf(milk))

    expect(wire.typicalQuantity).toEqual({ value: '0.900', unit: 'l' })
    expect(catalogueEntryCodec.parse(JSON.parse(JSON.stringify(wire)))).toEqual(
      catalogueEntryOf(milk),
    )
  })

  it('carries a dish counted in pieces with no typical quantity', () => {
    const wire = z.encode(catalogueEntryCodec, catalogueEntryOf(carbonara))

    expect(wire).toEqual({
      id: carbonara.id,
      kind: 'dish',
      name: 'Карбонара',
      note: null,
      defaultUnit: 'piece',
      typicalQuantity: null,
    })
    expect(catalogueEntryCodec.parse(wire)).toEqual(catalogueEntryOf(carbonara))
  })

  it('refuses a reply that grew a field, rather than letting it pass unread', () => {
    const wire = { ...z.encode(catalogueEntryCodec, catalogueEntryOf(milk)), createdBy: CREATOR }

    expect(catalogueEntryCodec.safeParse(wire).success).toBe(false)
  })

  it('refuses an item encoded whole', () => {
    // The allowlist is `catalogueEntryOf`; the codec is strict, so skipping it fails loudly.
    expect(() => z.encode(catalogueEntryCodec, milk as never)).toThrow()
  })
})

describe('catalogueSearchResponseSchema', () => {
  it('keeps the order it was given', () => {
    const response = { items: [milk, carbonara].map(catalogueEntryOf), near: true }
    const wire = z.encode(catalogueSearchResponseSchema, response)

    expect(catalogueSearchResponseSchema.parse(wire).items.map((item) => item.id)).toEqual([
      milk.id,
      carbonara.id,
    ])
  })

  it('accepts nothing found', () => {
    expect(catalogueSearchResponseSchema.parse({ items: [], near: false })).toEqual({
      items: [],
      near: false,
    })
  })

  it('requires `near`: an answer that does not say how close it is cannot be drawn', () => {
    expect(catalogueSearchResponseSchema.safeParse({ items: [] }).success).toBe(false)
    expect(catalogueSearchResponseSchema.safeParse({ items: [], near: 'no' }).success).toBe(false)
  })
})

describe('catalogueSearchQuerySchema', () => {
  const codeOf = (input: unknown) => {
    const parsed = catalogueSearchQuerySchema.safeParse(input)
    return parsed.success ? null : parsed.error.issues[0]?.message
  }

  it('takes the query exactly as typed — no trimming, no folding', () => {
    expect(catalogueSearchQuerySchema.parse({ q: '  Молоко  ' })).toEqual({ q: '  Молоко  ' })
  })

  it('accepts an empty query: nothing to look for is not a malformed request', () => {
    expect(catalogueSearchQuerySchema.parse({ q: '' })).toEqual({ q: '' })
  })

  it('holds the length bound at exactly its edge', () => {
    expect(codeOf({ q: 'м'.repeat(CATALOGUE_QUERY_MAX - 1) })).toBeNull()
    expect(codeOf({ q: 'м'.repeat(CATALOGUE_QUERY_MAX) })).toBeNull()
    expect(codeOf({ q: 'м'.repeat(CATALOGUE_QUERY_MAX + 1) })).toBe(ISSUE.QUERY_INVALID)
  })

  it('refuses a missing query, a repeated one and a stray parameter with one code', () => {
    expect(codeOf({})).toBe(ISSUE.QUERY_INVALID)
    expect(codeOf({ q: ['a', 'b'] })).toBe(ISSUE.QUERY_INVALID)
    expect(codeOf({ q: 'молоко', actorId: CREATOR })).toBe(ISSUE.QUERY_INVALID)
  })

  it('names the field that failed', () => {
    const parsed = catalogueSearchQuerySchema.safeParse({ q: ['a', 'b'] })

    expect(parsed.success ? null : parsed.error.issues[0]?.path).toEqual(['q'])
  })
})

describe('proposedItemSchema', () => {
  const cheese = { kind: 'product', name: 'Сыр чанах', defaultUnit: 'kg' }
  // The field that failed, or the kind of failure when it has no field — an unknown key.
  const pathOf = (input: unknown) => {
    const parsed = proposedItemSchema.safeParse(input)
    if (parsed.success) return null
    const [issue] = parsed.error.issues
    return issue && issue.path.length > 0 ? issue.path.join('.') : issue?.code
  }

  it('takes a product with a name and a unit, and the quantity from the wire', () => {
    expect(
      proposedItemSchema.parse({ ...cheese, typicalQuantity: { value: '0.3', unit: 'kg' } }),
    ).toEqual({ ...cheese, typicalQuantity: { milli: 300n, unit: 'kg' } })
  })

  it('refuses a dish until 0.3, and barcodes until 0.2', () => {
    expect(pathOf({ ...cheese, kind: 'dish' })).toBe('kind')
    expect(pathOf({ ...cheese, barcodes: ['4850001234567'] })).toBe('unrecognized_keys')
  })

  it('stays as strict as the input it narrows: no author and no key from the body', () => {
    expect(pathOf({ ...cheese, createdBy: CREATOR })).toBe('unrecognized_keys')
    expect(pathOf({ ...cheese, searchKey: 'sir' })).toBe('unrecognized_keys')
  })
})
