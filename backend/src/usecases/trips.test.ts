import { describe, expect, it } from 'vitest'
import { DomainError, ERROR, actorSchema, itemSchema, placeSchema } from '@molvia/model'
import type { Actor, Expense, Item, Place, Trip } from '@molvia/model'
import type { ExpenseRepository } from '@/db/expenses-repository'
import type { ItemRepository } from '@/db/items-repository'
import type { PlaceRepository } from '@/db/places-repository'
import type { SearchPickRepository } from '@/db/search-picks-repository'
import type { TripRepository } from '@/db/trips-repository'
import type { Transact, TripRepositories } from '@/db/unit-of-work'
import { currentTrip } from './current-trip'
import { RECENT_PLACES, recentPlaces } from './recent-places'
import { startTrip } from './start-trip'
import { addExpense, finishTrip, removeExpense, updateExpense } from './trip-expenses'

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const TRIP = 'd2f1a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b'

const actor: Actor = actorSchema.parse({
  id: ACTOR,
  country: 'AM',
  city: 'Gyumri',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
  createdAt: new Date('2026-09-01T10:00:00.000Z'),
  updatedAt: new Date('2026-09-01T10:00:00.000Z'),
})

const place: Place = placeSchema.parse({
  id: 'b1e0f2a4-5c6d-4e8f-9a0b-1c2d3e4f5a6b',
  kind: 'store',
  name: 'Ереван Сити',
  country: 'AM',
  city: 'Gyumri',
  createdAt: new Date('2026-09-18T09:00:00.000Z'),
})

const milk: Item = itemSchema.parse({
  id: '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c',
  kind: 'product',
  name: 'Молоко «Ашхар»',
  searchKey: 'moloko ashhar',
  barcodes: [],
  note: null,
  defaultUnit: 'l',
  typicalQuantity: null,
  createdBy: ACTOR,
  createdAt: new Date('2026-09-18T10:00:00.000Z'),
})

const trip: Trip = {
  id: TRIP,
  actorId: ACTOR,
  placeId: place.id,
  currency: 'AMD',
  rate: null,
  startedAt: new Date('2026-09-19T10:00:00.000Z'),
  finishedAt: null,
}

const milkBought: Expense = {
  id: 'aa11bb22-cc33-4d44-8e55-ff6677889900',
  tripId: TRIP,
  itemId: milk.id,
  quantity: { milli: 1000n, unit: 'l' },
  amount: { minor: 57_000n, currency: 'AMD' },
  createdAt: new Date('2026-09-19T10:05:00.000Z'),
}

const unexpected = (name: string) => () => Promise.reject(new Error(`${name} was not expected`))

// Every method throws unless a test says otherwise: a use case that reached for anything beyond
// what it names would fail here rather than pass by accident.
function fakeRepositories(
  overrides: {
    trips?: Partial<TripRepository>
    expenses?: Partial<ExpenseRepository>
    places?: Partial<PlaceRepository>
    items?: Partial<ItemRepository>
    searchPicks?: Partial<SearchPickRepository>
  } = {},
): TripRepositories {
  return {
    trips: {
      start: unexpected('trips.start'),
      byId: unexpected('trips.byId'),
      latestUnfinishedFor: unexpected('trips.latestUnfinishedFor'),
      listFor: unexpected('trips.listFor'),
      finish: unexpected('trips.finish'),
      ...overrides.trips,
    },
    expenses: {
      add: unexpected('expenses.add'),
      forTrip: unexpected('expenses.forTrip'),
      update: unexpected('expenses.update'),
      remove: unexpected('expenses.remove'),
      unratedFor: unexpected('expenses.unratedFor'),
      cheapestFor: unexpected('expenses.cheapestFor'),
      ...overrides.expenses,
    },
    places: {
      ensure: unexpected('places.ensure'),
      byId: unexpected('places.byId'),
      byIds: unexpected('places.byIds'),
      recentFor: unexpected('places.recentFor'),
      ...overrides.places,
    },
    items: {
      create: unexpected('items.create'),
      byId: unexpected('items.byId'),
      byIds: unexpected('items.byIds'),
      createUnlessNamed: unexpected('items.createUnlessNamed'),
      search: unexpected('items.search'),
      ...overrides.items,
    },
    searchPicks: {
      remember: unexpected('searchPicks.remember'),
      ...overrides.searchPicks,
    },
  }
}

/** What a transaction is to a use case: the same repositories, run through once. */
function transactWith(repositories: TripRepositories): Transact {
  return (work) => work(repositories)
}

/** The reads every trip answer is built from. */
const viewReads = {
  places: { byId: () => Promise.resolve(place) },
  expenses: { forTrip: () => Promise.resolve([milkBought]) },
  items: { byIds: () => Promise.resolve([milk]) },
}

