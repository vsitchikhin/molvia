import { describe, expect, it } from 'vitest'
import { ERROR, itemSchema } from '@molvia/model'
import type { ItemRepository } from '@/db/items-repository'
import { attachBarcode, detachBarcode } from './attach-barcode'

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const ITEM = '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c'

const item = itemSchema.parse({
  id: ITEM,
  kind: 'product',
  name: 'Сметана Ашхар 20%',
  searchKey: 'smetana ashhar 20%',
  barcodes: ['0012345678905'],
  note: null,
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

describe('attachBarcode', () => {
  it('writes the code in the scanner’s form, in the name of the person who asked', async () => {
    const asked: [string, string, string][] = []
    const items = fakeItems({
      attachBarcode: (itemId, code, actorId) => {
        asked.push([itemId, code, actorId])
        return Promise.resolve({ item, added: true })
      },
    })

    await expect(attachBarcode(items, ACTOR, ITEM, '012345678905')).resolves.toEqual({
      item,
      added: true,
    })
    expect(asked).toEqual([[ITEM, '0012345678905', ACTOR]])
  })

  it('refuses a code whose check digit does not hold without asking the catalogue', async () => {
    await expect(attachBarcode(fakeItems(), ACTOR, ITEM, '4850000000003')).rejects.toMatchObject({
      code: ERROR.BARCODE_CHECK_DIGIT,
    })
  })

  it('answers a missing item as not found', async () => {
    const items = fakeItems({ attachBarcode: () => Promise.resolve(null) })

    await expect(attachBarcode(items, ACTOR, ITEM, '4850000000007')).rejects.toMatchObject({
      code: ERROR.NOT_FOUND,
    })
  })

  it('passes on the item that holds the code', async () => {
    const items = fakeItems({ attachBarcode: () => Promise.resolve({ taken: item }) })

    await expect(attachBarcode(items, ACTOR, ITEM, '4850000000007')).resolves.toEqual({
      taken: item,
    })
  })
})

describe('detachBarcode', () => {
  it('lets the code go, and answers a missing item as not found', async () => {
    const asked: [string, string][] = []
    const items = fakeItems({
      detachBarcode: (itemId, code) => {
        asked.push([itemId, code])
        return Promise.resolve(itemId === ITEM)
      },
    })

    await expect(detachBarcode(items, ITEM, '0012345678905')).resolves.toBeUndefined()
    await expect(
      detachBarcode(items, '11111111-1111-4111-8111-111111111111', '0012345678905'),
    ).rejects.toMatchObject({ code: ERROR.NOT_FOUND })
    expect(asked[0]).toEqual([ITEM, '0012345678905'])
  })
})
