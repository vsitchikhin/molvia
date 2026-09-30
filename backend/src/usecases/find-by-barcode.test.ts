import { describe, expect, it } from 'vitest'
import { itemSchema } from '@molvia/model'
import type { ItemRepository } from '@/db/items-repository'
import { findByBarcode } from './find-by-barcode'

const cheese = itemSchema.parse({
  id: '1c7a3d5f-9e2b-4a4c-8d8f-6b3e2f1a4c5d',
  kind: 'product',
  name: 'Сыр чечил',
  searchKey: 'sir chechil',
  barcodes: ['00408295'],
  note: null,
  defaultUnit: 'kg',
  typicalQuantity: null,
  createdBy: null,
  createdAt: new Date('2026-09-29T10:00:00.000Z'),
})

// Every method throws unless a test says otherwise: a lookup that reached for the search — and
// with it the memory of picks — would fail here rather than pass by accident.
function fakeItems(byBarcode: ItemRepository['byBarcode']): ItemRepository {
  return {
    create: () => Promise.reject(new Error('create was not expected')),
    byId: () => Promise.reject(new Error('byId was not expected')),
    byIds: () => Promise.reject(new Error('byIds was not expected')),
    createUnlessNamed: () => Promise.reject(new Error('createUnlessNamed was not expected')),
    search: () => Promise.reject(new Error('search was not expected')),
    byBarcode,
    attachBarcode: () => Promise.reject(new Error('attachBarcode was not expected')),
    detachBarcode: () => Promise.reject(new Error('detachBarcode was not expected')),
  }
}

describe('findByBarcode', () => {
  it('asks for the code as read first, then its twin', async () => {
    const asked: (readonly string[])[] = []
    const items = fakeItems((codes) => {
      asked.push(codes)
      return Promise.resolve(cheese)
    })

    // Typed from the shop's label it is thirteen digits; the scan stored eight (MOL-98 Р-11).
    expect(await findByBarcode(items, '0004082000095')).toBe(cheese)
    expect(asked).toEqual([['0004082000095', '00408295']])
  })

  it('asks for a code with one form alone', async () => {
    const asked: (readonly string[])[] = []
    const items = fakeItems((codes) => {
      asked.push(codes)
      return Promise.resolve(null)
    })

    expect(await findByBarcode(items, '4850000000007')).toBeNull()
    expect(asked).toEqual([['4850000000007']])
  })

  it('must not ask the database about a code of no barcode shape', async () => {
    const items = fakeItems(() => Promise.reject(new Error('byBarcode was not expected')))

    for (const code of ['', '1234567', '485000000000x', '048500000000071']) {
      expect(await findByBarcode(items, code), code).toBeNull()
    }
  })
})
