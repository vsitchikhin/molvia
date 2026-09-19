import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { DomainError, ERROR } from '@molvia/model'
import type { Money, Quantity } from '@molvia/model'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace } from './fixtures'
import { createActorRepository } from '@/db/actors-repository'
import { createExpenseRepository } from '@/db/expenses-repository'
import { createItemRepository } from '@/db/items-repository'
import { createPlaceRepository } from '@/db/places-repository'
import { createTripRepository } from '@/db/trips-repository'
import { createVerdictRepository } from '@/db/verdicts-repository'

/**
 * Что нашёл адверсариальный проход по PR #12 и чем это закрыто. Каждый раздел — дефект,
 * который был жив на `c942962`.
 */
const { db, close } = connectDrizzle()
const actors = createActorRepository(db)
const catalogue = createItemRepository(db)
const places = createPlaceRepository(db)
const trips = createTripRepository(db)
const expenses = createExpenseRepository(db)
const verdicts = createVerdictRepository(db)

const litre: Quantity = { milli: 900n, unit: 'l' }
const price: Money = { minor: 57_000n, currency: 'AMD' }
const settings = {
  country: 'AM' as const,
  city: 'Гюмри',
  spendCurrency: 'AMD' as const,
  incomeCurrency: 'RUB' as const,
}

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await close()
})

describe('порядок внутри одной транзакции', () => {
  it('траты одной транзакции читаются в порядке внесения, а не случайных UUID', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    const trip = await trips.start(actorId, { placeId }, 'AMD', null)

    // `Conn` заведён ровно ради этого: MOL-21 пишет поход и первую трату вместе. Под `now()`
    // все строки такой транзакции получали одну метку, и порядок решал randomUUID().
    const entered = await db.transaction(async (tx) => {
      const inTx = createExpenseRepository(tx)
      const ids: string[] = []
      for (let index = 0; index < 10; index += 1) {
        const added = await inTx.add(actorId, { tripId: trip.id, itemId, amount: price })
        ids.push(added.id)
      }
      return ids
    })

    expect((await expenses.forTrip(trip.id, actorId)).map((row) => row.id)).toEqual(entered)
  })

  it('из двух походов одной транзакции текущим становится начатый последним', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)

    const second = await db.transaction(async (tx) => {
      const inTx = createTripRepository(tx)
      await inTx.start(actorId, { placeId }, 'AMD', null)
      return inTx.start(actorId, { placeId }, 'AMD', null)
    })

    expect((await trips.latestUnfinishedFor(actorId))?.id).toBe(second.id)
  })

  it('оценки одной транзакции читаются новейшими сверху', async () => {
    const actorId = await insertActor(db)
    const itemIds: string[] = []
    for (let index = 0; index < 5; index += 1) {
      itemIds.push(await insertItem(db, { name: `Товар ${String(index)}` }))
    }

    const entered = await db.transaction(async (tx) => {
      const inTx = createVerdictRepository(tx)
      const ids: string[] = []
      for (const itemId of itemIds)
        ids.push((await inTx.put(actorId, { itemId, score: 4 })).verdict.id)
      return ids
    })

    expect((await verdicts.listFor(actorId, 10)).map((row) => row.id)).toEqual(
      [...entered].reverse(),
    )
  })
})

describe('предел выборки', () => {
  it('отрицательный не отменяет предел, а означает «ничего»', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    for (let index = 0; index < 3; index += 1) {
      await trips.start(actorId, { placeId }, 'AMD', null)
    }

    // drizzle на отрицательном пределе не печатал клаузу вовсе — то есть возвращал всё.
    expect(await trips.listFor(actorId, -1)).toEqual([])
    expect(await verdicts.listFor(actorId, -1)).toEqual([])
    expect(await expenses.unratedFor(actorId, -1)).toEqual([])
    expect(await places.recentFor(actorId, -1)).toEqual([])
  })

  it('дробный округляется вниз, а не роняет запрос', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    for (let index = 0; index < 5; index += 1) {
      await trips.start(actorId, { placeId }, 'AMD', null)
    }

    expect(await trips.listFor(actorId, 2.5)).toHaveLength(2)
  })

  it('у cheapestFor предел есть и соблюдается', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    for (let index = 0; index < 4; index += 1) {
      const placeId = await insertPlace(db, { name: `Лавка ${String(index)}` })
      const trip = await trips.start(actorId, { placeId }, 'AMD', null)
      await expenses.add(actorId, { tripId: trip.id, itemId, quantity: litre, amount: price })
    }

    expect(await expenses.cheapestFor(actorId, [itemId], 2)).toHaveLength(2)
    expect(await expenses.cheapestFor(actorId, [itemId])).toHaveLength(4)
  })
})

