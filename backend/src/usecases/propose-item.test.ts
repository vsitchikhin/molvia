import { describe, expect, it } from 'vitest'
import { itemSchema, proposedItemSchema } from '@molvia/model'
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
    ...overrides,
  }
}

describe('proposeItem', () => {
  it('asks for the item in the name of the owner it was given, with no barcodes', async () => {
    const asked: [NewItem, string][] = []
    const items = fakeItems({
      createUnlessNamed: (item, createdBy) => {
        asked.push([item, createdBy])
        return Promise.resolve({ item: { ...existing, createdBy }, created: true })
      },
    })

    const result = await proposeItem(items, ACTOR, input)

    expect(asked).toEqual([[{ ...input, barcodes: [] }, ACTOR]])
    expect(result.created).toBe(true)
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
})
