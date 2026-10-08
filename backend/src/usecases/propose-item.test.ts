import { describe, expect, it } from 'vitest'
import { ERROR, itemSchema, proposedItemSchema } from '@molvia/model'
import type { ItemOrigin, NewItem } from '@molvia/model'
import type { ItemRepository } from '@/db/items-repository'
import { proposeItem } from './propose-item'

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

/** The cache of Open Food Facts that named none of the codes. */
const NAMED_NOTHING = { named: () => Promise.resolve(false) }

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
    lockForRecord: () => Promise.resolve(),
    nodes: () => Promise.reject(new Error('nodes was not expected')),
    attachBarcode: () => Promise.reject(new Error('attachBarcode was not expected')),
    detachBarcode: () => Promise.reject(new Error('detachBarcode was not expected')),
    ...overrides,
  }
}

describe('proposeItem', () => {
  it('asks for the item in the name of the owner it was given, with no barcodes', async () => {
    const asked: [NewItem, string | null, ItemOrigin | null | undefined][] = []
    const items = fakeItems({
      createUnlessNamed: (item, createdBy, origin) => {
        asked.push([item, createdBy, origin])
        return Promise.resolve({ item: { ...existing, createdBy }, created: true })
      },
    })

    const result = await proposeItem(items, NAMED_NOTHING, ACTOR, input)

    expect(asked).toEqual([[{ ...input, barcodes: [] }, ACTOR, null]])
    expect(result).toMatchObject({ created: true })
  })

  it('passes on the item already there, and that it was already there', async () => {
    const items = fakeItems({
      createUnlessNamed: () => Promise.resolve({ item: existing, created: false }),
    })

    await expect(proposeItem(items, NAMED_NOTHING, ACTOR, input)).resolves.toEqual({
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

    await proposeItem(items, NAMED_NOTHING, ACTOR, {
      ...input,
      barcodes: ['012345678905', '96385074'],
    })

    expect(asked[0]?.barcodes).toEqual(['0012345678905', '96385074'])
  })

  it('refuses a code whose check digit does not hold, and asks for nothing', async () => {
    const items = fakeItems()

    await expect(
      proposeItem(items, NAMED_NOTHING, ACTOR, { ...input, barcodes: ['4850000000003'] }),
    ).rejects.toMatchObject({ code: ERROR.BARCODE_CHECK_DIGIT })
  })

  it('passes on the item that holds a code already, and nothing else', async () => {
    const items = fakeItems({ createUnlessNamed: () => Promise.resolve({ taken: existing }) })

    await expect(
      proposeItem(items, NAMED_NOTHING, ACTOR, { ...input, barcodes: ['4850000000007'] }),
    ).resolves.toEqual({ taken: existing })
  })

  it('marks a new item proposed with a code Open Food Facts named, asked by the written forms (MOL-162)', async () => {
    const origins: (ItemOrigin | null | undefined)[] = []
    const asked: (readonly string[])[] = []
    const items = fakeItems({
      createUnlessNamed: (_item, _createdBy, origin) => {
        origins.push(origin)
        return Promise.resolve({ item: existing, created: true })
      },
    })
    const hints = {
      named: (codes: readonly string[]) => {
        asked.push(codes)
        return Promise.resolve(true)
      },
    }

    await proposeItem(items, hints, ACTOR, { ...input, barcodes: ['012345678905'] })

    expect(asked).toEqual([['0012345678905']])
    expect(origins).toEqual(['open_food_facts'])
  })

  it('leaves an item proposed without a code unmarked', async () => {
    const origins: (ItemOrigin | null | undefined)[] = []
    const items = fakeItems({
      createUnlessNamed: (_item, _createdBy, origin) => {
        origins.push(origin)
        return Promise.resolve({ item: existing, created: true })
      },
    })

    await proposeItem(items, NAMED_NOTHING, ACTOR, input)

    expect(origins).toEqual([null])
  })
})
