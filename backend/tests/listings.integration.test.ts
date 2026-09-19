import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { unitPrice } from '@molvia/model'
import type { Money, Quantity } from '@molvia/model'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, insertTrip } from './fixtures'
import { createExpenseRepository } from '@/db/expenses-repository'
import { createPlaceRepository } from '@/db/places-repository'
import { createTripRepository } from '@/db/trips-repository'
import { createVerdictRepository } from '@/db/verdicts-repository'

const { db, close } = connectDrizzle()
const places = createPlaceRepository(db)
const trips = createTripRepository(db)
const expenses = createExpenseRepository(db)
const verdicts = createVerdictRepository(db)

const litre: Quantity = { milli: 900n, unit: 'l' }
const price: Money = { minor: 57_000n, currency: 'AMD' }

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await close()
})

describe('пустые выборки', () => {
  it('отдают пустой список, а не null и не исключение', async () => {
    const actorId = await insertActor(db)

    expect(await trips.listFor(actorId, 10)).toEqual([])
    expect(await trips.latestUnfinishedFor(actorId)).toBeNull()
    expect(await expenses.unratedFor(actorId, 10)).toEqual([])
    expect(await expenses.cheapestFor(actorId, [])).toEqual([])
    expect(await verdicts.listFor(actorId, 10)).toEqual([])
    expect(await places.recentFor(actorId, 10)).toEqual([])
  })
})

describe('порядок и предел', () => {
  it('незавершённым считается самый свежий, а завершённые не в счёт', async () => {
    // Два открытых похода сразу `start` не допускает (MOL-21), но строки, записанные мимо него,
    // — фикстура, восстановление — могут их держать, и текущим тогда должен быть новый.
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)

    const older = await insertTrip(db, {
      actorId,
      placeId,
      startedAt: new Date('2026-09-10T10:00:00Z'),
    })
    const newer = await insertTrip(db, {
      actorId,
      placeId,
      startedAt: new Date('2026-09-10T18:00:00Z'),
    })
    expect((await trips.latestUnfinishedFor(actorId))?.id).toBe(newer)

    // Без момента: этому тесту важен факт завершения, а не его время.
    await trips.finish(newer, actorId)
    expect((await trips.latestUnfinishedFor(actorId))?.id).toBe(older)

    await trips.finish(older, actorId)
    expect(await trips.latestUnfinishedFor(actorId)).toBeNull()
  })

  it('предел соблюдается на нуле, единице и за границей набора', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    for (let index = 0; index < 3; index += 1) {
      // Открытым поход бывает один (MOL-21), поэтому каждый завершается сразу.
      const { trip } = await trips.start(actorId, { id: randomUUID(), placeId }, 'AMD', null)
      await trips.finish(trip.id, actorId)
    }

    expect(await trips.listFor(actorId, 0)).toHaveLength(0)
    expect(await trips.listFor(actorId, 1)).toHaveLength(1)
    expect(await trips.listFor(actorId, 3)).toHaveLength(3)
    expect(await trips.listFor(actorId, 4)).toHaveLength(3)
  })

  it('походы с одинаковым временем старта не меняются местами между загрузками', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const startedAt = new Date('2026-09-10T10:00:00Z')
    await insertTrip(db, { actorId, placeId, startedAt })
    await insertTrip(db, { actorId, placeId, startedAt })
    await insertTrip(db, { actorId, placeId, startedAt })

    const once = await trips.listFor(actorId, 10)
    const twice = await trips.listFor(actorId, 10)
    expect(once.map((trip) => trip.id)).toEqual(twice.map((trip) => trip.id))
  })

  it('недавние места — по времени последнего похода, без повторов', async () => {
    const actorId = await insertActor(db)
    const market = await places.ensure({
      kind: 'store',
      name: 'Рынок',
      country: 'AM',
      city: 'Гюмри',
    })
    const sas = await places.ensure({ kind: 'store', name: 'SAS', country: 'AM', city: 'Гюмри' })

    await insertTrip(db, {
      actorId,
      placeId: market.id,
      startedAt: new Date('2026-09-01T10:00:00Z'),
    })
    await insertTrip(db, { actorId, placeId: sas.id, startedAt: new Date('2026-09-02T10:00:00Z') })
    await insertTrip(db, {
      actorId,
      placeId: market.id,
      startedAt: new Date('2026-09-03T10:00:00Z'),
    })

    expect((await places.recentFor(actorId, 10)).map((place) => place.name)).toEqual([
      'Рынок',
      'SAS',
    ])
  })
})

