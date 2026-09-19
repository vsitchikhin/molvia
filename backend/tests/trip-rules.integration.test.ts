import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ERROR } from '@molvia/model'
import type { Money } from '@molvia/model'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, insertTrip } from './fixtures'
import { createExpenseRepository } from '@/db/expenses-repository'
import { createTripRepository } from '@/db/trips-repository'
import { transactOn } from '@/db/unit-of-work'

const { db, close } = connectDrizzle()
// A second connection, for the races: one connection runs its statements one after another,
// and two requests at once is exactly what it cannot show.
const other = connectDrizzle()

const trips = createTripRepository(db)
const expenses = createExpenseRepository(db)
const price: Money = { minor: 57_000n, currency: 'AMD' }

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await other.close()
  await close()
})

describe('trips.start: один открытый поход (MOL-21, В-4)', () => {
  it('новый поход записывается с идентификатором устройства', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const id = randomUUID()

    const { trip, created } = await trips.start(actorId, { id, placeId }, 'AMD', null)

    expect(created).toBe(true)
    expect(trip.id).toBe(id)
  })

  it('другой путь записи: повтор того же id — тот же поход, не второй', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const id = randomUUID()

    const first = await trips.start(actorId, { id, placeId }, 'AMD', null)
    const again = await trips.start(actorId, { id, placeId }, 'AMD', null)

    expect(again).toEqual({ trip: first.trip, created: false })
    expect(await trips.listFor(actorId, 10)).toHaveLength(1)
  })

  it('повтор после завершения возвращает завершённый поход, а не открывает новый', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const id = randomUUID()
    await trips.start(actorId, { id, placeId }, 'AMD', null)
    const finished = await trips.finish(id, actorId)

    const again = await trips.start(actorId, { id, placeId }, 'AMD', null)

    expect(again).toEqual({ trip: finished, created: false })
  })

  it('при другом открытом походе — TRIP_OPEN, и ни строки', async () => {
    const actorId = await insertActor(db)
    const market = await insertPlace(db, { name: 'Рынок' })
    const city = await insertPlace(db, { name: 'Ереван Сити' })
    await trips.start(actorId, { id: randomUUID(), placeId: market }, 'AMD', null)

    await expect(
      trips.start(actorId, { id: randomUUID(), placeId: city }, 'AMD', null),
    ).rejects.toThrow(ERROR.TRIP_OPEN)
    expect(await trips.listFor(actorId, 10)).toHaveLength(1)
  })

  it('В-7: тот же магазин не исключение — вчерашний открытый поход тоже спрашивает', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    await insertTrip(db, { actorId, placeId, startedAt: new Date('2026-09-18T10:00:00Z') })

    await expect(trips.start(actorId, { id: randomUUID(), placeId }, 'AMD', null)).rejects.toThrow(
      ERROR.TRIP_OPEN,
    )
  })

  it('после завершения открытого новый начинается', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const { trip } = await trips.start(actorId, { id: randomUUID(), placeId }, 'AMD', null)
    await trips.finish(trip.id, actorId)

    const next = await trips.start(actorId, { id: randomUUID(), placeId }, 'AMD', null)

    expect(next.created).toBe(true)
    expect((await trips.latestUnfinishedFor(actorId))?.id).toBe(next.trip.id)
  })

  it('чужой открытый поход не мешает', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const placeId = await insertPlace(db)
    await trips.start(stranger, { id: randomUUID(), placeId }, 'AMD', null)

    const mine = await trips.start(owner, { id: randomUUID(), placeId }, 'AMD', null)
    expect(mine.created).toBe(true)
  })

  it('id, уже занятый чужим походом, — CONFLICT, а не чужой поход в ответ', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const placeId = await insertPlace(db)
    const id = randomUUID()
    await trips.start(stranger, { id, placeId }, 'AMD', null)

    await expect(trips.start(owner, { id, placeId }, 'AMD', null)).rejects.toThrow(ERROR.CONFLICT)
  })

  it('гонка: два «Начать поход» с разными id одновременно — один поход', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const second = createTripRepository(other.db)

    const outcomes = await Promise.allSettled([
      trips.start(actorId, { id: randomUUID(), placeId }, 'AMD', null),
      second.start(actorId, { id: randomUUID(), placeId }, 'AMD', null),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    const refused = outcomes.find((outcome) => outcome.status === 'rejected')
    expect(refused?.status === 'rejected' && String(refused.reason)).toContain(ERROR.TRIP_OPEN)
    expect(await trips.listFor(actorId, 10)).toHaveLength(1)
  })

  it('гонка: двойной тап одним id — один поход, оба ответа о нём', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const id = randomUUID()

    const both = await Promise.all([
      trips.start(actorId, { id, placeId }, 'AMD', null),
      createTripRepository(other.db).start(actorId, { id, placeId }, 'AMD', null),
    ])

    expect(both.map((answer) => answer.created).sort()).toEqual([false, true])
    expect(both[0].trip.id).toBe(both[1].trip.id)
  })
})