describe('startTrip', () => {
  it('names the place from the body, and the country, city and currency from the person', async () => {
    const ensured: unknown[] = []
    const started: unknown[] = []
    const repositories = fakeRepositories({
      ...viewReads,
      places: {
        ...viewReads.places,
        ensure: (input) => {
          ensured.push(input)
          return Promise.resolve(place)
        },
      },
      trips: {
        start: (...args) => {
          started.push(args)
          return Promise.resolve({ trip, created: true })
        },
      },
    })

    const { trip: view, created } = await startTrip(transactWith(repositories), actor, {
      id: TRIP,
      place: { kind: 'store', name: 'Ереван Сити' },
    })

    expect(ensured).toEqual([{ kind: 'store', name: 'Ереван Сити', country: 'AM', city: 'Gyumri' }])
    // The rate is null until MOL-39/40 give it a source.
    expect(started).toEqual([[ACTOR, { id: TRIP, placeId: place.id }, 'AMD', null]])
    expect(created).toBe(true)
    expect(view.place.name).toBe('Ереван Сити')
  })

  it('passes a repeat on as not created — the route answers 200', async () => {
    const repositories = fakeRepositories({
      ...viewReads,
      places: { ...viewReads.places, ensure: () => Promise.resolve(place) },
      trips: { start: () => Promise.resolve({ trip, created: false }) },
    })

    const { created } = await startTrip(transactWith(repositories), actor, {
      id: TRIP,
      place: { kind: 'store', name: 'Ереван Сити' },
    })
    expect(created).toBe(false)
  })

  it('lets TRIP_OPEN through untouched — the choice is the person’s', async () => {
    const repositories = fakeRepositories({
      places: { ensure: () => Promise.resolve(place) },
      trips: { start: () => Promise.reject(new DomainError(ERROR.TRIP_OPEN)) },
    })

    await expect(
      startTrip(transactWith(repositories), actor, {
        id: TRIP,
        place: { kind: 'store', name: 'Ереван Сити' },
      }),
    ).rejects.toThrow(ERROR.TRIP_OPEN)
  })

  it('runs inside one transaction', async () => {
    let transactions = 0
    const repositories = fakeRepositories({
      ...viewReads,
      places: { ...viewReads.places, ensure: () => Promise.resolve(place) },
      trips: { start: () => Promise.resolve({ trip, created: true }) },
    })
    const counting: Transact = (work) => {
      transactions += 1
      return work(repositories)
    }

    await startTrip(counting, actor, { id: TRIP, place: { kind: 'store', name: 'Ереван Сити' } })
    expect(transactions).toBe(1)
  })
})

describe('currentTrip', () => {
  it('«no trip» is null, not an error', async () => {
    const repositories = fakeRepositories({
      trips: { latestUnfinishedFor: () => Promise.resolve(null) },
    })
    expect(await currentTrip(repositories, ACTOR)).toBeNull()
  })

  it('answers the latest open trip whole, priced by the server', async () => {
    const repositories = fakeRepositories({
      ...viewReads,
      trips: { latestUnfinishedFor: () => Promise.resolve(trip) },
    })

    const view = await currentTrip(repositories, ACTOR)

    expect(view?.expenses.map((row) => row.item.name)).toEqual(['Молоко «Ашхар»'])
    expect(view?.expenses[0]?.unitPrice?.scaledMinor).toBe(57_000_000_000n)
    expect(view?.total).toEqual([{ minor: 57_000n, currency: 'AMD' }])
  })

  it('reads the items of a trip once, however many rows share one', async () => {
    const asked: string[][] = []
    const repositories = fakeRepositories({
      ...viewReads,
      trips: { latestUnfinishedFor: () => Promise.resolve(trip) },
      expenses: {
        forTrip: () =>
          Promise.resolve([
            milkBought,
            { ...milkBought, id: 'bb11bb22-cc33-4d44-8e55-ff6677889900' },
          ]),
      },
      items: {
        byIds: (ids) => {
          asked.push([...ids])
          return Promise.resolve([milk])
        },
      },
    })

    await currentTrip(repositories, ACTOR)
    expect(asked).toEqual([[milk.id]])
  })
})

describe('recentPlaces', () => {
  it('asks for the last few places of the owner', async () => {
    const calls: unknown[][] = []
    const places = fakeRepositories({
      places: {
        recentFor: (...args) => {
          calls.push(args)
          return Promise.resolve([place])
        },
      },
    }).places

    expect(await recentPlaces(places, ACTOR)).toEqual([place])
    expect(calls).toEqual([[ACTOR, RECENT_PLACES]])
  })
})

