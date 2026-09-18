import { describe, expect, it } from 'vitest'
import { itemSchema, newItemSchema } from '@molvia/model'
import type { ItemKind, NewItem } from '@molvia/model'
import type { ItemRepository } from '@/db/items-repository'
import { proposeItem } from './propose-item'

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

const input = newItemSchema.parse({ kind: 'product', name: 'Сыр чанах Ашхар', defaultUnit: 'kg' })

const existing = itemSchema.parse({
  id: '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c',
  kind: 'product',
  name: 'сыр чанах ашхар',
  searchKey: 'syr chanakh ashkhar',
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
    byNameKey: () => Promise.reject(new Error('byNameKey was not expected')),
    search: () => Promise.reject(new Error('search was not expected')),
    ...overrides,
  }
}

describe('proposeItem', () => {
  it('creates the item in the name of the owner it was given', async () => {
    const created: [NewItem, string | null][] = []
    const items = fakeItems({
      byNameKey: () => Promise.resolve(null),
      create: (item, createdBy) => {
        created.push([item, createdBy])
        return Promise.resolve({ ...existing, name: item.name, createdBy })
      },
    })

    const result = await proposeItem(items, ACTOR, input)

    expect(created).toEqual([[input, ACTOR]])
    expect(result.created).toBe(true)
    expect(result.item.createdBy).toBe(ACTOR)
  })

  it('returns the item already there instead of adding it twice', async () => {
    const asked: [ItemKind, string][] = []
    const items = fakeItems({
      byNameKey: (kind, name) => {
        asked.push([kind, name])
        return Promise.resolve(existing)
      },
    })

    // The default fake throws on create — reaching it would fail this test.
    await expect(proposeItem(items, ACTOR, input)).resolves.toEqual({
      item: existing,
      created: false,
    })
    expect(asked).toEqual([['product', 'Сыр чанах Ашхар']])
  })

  it('does not dress the existing item in the fields sent now', async () => {
    const items = fakeItems({ byNameKey: () => Promise.resolve(existing) })
    const differently = { ...input, note: 'в брикете', defaultUnit: 'piece' } as const

    const result = await proposeItem(items, ACTOR, differently)

    expect(result.item.note).toBe('на развес')
    expect(result.item.defaultUnit).toBe('kg')
  })
})
