import { describe, expect, it } from 'vitest'
import { ERROR, itemSchema, proposedItemSchema } from '@molvia/model'
import type { NewItem } from '@molvia/model'
import type { ItemRepository } from '@/db/items-repository'
import { proposeItem } from './propose-item'

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

const input = proposedItemSchema.parse({
  kind: 'product',
  name: 'Сыр чанах Ашхар',
  defaultUnit: 'kg',
})

const existing = itemSchema.parse({
  id: '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c',
  kind: 'product',
  name: 'сыр чанах ашхар',
  searchKey: 'sir chanakh ashkhar',
  barcodes: [],
  note: 'на развес',
  defaultUnit: 'kg',
  typicalQuantity: null,
  createdBy: null,
  createdAt: new Date('2026-09-18T10:00:00.000Z'),
})

function fakeItems(overrides: Partial<ItemRepository> = {}): ItemRepository {
  return {
    create: () => Promise.reject(new Error('create was not expected')),
    byId: () => Promise.reject(new Error('byId was not expected')),
    byIds: () => Promise.reject(new Error('byIds was not expected')),
    createUnlessNamed: () => Promise.reject(new Error('createUnlessNamed was not expected')),
    search: () => Promise.reject(new Error('search was not expected')),
    byBarcode: () => Promise.reject(new Error('byBarcode was not expected')),
    attachBarcode: () => Promise.reject(new Error('attachBarcode was not expected')),
    detachBarcode: () => Promise.reject(new Error('detachBarcode was not expected')),
    ...overrides,
  }
}

describe('proposeItem', () => {
  it('asks for the item in the name of the owner it was given, with no barcodes', async () => {
    const asked: [NewItem, string | null][] = []
    const items = fakeItems({
      createUnlessNamed: (item, createdBy) => {
        asked.push([item, createdBy])
        return Promise.resolve({ item: { ...existing, createdBy }, created: true })
      },
    })

    const result = await proposeItem(items, ACTOR, input)

    expect(asked).toEqual([[{ ...input, barcodes: [] }, ACTOR]])
    expect(result).toMatchObject({ created: true })
  })

  it('passes on the item already there, and that it was already there', async () => {
    const items = fakeItems({
      createUnlessNamed: () => Promise.resolve({ item: existing, created: false }),
    })

    await expect(proposeItem(items, ACTOR, input)).resolves.toEqual({
      item: existing,
      created: false,
    })
  })

  it('writes the codes in the form the scanner reads them as (MOL-100, Р-1)', async () => {
    const asked: NewItem[] = []
    const items = fakeItems({
      createUnlessNamed: (item) => {
        asked.push(item)
        return Promise.resolve({ item: existing, created: true })
      },
    })

    await proposeItem(items, ACTOR, { ...input, barcodes: ['012345678905', '96385074'] })

    expect(asked[0]?.barcodes).toEqual(['0012345678905', '96385074'])
  })

  it('refuses a code whose check digit does not hold, and asks for nothing', async () => {
    const items = fakeItems()

    await expect(
      proposeItem(items, ACTOR, { ...input, barcodes: ['4850000000003'] }),
    ).rejects.toMatchObject({ code: ERROR.BARCODE_CHECK_DIGIT })
  })

  it('passes on the item that holds a code already, and nothing else', async () => {
    const items = fakeItems({ createUnlessNamed: () => Promise.resolve({ taken: existing }) })

    await expect(
      proposeItem(items, ACTOR, { ...input, barcodes: ['4850000000007'] }),
    ).resolves.toEqual({ taken: existing })
  })
})
