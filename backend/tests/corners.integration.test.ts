import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { DomainError, tripTotal } from '@molvia/model'
import type { Money, Quantity } from '@molvia/model'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace } from './fixtures'
import { items } from '@/db/schema'
import { createExpenseRepository } from '@/db/expenses-repository'
import { createItemRepository } from '@/db/items-repository'
import { createTripRepository } from '@/db/trips-repository'

const { db, close } = connectDrizzle()
const catalogue = createItemRepository(db)
const trips = createTripRepository(db)
const expenses = createExpenseRepository(db)

const litre: Quantity = { milli: 900n, unit: 'l' }
const drams: Money = { minor: 57_000n, currency: 'AMD' }

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await close()
})

describe('вторая цена за ту же пару', () => {
  it('это второе наблюдение, а не дубль', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    const trip = (await trips.start(actorId, { id: randomUUID(), placeId }, 'AMD', null)).trip

    await expenses.add(actorId, {
      id: randomUUID(),
      tripId: trip.id,
      itemId,
      quantity: litre,
      amount: drams,
    })
    await expenses.add(actorId, {
      id: randomUUID(),
      tripId: trip.id,
      itemId,
      quantity: litre,
      amount: { minor: 61_000n, currency: 'AMD' },
    })

    expect(await expenses.forTrip(trip.id, actorId)).toHaveLength(2)
    expect((await expenses.cheapestFor(actorId, [itemId]))[0]?.observations).toBe(2)
  })
})

describe('третья валюта внутри похода', () => {
  it('пишется как есть, и сумма похода честно распадается надвое', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    const trip = (await trips.start(actorId, { id: randomUUID(), placeId }, 'AMD', null)).trip

    await expenses.add(actorId, { id: randomUUID(), tripId: trip.id, itemId, amount: drams })
    await expenses.add(actorId, {
      id: randomUUID(),
      tripId: trip.id,
      itemId,
      amount: { minor: 50_000n, currency: 'RUB' },
    })

    // Цена решения «один снимок курса на поход»: вторую сумму пересчитать нечем, и
    // tripTotal не делает вид, что это одно число.
    const totals = tripTotal(await expenses.forTrip(trip.id, actorId))
    expect(totals).toEqual([
      { minor: 57_000n, currency: 'AMD' },
      { minor: 50_000n, currency: 'RUB' },
    ])
  })
})

describe('позиция со штрихкодами', () => {
  it('пишется транзакцией: сбой на штрихкоде не оставляет позицию без них', async () => {
    const taken = '4820000000017'
    const first = await catalogue.create(
      { kind: 'product', name: 'Молоко', barcodes: [taken], defaultUnit: 'l' },
      null,
    )

    // Штрихкод — первичный ключ: он принадлежит одной позиции. Вторая попытка обязана
    // откатить и саму позицию, иначе в справочнике останется товар, который не отсканировать.
    await expect(
      catalogue.create(
        { kind: 'product', name: 'Кефир', barcodes: [taken], defaultUnit: 'l' },
        null,
      ),
    ).rejects.toThrow()

    const all = await catalogue.byIds([first.id])
    expect(all).toHaveLength(1)
    expect(await db.select().from(items)).toHaveLength(1)
  })
})

describe('ссылка в никуда', () => {
  it('поход в несуществующем месте — NOT_FOUND, а не пятисотка', async () => {
    const actorId = await insertActor(db)

    await expect(
      trips.start(actorId, { id: randomUUID(), placeId: randomUUID() }, 'AMD', null),
    ).rejects.toThrow(DomainError)
  })

  it('трата в несуществующий поход — то же самое', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)

    await expect(
      expenses.add(actorId, { id: randomUUID(), tripId: randomUUID(), itemId }),
    ).rejects.toThrow(DomainError)
  })
})

describe('разбор на чтении', () => {
  it('строка, записанная мимо домена, роняет чтение, а не уезжает на экран', async () => {
    const itemId = await insertItem(db)

    // Управляющий символ в имени: база его не запрещает — видимость текста держит домен, —
    // а `visibleLine` на чтении откажет. Это и есть цена решения Р-3, и она осознанная:
    // ошибка с логом лучше мусора в выдаче.
    await db.update(items).set({ name: 'Молоко\u0007' }).where(eq(items.id, itemId))

    await expect(catalogue.byId(itemId)).rejects.toThrow()
  })
})
