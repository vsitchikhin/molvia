import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { DomainError } from '@molvia/model'
import type { Money, Quantity } from '@molvia/model'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace } from './fixtures'
import { createExpenseRepository } from '@/db/expenses-repository'
import { createPlaceRepository } from '@/db/places-repository'
import { createTripRepository } from '@/db/trips-repository'
import { createVerdictRepository } from '@/db/verdicts-repository'

/**
 * Данные принадлежат владельцу — правило, которого в базе нет вообще: у траты своего
 * `actor_id` нет специально, она принадлежит человеку через поход. Поэтому каждый метод
 * ставит владельца в условие запроса, и вся проверка этого — здесь.
 *
 * Чужое отвечает ровно тем же, чем несуществующее. Разница в ответах — это способ перебрать
 * чужие идентификаторы по одному.
 */
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

async function scene() {
  const owner = await insertActor(db)
  const stranger = await insertActor(db)
  const placeId = await insertPlace(db)
  const itemId = await insertItem(db)
  const trip = (await trips.start(owner, { id: randomUUID(), placeId }, 'AMD', null)).trip
  return { owner, stranger, placeId, itemId, trip }
}

describe('поход', () => {
  it('чужой не читается', async () => {
    const { trip, stranger } = await scene()
    expect(await trips.byId(trip.id, stranger)).toBeNull()
  })

  it('чужой не завершается', async () => {
    const { trip, stranger, owner } = await scene()

    expect(await trips.finish(trip.id, stranger, new Date())).toBeNull()
    expect((await trips.byId(trip.id, owner))?.finishedAt).toBeNull()
  })

  it('чужой не попадает ни в список, ни в незавершённый', async () => {
    const { stranger } = await scene()

    expect(await trips.listFor(stranger, 10)).toEqual([])
    expect(await trips.latestUnfinishedFor(stranger)).toBeNull()
  })
})

describe('трата', () => {
  it('в чужой поход не пишется и ничего после себя не оставляет', async () => {
    const { trip, itemId, stranger, owner } = await scene()

    await expect(
      expenses.add(stranger, { id: randomUUID(), tripId: trip.id, itemId, amount: price }),
    ).rejects.toThrow(DomainError)
    expect(await expenses.forTrip(trip.id, owner)).toEqual([])
  })

  it('чужая не видна, не правится и не удаляется', async () => {
    const { trip, itemId, owner, stranger } = await scene()
    const added = (
      await expenses.add(owner, {
        id: randomUUID(),
        tripId: trip.id,
        itemId,
        quantity: litre,
        amount: price,
      })
    ).expense

    expect(await expenses.forTrip(trip.id, stranger)).toEqual([])
    expect(await expenses.update(added.id, added.tripId, stranger, { amount: null })).toBeNull()
    expect(await expenses.remove(added.id, added.tripId, stranger)).toBe(false)

    const untouched = await expenses.forTrip(trip.id, owner)
    expect(untouched[0]?.amount).toEqual(price)
  })

  it('чужая не попадает ни в «не оценено», ни в цены', async () => {
    const { trip, itemId, owner, stranger } = await scene()
    await expenses.add(owner, {
      id: randomUUID(),
      tripId: trip.id,
      itemId,
      quantity: litre,
      amount: price,
    })

    expect(await expenses.unratedFor(stranger, 10)).toEqual([])
    expect(await expenses.cheapestFor(stranger, [itemId])).toEqual([])
  })
})

describe('вердикт', () => {
  it('чужой не читается и не попадает в список', async () => {
    const { itemId, owner, stranger } = await scene()
    await verdicts.put(owner, { itemId, score: 5 })

    expect(await verdicts.forItem(stranger, itemId, null)).toBeNull()
    expect(await verdicts.listFor(stranger, 10)).toEqual([])
  })

  it('оценка одного не переписывает оценку другого', async () => {
    const { itemId, owner, stranger } = await scene()

    const { verdict: mine } = await verdicts.put(owner, { itemId, score: 5 })
    const { verdict: theirs } = await verdicts.put(stranger, { itemId, score: 1 })

    expect(theirs.id).not.toBe(mine.id)
    expect((await verdicts.forItem(owner, itemId, null))?.score).toBe(5)
  })
})

describe('место — общее, а не чьё-то', () => {
  it('ensure возвращает одну карточку обоим', async () => {
    const first = await places.ensure({ kind: 'store', name: 'SAS', country: 'AM', city: 'Гюмри' })
    const second = await places.ensure({ kind: 'store', name: 'sas', country: 'AM', city: 'Гюмри' })

    expect(second.id).toBe(first.id)
  })

  it('но недавние места у каждого свои', async () => {
    const { owner, stranger } = await scene()

    expect(await places.recentFor(owner, 10)).toHaveLength(1)
    expect(await places.recentFor(stranger, 10)).toEqual([])
  })
})
