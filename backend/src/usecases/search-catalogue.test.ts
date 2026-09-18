import { describe, expect, it } from 'vitest'
import { EVENT, itemSchema } from '@molvia/model'
import type { Item } from '@molvia/model'
import type { EventRepository, RecordedEvent } from '@/db/events-repository'
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
// beyond the search and the log would fail here rather than pass by accident.
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

function fakeEvents(overrides: Partial<EventRepository> = {}): EventRepository {
  return {
    record: () => Promise.reject(new Error('record was not expected')),
    recordOncePerDay: () => Promise.reject(new Error('recordOncePerDay was not expected')),
    weekFourReturn: () => Promise.reject(new Error('weekFourReturn was not expected')),
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
    const events = fakeEvents({ recordOncePerDay: () => Promise.resolve(true) })

    await searchCatalogue({ items, events }, ACTOR, '  Молоко ')

    // Untrimmed on purpose: the key is taken by the same function a name went through.
    expect(calls).toEqual([['  Молоко ', SEARCH_LIMIT, ACTOR]])
  })

  it('answers in the order the repository ranked, without reshuffling', async () => {
    const items = fakeItems({ search: () => Promise.resolve([first, second]) })
    const events = fakeEvents({ recordOncePerDay: () => Promise.resolve(false) })

    await expect(searchCatalogue({ items, events }, ACTOR, 'молоко')).resolves.toEqual([
      first,
      second,
    ])
  })

  it('records one catalogue view a day for the owner, on the product half', async () => {
    const recorded: RecordedEvent[] = []
    const items = fakeItems({ search: () => Promise.resolve([]) })
    const events = fakeEvents({
      recordOncePerDay: (event) => {
        recorded.push(event)
        return Promise.resolve(true)
      },
    })

    await searchCatalogue({ items, events }, ACTOR, 'молоко')

    expect(recorded).toEqual([
      { actorId: ACTOR, type: EVENT.CATALOGUE_VIEWED, payload: { subject: 'product' } },
    ])
  })

  it('must not record a visit when the search itself failed', async () => {
    const items = fakeItems({ search: () => Promise.reject(new Error('database down')) })
    // The default fake throws on recordOncePerDay — reaching it would change the error.
    await expect(searchCatalogue({ items, events: fakeEvents() }, ACTOR, 'молоко')).rejects.toThrow(
      'database down',
    )
  })

  it('does not swallow a failure to record: a lost row lowers the gate silently', async () => {
    const items = fakeItems({ search: () => Promise.resolve([first]) })
    const events = fakeEvents({ recordOncePerDay: () => Promise.reject(new Error('log down')) })

    await expect(searchCatalogue({ items, events }, ACTOR, 'молоко')).rejects.toThrow('log down')
  })
})