describe('trips.finish', () => {
  it('повтор не сдвигает момент завершения', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const { trip } = await trips.start(actorId, { id: randomUUID(), placeId }, 'AMD', null)

    const first = await trips.finish(trip.id, actorId)
    const again = await trips.finish(trip.id, actorId)

    expect(first?.finishedAt).toBeInstanceOf(Date)
    expect(again?.finishedAt).toEqual(first?.finishedAt)
  })

  it('чужой и несуществующий поход — одинаковый null', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const placeId = await insertPlace(db)
    const { trip } = await trips.start(owner, { id: randomUUID(), placeId }, 'AMD', null)

    expect(await trips.finish(trip.id, stranger)).toBeNull()
    expect(await trips.finish(randomUUID(), owner)).toBeNull()
    expect((await trips.byId(trip.id, owner))?.finishedAt).toBeNull()
  })
})

describe('expenses.add: id от устройства (MOL-21, В-2)', () => {
  async function openTrip() {
    const actorId = await insertActor(db)
    // A name of its own: two calls in one test would otherwise meet the place's identity.
    const placeId = await insertPlace(db, { name: `Лавка ${randomUUID()}` })
    const itemId = await insertItem(db)
    const { trip } = await trips.start(actorId, { id: randomUUID(), placeId }, 'AMD', null)
    return { actorId, itemId, tripId: trip.id }
  }

  it('другой путь записи: повтор очереди — одна покупка, первая запись выигрывает', async () => {
    const { actorId, itemId, tripId } = await openTrip()
    const id = randomUUID()

    const first = await expenses.add(actorId, { id, tripId, itemId, amount: price })
    const again = await expenses.add(actorId, {
      id,
      tripId,
      itemId,
      amount: { minor: 1n, currency: 'AMD' },
    })

    expect(first.created).toBe(true)
    expect(again).toEqual({ expense: first.expense, created: false })
    expect(await expenses.forTrip(tripId, actorId)).toHaveLength(1)
  })

  it('гонка: повтор одновременно с первой отправкой — одна покупка', async () => {
    const { actorId, itemId, tripId } = await openTrip()
    const id = randomUUID()

    const both = await Promise.all([
      expenses.add(actorId, { id, tripId, itemId }),
      createExpenseRepository(other.db).add(actorId, { id, tripId, itemId }),
    ])

    expect(both.map((answer) => answer.created).sort()).toEqual([false, true])
    expect(await expenses.forTrip(tripId, actorId)).toHaveLength(1)
  })

  it('тот же id с другой позицией — CONFLICT, не подмена', async () => {
    const { actorId, itemId, tripId } = await openTrip()
    const otherItem = await insertItem(db, { name: 'Сыр' })
    const id = randomUUID()
    await expenses.add(actorId, { id, tripId, itemId })

    await expect(expenses.add(actorId, { id, tripId, itemId: otherItem })).rejects.toThrow(
      ERROR.CONFLICT,
    )
  })

  it('id чужой траты — CONFLICT, и чужая покупка не приходит в ответ', async () => {
    const mine = await openTrip()
    const theirs = await openTrip()
    const id = randomUUID()
    await expenses.add(theirs.actorId, {
      id,
      tripId: theirs.tripId,
      itemId: theirs.itemId,
      amount: price,
    })

    await expect(
      expenses.add(mine.actorId, { id, tripId: mine.tripId, itemId: theirs.itemId }),
    ).rejects.toThrow(ERROR.CONFLICT)
  })

  it('В-8: в завершённый поход трата добавляется — забытое дописывают дома', async () => {
    const { actorId, itemId, tripId } = await openTrip()
    await trips.finish(tripId, actorId)

    const { created } = await expenses.add(actorId, { id: randomUUID(), tripId, itemId })

    expect(created).toBe(true)
    expect(await expenses.forTrip(tripId, actorId)).toHaveLength(1)
  })
})

describe('transactOn', () => {
  it('всё или ничего: сбой после записи траты откатывает и её', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    const { trip } = await trips.start(actorId, { id: randomUUID(), placeId }, 'AMD', null)

    await expect(
      transactOn(db)(async (repositories) => {
        await repositories.expenses.add(actorId, { id: randomUUID(), tripId: trip.id, itemId })
        throw new Error('after the write')
      }),
    ).rejects.toThrow('after the write')

    expect(await expenses.forTrip(trip.id, actorId)).toEqual([])
  })
})