describe('addExpense', () => {
  const EXPENSE = 'cc11bb22-cc33-4d44-8e55-ff6677889900'

  function adding(created: boolean, picks: unknown[][]) {
    return fakeRepositories({
      ...viewReads,
      trips: { byId: () => Promise.resolve(trip) },
      expenses: {
        ...viewReads.expenses,
        add: () => Promise.resolve({ expense: milkBought, created }),
      },
      searchPicks: {
        remember: (...args) => {
          picks.push(args)
          return Promise.resolve()
        },
      },
    })
  }

  it('writes the purchase and remembers the query it was found by', async () => {
    const picks: unknown[][] = []
    const { created } = await addExpense(transactWith(adding(true, picks)), ACTOR, TRIP, {
      id: EXPENSE,
      itemId: milk.id,
      query: 'мол',
    })

    expect(created).toBe(true)
    expect(picks).toEqual([[ACTOR, 'мол', milk.id]])
  })

  it('must not fire: no query, no pick', async () => {
    const picks: unknown[][] = []
    await addExpense(transactWith(adding(true, picks)), ACTOR, TRIP, {
      id: EXPENSE,
      itemId: milk.id,
    })
    expect(picks).toEqual([])
  })

  it('must not fire: a repeat from the queue is one purchase and one pick', async () => {
    const picks: unknown[][] = []
    const { created } = await addExpense(transactWith(adding(false, picks)), ACTOR, TRIP, {
      id: EXPENSE,
      itemId: milk.id,
      query: 'мол',
    })

    expect(created).toBe(false)
    expect(picks).toEqual([])
  })

  it('hands the repository the trip from the path, never one from the body', async () => {
    const added: unknown[] = []
    const repositories = fakeRepositories({
      ...viewReads,
      trips: { byId: () => Promise.resolve(trip) },
      expenses: {
        ...viewReads.expenses,
        add: (_actorId, input) => {
          added.push(input)
          return Promise.resolve({ expense: milkBought, created: true })
        },
      },
    })

    await addExpense(transactWith(repositories), ACTOR, TRIP, {
      id: EXPENSE,
      itemId: milk.id,
      amount: { minor: 57_000n, currency: 'AMD' },
    })
    expect(added).toEqual([
      { id: EXPENSE, itemId: milk.id, amount: { minor: 57_000n, currency: 'AMD' }, tripId: TRIP },
    ])
  })

  it('a stranger’s trip and a missing one answer NOT_FOUND, and nothing is written', async () => {
    const repositories = fakeRepositories({ trips: { byId: () => Promise.resolve(null) } })

    await expect(
      addExpense(transactWith(repositories), ACTOR, TRIP, { id: EXPENSE, itemId: milk.id }),
    ).rejects.toThrow(ERROR.NOT_FOUND)
  })
})

describe('updateExpense and removeExpense', () => {
  const OTHER_TRIP_ROW = 'dd11bb22-cc33-4d44-8e55-ff6677889900'

  it('a row of the person’s other trip, named under this one, is NOT_FOUND and untouched', async () => {
    // `update` and `remove` are not in the fakes: reaching either would fail the test.
    const repositories = fakeRepositories({
      ...viewReads,
      trips: { byId: () => Promise.resolve(trip) },
    })

    await expect(
      updateExpense(transactWith(repositories), ACTOR, TRIP, OTHER_TRIP_ROW, {
        amount: { minor: 1n, currency: 'AMD' },
      }),
    ).rejects.toThrow(ERROR.NOT_FOUND)
    await expect(
      removeExpense(transactWith(repositories), ACTOR, TRIP, OTHER_TRIP_ROW),
    ).rejects.toThrow(ERROR.NOT_FOUND)
  })

  it('updates the row and answers the trip again, total and all', async () => {
    const patches: unknown[][] = []
    const repositories = fakeRepositories({
      ...viewReads,
      trips: { byId: () => Promise.resolve(trip) },
      expenses: {
        ...viewReads.expenses,
        update: (...args) => {
          patches.push(args)
          return Promise.resolve(milkBought)
        },
      },
    })

    const view = await updateExpense(transactWith(repositories), ACTOR, TRIP, milkBought.id, {
      amount: null,
    })

    expect(patches).toEqual([[milkBought.id, ACTOR, { amount: null }]])
    expect(view.id).toBe(TRIP)
  })

  it('removes the row and answers the trip again', async () => {
    const removed: unknown[][] = []
    const repositories = fakeRepositories({
      ...viewReads,
      trips: { byId: () => Promise.resolve(trip) },
      expenses: {
        ...viewReads.expenses,
        remove: (...args) => {
          removed.push(args)
          return Promise.resolve(true)
        },
      },
    })

    await removeExpense(transactWith(repositories), ACTOR, TRIP, milkBought.id)
    expect(removed).toEqual([[milkBought.id, ACTOR]])
  })
})

describe('finishTrip', () => {
  it('a stranger’s trip and a missing one answer NOT_FOUND', async () => {
    const { trips } = fakeRepositories({ trips: { finish: () => Promise.resolve(null) } })
    await expect(finishTrip(trips, ACTOR, TRIP)).rejects.toThrow(ERROR.NOT_FOUND)
  })

  it('finishing again is not an error', async () => {
    const finished = { ...trip, finishedAt: new Date('2026-09-19T11:00:00.000Z') }
    const { trips } = fakeRepositories({ trips: { finish: () => Promise.resolve(finished) } })
    await expect(finishTrip(trips, ACTOR, TRIP)).resolves.toBeUndefined()
  })
})