describe('куплено, но не оценено', () => {
  it('своя оценка закрывает покупку, чужая — нет', async () => {
    const actorId = await insertActor(db)
    const stranger = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    const trip = (await trips.start(actorId, { id: randomUUID(), placeId }, 'AMD', null)).trip
    await expenses.add(actorId, { id: randomUUID(), tripId: trip.id, itemId })

    await verdicts.put(stranger, { itemId, score: 5 })
    expect(await expenses.unratedFor(actorId, 10)).toHaveLength(1)

    await verdicts.put(actorId, { itemId, score: 4 })
    expect(await expenses.unratedFor(actorId, 10)).toHaveLength(0)
  })

  it('у блюда покупку закрывает оценка того же места, а не любого', async () => {
    const actorId = await insertActor(db)
    const cafe = await insertPlace(db, { kind: 'venue', name: 'Кафе один' })
    const other = await insertPlace(db, { kind: 'venue', name: 'Кафе два' })
    const itemId = await insertItem(db, { kind: 'dish', name: 'Карбонара', searchKey: 'karbonara' })
    const trip = (await trips.start(actorId, { id: randomUUID(), placeId: cafe }, 'AMD', null)).trip
    await expenses.add(actorId, { id: randomUUID(), tripId: trip.id, itemId })

    await verdicts.put(actorId, { itemId, placeId: other, score: 5 })
    expect(await expenses.unratedFor(actorId, 10)).toHaveLength(1)

    await verdicts.put(actorId, { itemId, placeId: cafe, score: 5 })
    expect(await expenses.unratedFor(actorId, 10)).toHaveLength(0)
  })
})

describe('где дешевле', () => {
  it('цена за единицу из SQL совпадает с unitPrice домена до цифры', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    const trip = (await trips.start(actorId, { id: randomUUID(), placeId }, 'AMD', null)).trip
    await expenses.add(actorId, {
      id: randomUUID(),
      tripId: trip.id,
      itemId,
      quantity: litre,
      amount: price,
    })

    const [row] = await expenses.cheapestFor(actorId, [itemId])
    expect(row?.scaledMinor).toBe(unitPrice(price, litre).scaledMinor)
  })

  it('берёт минимум по месту и не смешивает валюты', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    const trip = (await trips.start(actorId, { id: randomUUID(), placeId }, 'AMD', null)).trip

    const cheaper: Money = { minor: 49_000n, currency: 'AMD' }
    await expenses.add(actorId, {
      id: randomUUID(),
      tripId: trip.id,
      itemId,
      quantity: litre,
      amount: price,
    })
    await expenses.add(actorId, {
      id: randomUUID(),
      tripId: trip.id,
      itemId,
      quantity: litre,
      amount: cheaper,
    })
    await expenses.add(actorId, {
      id: randomUUID(),
      tripId: trip.id,
      itemId,
      quantity: litre,
      amount: { minor: 50_000n, currency: 'RUB' },
    })

    const rows = await expenses.cheapestFor(actorId, [itemId])
    const drams = rows.find((row) => row.currency === 'AMD')

    expect(rows).toHaveLength(2)
    expect(drams?.scaledMinor).toBe(unitPrice(cheaper, litre).scaledMinor)
    expect(drams?.observations).toBe(2)
  })

  it('порядок задан полным ключом: валюты одного места не меняются местами', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    const trip = (await trips.start(actorId, { id: randomUUID(), placeId }, 'AMD', null)).trip

    for (const currency of ['USD', 'AMD', 'EUR', 'RUB'] as const) {
      await expenses.add(actorId, {
        id: randomUUID(),
        tripId: trip.id,
        itemId,
        quantity: litre,
        amount: { minor: 57_000n, currency },
      })
    }

    // Сортировки по позиции и месту мало: строки одного места остаются связанными, а
    // связанные строки планировщик вправе отдать в любом порядке.
    for (let load = 0; load < 4; load += 1) {
      const rows = await expenses.cheapestFor(actorId, [itemId])
      expect(rows.map((row) => row.currency)).toEqual(['AMD', 'EUR', 'RUB', 'USD'])
    }
  })

  it('наблюдение без цены или без количества в расчёт не идёт', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    const trip = (await trips.start(actorId, { id: randomUUID(), placeId }, 'AMD', null)).trip

    await expenses.add(actorId, { id: randomUUID(), tripId: trip.id, itemId })
    await expenses.add(actorId, { id: randomUUID(), tripId: trip.id, itemId, amount: price })
    await expenses.add(actorId, { id: randomUUID(), tripId: trip.id, itemId, quantity: litre })

    expect(await expenses.cheapestFor(actorId, [itemId])).toEqual([])
  })
})

describe('оценки', () => {
  it('список свой, с пределом', async () => {
    const actorId = await insertActor(db)
    const milk = await insertItem(db, { name: 'Молоко', searchKey: 'moloko' })
    const cheese = await insertItem(db, { name: 'Сыр', searchKey: 'syr' })

    await verdicts.put(actorId, { itemId: milk, score: 5 })
    await verdicts.put(actorId, { itemId: cheese, score: 2 })

    expect(await verdicts.listFor(actorId, 10)).toHaveLength(2)
    expect(await verdicts.listFor(actorId, 1)).toHaveLength(1)
  })
})
