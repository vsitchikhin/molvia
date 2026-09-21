import { describe, expect, it } from 'vitest'
import { itemSchema } from '@molvia/model'
import type { Item } from '@molvia/model'
import type { ItemRepository } from '@/db/items-repository'
import { SEARCH_LIMIT, searchCatalogue } from './search-catalogue'

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

function item(id: string, name: string): Item {
  return itemSchema.parse({
    id,
    kind: 'product',
    name,
    searchKey: name.toLowerCase(),
    barcodes: [],
    note: null,
    defaultUnit: 'l',
    typicalQuantity: null,
    createdBy: null,
    createdAt: new Date('2026-09-18T10:00:00.000Z'),
  })
}

const second = item('0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c', 'Молоко Марианна')
const first = item('1c7a3d5f-9e2b-4a4c-8d8f-6b3e2f1a4c5d', 'Молоко Ашхар')

// Every method throws unless a test says otherwise: a use case that reached for anything
// beyond the search would fail here rather than pass by accident.
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

describe('searchCatalogue', () => {
  it('asks the repository with the query as typed, the limit and the owner', async () => {
    const calls: unknown[][] = []
    const items = fakeItems({
      search: (...args) => {
        calls.push(args)
        return Promise.resolve([])
      },
    })
    await searchCatalogue({ items }, ACTOR, '  Молоко ')

    // Untrimmed on purpose: the key is taken by the same function a name went through.
    expect(calls).toEqual([['  Молоко ', SEARCH_LIMIT, ACTOR]])
  })

  it('answers in the order the repository ranked, without reshuffling', async () => {
    const items = fakeItems({ search: () => Promise.resolve([first, second]) })

    await expect(searchCatalogue({ items }, ACTOR, 'молоко')).resolves.toEqual([first, second])
  })

  it('writes nothing to the log: the visit that answers the gate is «Что брать» now', async () => {
    // The search used to record `catalogue_viewed` here (MOL-12). It stopped with MOL-31
    // (Р-18): `advice_viewed` answers the 0.3 gate, and an event nothing reads must not be
    // written into an append-only log.
    const items = fakeItems({ search: () => Promise.resolve([first]) })

    await expect(searchCatalogue({ items }, ACTOR, 'молоко')).resolves.toEqual([first])
  })
})