describe('негодный идентификатор', () => {
  it('на чтении отвечает «ничего», а не пятисоткой', async () => {
    const actorId = await insertActor(db)

    expect(await actors.byId('не-uuid')).toBeNull()
    expect(await catalogue.byId('не-uuid')).toBeNull()
    expect(await places.byId('не-uuid')).toBeNull()
    expect(await trips.byId('не-uuid', actorId)).toBeNull()
    expect(await verdicts.forItem(actorId, 'не-uuid', null)).toBeNull()
    expect(await catalogue.byIds(['не-uuid'])).toEqual([])
    expect(await places.byIds(['не-uuid'])).toEqual([])
    expect(await expenses.forTrip('не-uuid', actorId)).toEqual([])
    expect(await expenses.cheapestFor(actorId, ['не-uuid'])).toEqual([])
  })

  it('на правке и удалении — тем же, чем чужое', async () => {
    const actorId = await insertActor(db)

    expect(await expenses.update('не-uuid', actorId, { amount: null })).toBeNull()
    expect(await expenses.remove('не-uuid', actorId)).toBe(false)
    expect(await trips.finish('не-uuid', actorId, new Date())).toBeNull()
    expect(await actors.update('не-uuid', { city: 'Ереван' })).toBeNull()
  })
})

describe('вердикт хранит отзыв', () => {
  it('смена балла не стирает написанный текст', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)

    await verdicts.put(actorId, { itemId, score: 5, review: 'отличное, брать всегда' })
    const { verdict: second } = await verdicts.put(actorId, { itemId, score: 4 })

    expect(second.score).toBe(4)
    expect(second.review).toBe('отличное, брать всегда')
    expect((await verdicts.forItem(actorId, itemId, null))?.review).toBe('отличное, брать всегда')
  })

  it('новый отзыв заменяет прежний', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)

    await verdicts.put(actorId, { itemId, score: 5, review: 'первое впечатление' })
    const { verdict: second } = await verdicts.put(actorId, {
      itemId,
      score: 5,
      review: 'передумал',
    })

    expect(second.review).toBe('передумал')
  })
})

describe('уникальность чужой строки — это конфликт, а не поломка', () => {
  it('штрихкод, занятый другой позицией, отвечает доменной ошибкой', async () => {
    const scanned = '4820000000017'
    await catalogue.create(
      { kind: 'product', name: 'Молоко «Ашхар»', barcodes: [scanned], defaultUnit: 'l' },
      null,
    )

    const second = catalogue.create(
      { kind: 'product', name: 'Кефир «Ашхар»', barcodes: [scanned], defaultUnit: 'l' },
      null,
    )
    await expect(second).rejects.toThrow(DomainError)
    await expect(second).rejects.toMatchObject({ code: ERROR.CONFLICT })
  })

  it('повторный первый визит владельца — тоже конфликт, а не пятисотка', async () => {
    const id = randomUUID()
    await actors.create(id, settings)

    const again = actors.create(id, settings)
    await expect(again).rejects.toThrow(DomainError)
    await expect(again).rejects.toMatchObject({ code: ERROR.CONFLICT })
  })
})

describe('пустой патч называет себя', () => {
  it('у траты и у владельца — именованный отказ, а не «No values to set»', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    const trip = await trips.start(actorId, { placeId }, 'AMD', null)
    const added = await expenses.add(actorId, { tripId: trip.id, itemId, amount: price })

    await expect(expenses.update(added.id, actorId, {})).rejects.toThrow(/patch with no fields/)
    await expect(actors.update(actorId, {})).rejects.toThrow(/patch with no fields/)
  })
})
