import { describe, expect, it } from 'vitest'
import {
  DomainError,
  ERROR,
  actorSchema,
  settingsOf,
  itemSchema,
  parseRate,
  placeSchema,
  yerevanMidnight,
} from '@molvia/model'
import type {
  Actor,
  CachedRate,
  Exchange,
  Expense,
  Item,
  Place,
  RatePreference,
  RateProvider,
  Trip,
} from '@molvia/model'
import type { ExpenseRepository } from '@/db/expenses-repository'
import type { ItemRepository } from '@/db/items-repository'
import type { PlaceRepository } from '@/db/places-repository'
import type { RateRepository } from '@/db/rates-repository'
import type { ExchangeRepository } from '@/db/exchanges-repository'
import type { SearchPickRepository } from '@/db/search-picks-repository'
import type { TripRepository, TripSnapshot } from '@/db/trips-repository'
import type { Transact, TripRepositories } from '@/db/unit-of-work'
import { currentTrip } from './current-trip'
import { RECENT_PLACES, recentPlaces } from './recent-places'
import { startTrip } from './start-trip'
import { addExpense, finishTrip, removeExpense, updateExpense } from './trip-expenses'

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const TRIP = 'd2f1a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b'

const actor: Actor = actorSchema.parse({
  id: ACTOR,
  telegramUserId: 777_000_123,
  country: 'AM',
  city: 'Gyumri',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
  sharedUntil: null,
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

/** What a trip holds of the snapshot it was started with — as the repository writes it. */
function held(snapshot: TripSnapshot | null): Pick<Trip, 'rate' | 'rateProvider'> {
  return { rate: snapshot?.rate ?? null, rateProvider: snapshot?.provider ?? null }
}

const trip: Trip = {
  id: TRIP,
  actorId: ACTOR,
  placeId: place.id,
  currency: 'AMD',
  rate: null,
  rateProvider: null,
  rateJumped: false,
  previousRate: null,
  manualRate: null,
  rateChoice: null,
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
    rates?: Partial<RateRepository>
    exchanges?: Partial<ExchangeRepository>
  } = {},
): TripRepositories {
  return {
    trips: {
      start: unexpected('trips.start'),
      byId: unexpected('trips.byId'),
      lock: unexpected('trips.lock'),
      latestUnfinishedFor: unexpected('trips.latestUnfinishedFor'),
      listFor: unexpected('trips.listFor'),
      history: unexpected('trips.history'),
      finish: unexpected('trips.finish'),
      chooseRate: unexpected('trips.chooseRate'),
      ...overrides.trips,
    },
    expenses: {
      add: unexpected('expenses.add'),
      forTrip: unexpected('expenses.forTrip'),
      update: unexpected('expenses.update'),
      remove: unexpected('expenses.remove'),
      unratedFor: unexpected('expenses.unratedFor'),
      pendingVerdictsFor: unexpected('expenses.pendingVerdictsFor'),
      cheapestFor: unexpected('expenses.cheapestFor'),
      medianPriceFor: unexpected('expenses.medianPriceFor'),
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
      learn: unexpected('searchPicks.learn'),
      ...overrides.searchPicks,
    },
    rates: {
      upsert: unexpected('rates.upsert'),
      latestOnOrBefore: unexpected('rates.latestOnOrBefore'),
      history: unexpected('rates.history'),
      lastFetchedAt: unexpected('rates.lastFetchedAt'),
      ...overrides.rates,
    },
    exchanges: {
      add: unexpected('exchanges.add'),
      amend: unexpected('exchanges.amend'),
      history: unexpected('exchanges.history'),
      remove: unexpected('exchanges.remove'),
      restore: unexpected('exchanges.restore'),
      purgeRemoved: unexpected('exchanges.purgeRemoved'),
      purgeStale: unexpected('exchanges.purgeStale'),
      list: () => Promise.resolve([]),
      spentSince: unexpected('exchanges.spentSince'),
      // No exchanges is where every person starts, and every trip test before MOL-40 is there.
      rateSettings: () => Promise.resolve({ preference: 'personal', since: null }),
      setPreference: unexpected('exchanges.setPreference'),
      ...overrides.exchanges,
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

/** No rate has ever been fetched: the trip starts without one (MOL-39, В-2). */
const emptyCache = { rates: { latestOnOrBefore: () => Promise.resolve([]) } }

describe('startTrip', () => {
  it('names the place from the body, and the country, city and currency from the person', async () => {
    const ensured: unknown[] = []
    const started: unknown[] = []
    const repositories = fakeRepositories({
      ...emptyCache,
      ...viewReads,
      places: {
        ...viewReads.places,
        ensure: (input) => {
          ensured.push(input)
          return Promise.resolve(place)
        },
      },
      trips: {
        byId: () => Promise.resolve(null),
        start: (...args) => {
          started.push(args)
          return Promise.resolve({ trip, created: true })
        },
      },
    })

    const { trip: view, created } = await startTrip(transactWith(repositories), actor, {
      id: TRIP,
      context: settingsOf(actor),
      place: { kind: 'store', name: 'Ереван Сити' },
    })

    expect(ensured).toEqual([{ kind: 'store', name: 'Ереван Сити', country: 'AM', city: 'Gyumri' }])
    // An empty cache: nothing to snapshot.
    expect(started).toEqual([[ACTOR, { id: TRIP, placeId: place.id }, 'AMD', null]])
    expect(created).toBe(true)
    expect(view.place.name).toBe('Ереван Сити')
  })

  it('passes a repeat on as not created — the route answers 200', async () => {
    const repositories = fakeRepositories({
      ...emptyCache,
      ...viewReads,
      places: { ...viewReads.places, ensure: () => Promise.resolve(place) },
      trips: {
        byId: () => Promise.resolve(null),
        start: () => Promise.resolve({ trip, created: false }),
      },
    })

    const { created } = await startTrip(transactWith(repositories), actor, {
      id: TRIP,
      context: settingsOf(actor),
      place: { kind: 'store', name: 'Ереван Сити' },
    })
    expect(created).toBe(false)
  })

  it('lets TRIP_OPEN through untouched — the choice is the person’s', async () => {
    const repositories = fakeRepositories({
      ...emptyCache,
      places: { ensure: () => Promise.resolve(place) },
      trips: {
        byId: () => Promise.resolve(null),
        start: () => Promise.reject(new DomainError(ERROR.TRIP_OPEN)),
      },
    })

    await expect(
      startTrip(transactWith(repositories), actor, {
        id: TRIP,
        context: settingsOf(actor),
        place: { kind: 'store', name: 'Ереван Сити' },
      }),
    ).rejects.toThrow(ERROR.TRIP_OPEN)
  })

  it('runs inside one transaction', async () => {
    let transactions = 0
    const repositories = fakeRepositories({
      ...emptyCache,
      ...viewReads,
      places: { ...viewReads.places, ensure: () => Promise.resolve(place) },
      trips: {
        byId: () => Promise.resolve(null),
        start: () => Promise.resolve({ trip, created: true }),
      },
    })
    const counting: Transact = (work) => {
      transactions += 1
      return work(repositories)
    }

    await startTrip(counting, actor, {
      id: TRIP,
      context: settingsOf(actor),
      place: { kind: 'store', name: 'Ереван Сити' },
    })
    expect(transactions).toBe(1)
  })
})

describe('startTrip: the official rate (MOL-39)', () => {
  const friday = '2026-09-18'
  // Sunday 20.09 at noon in Yerevan.
  const sunday = new Date('2026-09-20T08:00:00.000Z')

  function startedWith(
    cache: readonly CachedRate[],
    person: Actor = actor,
    now: Date = sunday,
  ): Promise<{ rate: unknown; asked: unknown[] }> {
    const asked: unknown[] = []
    let rate: unknown = 'not started'
    const repositories = fakeRepositories({
      ...viewReads,
      places: { ...viewReads.places, ensure: () => Promise.resolve(place) },
      trips: {
        byId: () => Promise.resolve(null),
        // As the repository does: the trip carries the person's currency beside the rate.
        start: (_actorId, _input, currency, snapshot) => {
          rate = snapshot
          return Promise.resolve({ trip: { ...trip, currency, ...held(snapshot) }, created: true })
        },
      },
      rates: {
        latestOnOrBefore: (currencies, date) => {
          asked.push([currencies, date])
          return Promise.resolve(cache.filter((row) => currencies.includes(row.currency)))
        },
      },
    })
    return startTrip(
      transactWith(repositories),
      person,
      { id: TRIP, context: settingsOf(person), place: { kind: 'store', name: 'Ереван Сити' } },
      now,
    ).then(() => ({ rate, asked }))
  }

  const rub = (value: string, date = friday, provider: RateProvider = 'cba'): CachedRate => ({
    provider,
    currency: 'RUB',
    date,
    scaled: parseRate(value),
    jump: false,
  })

  it('snapshots the central bank rate of Friday on a Sunday, with its date', async () => {
    const { rate, asked } = await startedWith([rub('4.3123')])

    expect(asked).toEqual([[['RUB'], '2026-09-20']])
    expect(rate).toEqual({
      rate: {
        base: 'RUB',
        quote: 'AMD',
        scaled: 4_312_300n,
        source: 'official',
        asOf: yerevanMidnight(friday),
      },
      provider: 'cba',
      jumped: false,
      previous: null,
    })
  })

  it('answers the trip converted by the rate it snapshotted', async () => {
    const repositories = fakeRepositories({
      ...viewReads,
      places: { ...viewReads.places, ensure: () => Promise.resolve(place) },
      trips: {
        byId: () => Promise.resolve(null),
        start: (_actorId, _input, _currency, snapshot) =>
          Promise.resolve({ trip: { ...trip, ...held(snapshot) }, created: true }),
      },
      rates: { latestOnOrBefore: () => Promise.resolve([rub('4.3123')]) },
    })

    const { trip: view } = await startTrip(
      transactWith(repositories),
      actor,
      { id: TRIP, context: settingsOf(actor), place: { kind: 'store', name: 'Ереван Сити' } },
      sunday,
    )

    // 570 ֏ / 4.3123 = 132.18 ₽
    expect(view.converted).toEqual({ minor: 13_218n, currency: 'RUB' })
  })

  it('asks the cache for the day in Yerevan, which turns at 20:00 UTC', async () => {
    const { asked } = await startedWith([], actor, new Date('2026-09-19T20:30:00.000Z'))
    expect(asked).toEqual([[['RUB'], '2026-09-20']])
  })

  it('marks an open source taken after a week of the central bank’s silence', async () => {
    const { rate } = await startedWith([
      rub('4.3123', '2026-09-11'),
      rub('4.3165', '2026-09-19', 'cbr'),
    ])
    expect(rate).toMatchObject({
      rate: { scaled: 4_316_500n, source: 'fallback' },
      provider: 'cbr',
    })
  })

  it('starts without a rate on an empty cache', async () => {
    expect((await startedWith([])).rate).toBeNull()
  })

  it('does not read the cache at all when a person spends what they earn', async () => {
    const { rate, asked } = await startedWith([rub('4.3123')], { ...actor, incomeCurrency: 'AMD' })
    expect(rate).toBeNull()
    expect(asked).toEqual([])
  })

  it('asks for both currencies of a cross, and snapshots it', async () => {
    const usd: CachedRate = {
      provider: 'cba',
      currency: 'USD',
      date: friday,
      scaled: 363_440_000n,
      jump: false,
    }
    const { rate, asked } = await startedWith([rub('4.3123'), usd], {
      ...actor,
      spendCurrency: 'USD',
    })
    expect(asked).toEqual([[['RUB', 'USD'], '2026-09-20']])
    expect(rate).toMatchObject({ rate: { base: 'RUB', quote: 'USD', scaled: 11_865n } })
  })
})

describe('startTrip: the person’s own rate (MOL-40)', () => {
  // Sunday 20.09 at noon in Yerevan.
  const sunday = new Date('2026-09-20T08:00:00.000Z')
  const exchange = (
    exchangedOn: string,
    given: bigint,
    received: bigint,
    held: bigint | null = null,
    currencies: [Exchange['given']['currency'], Exchange['received']['currency']] = ['RUB', 'AMD'],
  ): Exchange => ({
    id: `00000000-0000-4000-8000-${exchangedOn.replaceAll('-', '').padStart(12, '0')}`,
    actorId: ACTOR,
    given: { minor: given, currency: currencies[0] },
    received: { minor: received, currency: currencies[1] },
    exchangedOn,
    heldBefore: held === null ? null : { minor: held, currency: currencies[1] },
    note: null,
    revision: 1,
    createdAt: new Date(`${exchangedOn}T09:00:00.000Z`),
    amendedAt: null,
  })
  const owners = [
    exchange('2026-09-01', 2_000_000n, 10_000_000n),
    exchange('2026-09-15', 2_000_000n, 9_500_000n, 2_000_000n),
  ]

  async function startedWith(
    exchanges: readonly Exchange[],
    preference: RatePreference = 'personal',
    person: Actor = actor,
    now: Date = sunday,
    since: Date | null = null,
    context = settingsOf(person),
  ): Promise<{ snapshot: TripSnapshot | null; askedOfficial: boolean }> {
    let snapshot: TripSnapshot | null = null
    let askedOfficial = false
    const repositories = fakeRepositories({
      ...viewReads,
      places: { ...viewReads.places, ensure: () => Promise.resolve(place) },
      trips: {
        byId: () => Promise.resolve(null),
        start: (_actorId, _input, currency, taken) => {
          snapshot = taken
          return Promise.resolve({ trip: { ...trip, currency, ...held(taken) }, created: true })
        },
      },
      rates: {
        latestOnOrBefore: () => {
          askedOfficial = true
          return Promise.resolve([
            {
              provider: 'cba',
              currency: 'RUB',
              date: '2026-09-18',
              scaled: parseRate('4.3123'),
              jump: false,
            },
          ])
        },
      },
      exchanges: {
        rateSettings: () => Promise.resolve({ preference, since }),
        list: () => Promise.resolve(exchanges),
      },
    })
    await startTrip(
      transactWith(repositories),
      person,
      { id: TRIP, context, place: { kind: 'store', name: 'Ереван Сити' } },
      now,
    )
    return { snapshot, askedOfficial }
  }

  it('snapshots the wallet of the pair, dated by its last exchange, and never asks the bank', async () => {
    const { snapshot, askedOfficial } = await startedWith(owners)

    expect(snapshot).toEqual({
      rate: {
        base: 'RUB',
        quote: 'AMD',
        scaled: 4_791_667n,
        source: 'personal',
        asOf: yerevanMidnight('2026-09-15'),
      },
      provider: null,
      jumped: false,
      previous: null,
    })
    expect(askedOfficial).toBe(false)
  })

  it('takes the official rate when the person asked for it, exchanges or not', async () => {
    const { snapshot } = await startedWith(owners, 'official')
    expect(snapshot?.rate.source).toBe('official')
    expect(snapshot?.provider).toBe('cba')
  })

  it('takes the official rate without an exchange of this pair', async () => {
    const dollars = [exchange('2026-09-10', 10_000n, 3_800_000n, null, ['USD', 'AMD'])]
    expect((await startedWith([])).snapshot?.rate.source).toBe('official')
    expect((await startedWith(dollars)).snapshot?.rate.source).toBe('official')
  })

  it('counts an exchange of today in Yerevan and not one dated tomorrow', async () => {
    const today = [exchange('2026-09-20', 2_000_000n, 9_000_000n)]
    const tomorrow = [exchange('2026-09-21', 2_000_000n, 9_000_000n)]
    expect((await startedWith(today)).snapshot?.rate.scaled).toBe(parseRate('4.5'))
    expect((await startedWith(tomorrow)).snapshot?.rate.source).toBe('official')
  })

  it('after a change of the currency of conversion, counts exchanges paid in it from before (MOL-42, Л1)', async () => {
    // Roubles were chosen on the 10th; the rouble exchange of the 1st needs no re-counting in them.
    const since = new Date('2026-09-10T06:00:00.000Z')
    const { snapshot } = await startedWith(owners, 'personal', actor, sunday, since)
    expect(snapshot?.rate.scaled).toBe(4_791_667n)
  })

  it('does not cut a trip started with the currency of conversion before the change (Р-8)', async () => {
    const dollars = [exchange('2026-09-05', 10_000n, 3_800_000n, null, ['USD', 'AMD'])]
    const since = new Date('2026-09-18T06:00:00.000Z')
    const old = { ...settingsOf(actor), incomeCurrency: 'USD' as const }
    const { snapshot } = await startedWith(dollars, 'personal', actor, sunday, since, old)
    expect(snapshot?.rate).toMatchObject({ base: 'USD', scaled: parseRate('380') })
  })

  it('asks nothing of the wallet when the two currencies are one', async () => {
    const local = actorSchema.parse({ ...actor, incomeCurrency: 'AMD' })
    const { snapshot, askedOfficial } = await startedWith(owners, 'personal', local)
    expect(snapshot).toBeNull()
    expect(askedOfficial).toBe(false)
  })
})

describe('startTrip: a repeat', () => {
  it('С-4: the same identifier again is answered before any place is named', async () => {
    // `ensure` and `start` are not in the fakes: reaching either would fail the test.
    const repositories = fakeRepositories({
      ...viewReads,
      trips: { byId: () => Promise.resolve(trip) },
    })

    const { trip: view, created } = await startTrip(transactWith(repositories), actor, {
      id: TRIP,
      context: settingsOf(actor),
      place: { kind: 'store', name: 'Другое имя' },
    })

    expect(created).toBe(false)
    expect(view.place.name).toBe('Ереван Сити')
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
    expect(calls).toEqual([[ACTOR, RECENT_PLACES, undefined]])
  })
})

describe('addExpense', () => {
  const EXPENSE = 'cc11bb22-cc33-4d44-8e55-ff6677889900'

  function adding(created: boolean, picks: unknown[][], learnt: unknown[][] = []) {
    return fakeRepositories({
      ...viewReads,
      trips: { lock: () => Promise.resolve(trip) },
      expenses: {
        ...viewReads.expenses,
        add: () => Promise.resolve({ expense: milkBought, created }),
      },
      searchPicks: {
        remember: (...args) => {
          picks.push(args)
          return Promise.resolve()
        },
        learn: (...args) => {
          learnt.push(args)
          return Promise.resolve()
        },
      },
    })
  }

  it('learns the query that found nothing before, beside the one that found the item', async () => {
    const picks: unknown[][] = []
    const learnt: unknown[][] = []
    await addExpense(transactWith(adding(true, picks, learnt)), ACTOR, TRIP, {
      id: EXPENSE,
      itemId: milk.id,
      query: 'мол',
      missedQuery: 'молочка',
    })

    expect(picks).toEqual([[ACTOR, 'мол', milk.id]])
    expect(learnt).toEqual([[ACTOR, 'молочка', milk.id]])
  })

  it('must not fire: a repeat from the queue learns nothing a second time', async () => {
    const learnt: unknown[][] = []
    await addExpense(transactWith(adding(false, [], learnt)), ACTOR, TRIP, {
      id: EXPENSE,
      itemId: milk.id,
      query: 'мол',
      missedQuery: 'молочка',
    })
    expect(learnt).toEqual([])
  })

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
      trips: { lock: () => Promise.resolve(trip) },
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
    const repositories = fakeRepositories({ trips: { lock: () => Promise.resolve(null) } })

    await expect(
      addExpense(transactWith(repositories), ACTOR, TRIP, { id: EXPENSE, itemId: milk.id }),
    ).rejects.toThrow(ERROR.NOT_FOUND)
  })
})

describe('updateExpense and removeExpense', () => {
  const ELSEWHERE = 'dd11bb22-cc33-4d44-8e55-ff6677889900'

  it('locks the trip before touching its rows, and names the row with its trip', async () => {
    const order: string[] = []
    const repositories = fakeRepositories({
      ...viewReads,
      trips: {
        lock: () => {
          order.push('lock')
          return Promise.resolve(trip)
        },
      },
      expenses: {
        ...viewReads.expenses,
        update: (...args) => {
          order.push(`update ${JSON.stringify(args.slice(0, 3))}`)
          return Promise.resolve(milkBought)
        },
      },
    })

    await updateExpense(transactWith(repositories), ACTOR, TRIP, milkBought.id, { amount: null })
    expect(order).toEqual(['lock', `update ${JSON.stringify([milkBought.id, TRIP, ACTOR])}`])
  })

  it('a price saved into a row that is not there is NOT_FOUND, not «saved»', async () => {
    const repositories = fakeRepositories({
      ...viewReads,
      trips: { lock: () => Promise.resolve(trip) },
      expenses: { ...viewReads.expenses, update: () => Promise.resolve(null) },
    })

    await expect(
      updateExpense(transactWith(repositories), ACTOR, TRIP, ELSEWHERE, {
        amount: { minor: 1n, currency: 'AMD' },
      }),
    ).rejects.toThrow(ERROR.NOT_FOUND)
  })

  it('С-8: removing a row already gone answers the trip as it is — safe to repeat', async () => {
    const repositories = fakeRepositories({
      ...viewReads,
      trips: { lock: () => Promise.resolve(trip) },
      expenses: { ...viewReads.expenses, remove: () => Promise.resolve(false) },
    })

    const view = await removeExpense(transactWith(repositories), ACTOR, TRIP, ELSEWHERE)
    expect(view.id).toBe(TRIP)
  })

  it('a stranger’s or a missing trip is NOT_FOUND, for the change and the delete alike', async () => {
    // `update` and `remove` are not in the fakes: reaching either would fail the test.
    const repositories = fakeRepositories({ trips: { lock: () => Promise.resolve(null) } })

    await expect(
      updateExpense(transactWith(repositories), ACTOR, TRIP, milkBought.id, { amount: null }),
    ).rejects.toThrow(ERROR.NOT_FOUND)
    await expect(
      removeExpense(transactWith(repositories), ACTOR, TRIP, milkBought.id),
    ).rejects.toThrow(ERROR.NOT_FOUND)
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
