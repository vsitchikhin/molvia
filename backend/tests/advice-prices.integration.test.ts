import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { AGGREGATE_MIN_CONTRIBUTIONS, unitPrice } from '@molvia/model'
import type { Money, Quantity } from '@molvia/model'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, insertTrip, ownPrices } from './fixtures'
import { createExpenseRepository } from '@/db/expenses-repository'
import type { PriceQuery } from '@/db/expenses-repository'
import { expenses as expensesTable } from '@/db/schema'

const { db, close } = connectDrizzle()
const expenses = createExpenseRepository(db)

const kilo: Quantity = { milli: 1000n, unit: 'kg' }
const amd = (minor: number): Money => ({ minor: BigInt(minor), currency: 'AMD' })

/** The same query the screen makes for someone who may see other people's prices. */
function sharedPrices(actorId: string, itemIds: readonly string[]): PriceQuery {
  return { ...ownPrices(actorId, itemIds), scope: 'shared' }
}

/**
 * A purchase written straight into the table: these tests are about the aggregates, and
 * `add` would drag a whole trip's ownership rules into every fixture.
 */
async function bought(
  actorId: string,
  itemId: string,
  placeId: string,
  amount: Money,
  quantity: Quantity = kilo,
  /** The record's day as its phone named it, and the moment it began (MOL-121). */
  record: { readonly on?: string | null; readonly at?: Date; readonly tripId?: string } = {},
): Promise<void> {
  const tripId =
    record.tripId ??
    (await insertTrip(db, {
      actorId,
      placeId,
      ...(record.on === undefined ? {} : { startedOn: record.on }),
      ...(record.at ? { startedAt: record.at } : {}),
    }))
  await db.insert(expensesTable).values({
    id: randomUUID(),
    tripId,
    itemId,
    qtyMilli: quantity.milli,
    qtyUnit: quantity.unit,
    amountMinor: amount.minor,
    amountCurrency: amount.currency,
  })
}

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await close()
})

describe('медиана цены за единицу', () => {
  it('на нечётном числе покупок — середина', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    for (const minor of [290_000, 300_000, 340_000]) {
      await bought(actorId, itemId, placeId, amd(minor))
    }

    const [row] = await expenses.medianPriceFor(ownPrices(actorId, [itemId]))
    expect(row?.scaledMinor).toBe(unitPrice(amd(300_000), kilo).scaledMinor)
    expect(row?.observations).toBe(3)
  })

  it('на чётном — нижняя из двух средних, а не половина между ними', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    for (const minor of [290_000, 300_000, 320_000, 340_000]) {
      await bought(actorId, itemId, placeId, amd(minor))
    }

    // 300 000 и 320 000 — две середины; берём нижнюю, как isRateJump.
    const [row] = await expenses.medianPriceFor(ownPrices(actorId, [itemId]))
    expect(row?.scaledMinor).toBe(unitPrice(amd(300_000), kilo).scaledMinor)
  })

  it('не смешивает валюты и единицы: у каждой пары своя середина', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    await bought(actorId, itemId, placeId, amd(300_000))
    await bought(actorId, itemId, placeId, { minor: 50_000n, currency: 'RUB' })
    await bought(actorId, itemId, placeId, amd(300_000), { milli: 1000n, unit: 'piece' })

    expect(await expenses.medianPriceFor(ownPrices(actorId, [itemId]))).toHaveLength(3)
  })

  it('не считает покупку без цены или без количества', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    const tripId = await insertTrip(db, { actorId, placeId })
    await bought(actorId, itemId, placeId, amd(300_000))
    await db.insert(expensesTable).values({ id: randomUUID(), tripId, itemId })
    await db.insert(expensesTable).values({
      id: randomUUID(),
      tripId,
      itemId,
      amountMinor: 400_000n,
      amountCurrency: 'AMD',
    })

    const [row] = await expenses.medianPriceFor(ownPrices(actorId, [itemId]))
    expect(row?.observations).toBe(1)
  })
})

describe('последняя покупка', () => {
  it('приходит с каждой строкой — по ней решается ничья между валютами', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    await bought(actorId, itemId, placeId, amd(300_000))

    const [row] = await expenses.placePricesFor(ownPrices(actorId, [itemId]))
    expect(row?.latestVisitAt).toBeInstanceOf(Date)
    expect(Date.now() - (row?.latestVisitAt.getTime() ?? 0)).toBeLessThan(60_000)
  })
})

describe('общий режим', () => {
  it('в открытом месте, где я покупал, — моя цена, как на листе, а не чужая (MOL-166, В-1)', async () => {
    const me = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    await bought(me, itemId, placeId, amd(500_000))
    await bought(await insertActor(db), itemId, placeId, amd(300_000))
    await bought(await insertActor(db), itemId, placeId, amd(400_000))

    const [row] = await expenses.placePricesFor(sharedPrices(me, [itemId]))
    expect(row?.scaledMinor).toBe(unitPrice(amd(500_000), kilo).scaledMinor)
    expect(row?.observations).toBe(3)
  })

  it('на двух покупателях отдаёт только мою цену: чужая покупка — чужая корзина', async () => {
    const me = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    await bought(me, itemId, placeId, amd(500_000))
    await bought(await insertActor(db), itemId, placeId, amd(300_000))

    const [row] = await expenses.placePricesFor(sharedPrices(me, [itemId]))
    expect(row?.scaledMinor).toBe(unitPrice(amd(500_000), kilo).scaledMinor)
    expect(row?.observations).toBe(1)
  })

  it('не показывает место, где я не покупал, пока покупателей меньше трёх', async () => {
    const me = await insertActor(db)
    const itemId = await insertItem(db)
    const theirs = await insertPlace(db, { name: 'Carrefour' })
    await bought(await insertActor(db), itemId, theirs, amd(300_000))
    await bought(await insertActor(db), itemId, theirs, amd(310_000))

    expect(await expenses.placePricesFor(sharedPrices(me, [itemId]))).toEqual([])
  })

  it('считает покупателей, а не покупки: три раза одним человеком — один вклад', async () => {
    const me = await insertActor(db)
    const itemId = await insertItem(db)
    const theirs = await insertPlace(db, { name: 'Carrefour' })
    const one = await insertActor(db)
    for (const minor of [300_000, 310_000, 320_000]) {
      await bought(one, itemId, theirs, amd(minor))
    }

    expect(await expenses.placePricesFor(sharedPrices(me, [itemId]))).toEqual([])
  })

  it('порог — ровно три: третий покупатель открывает место', async () => {
    const me = await insertActor(db)
    const itemId = await insertItem(db)
    const theirs = await insertPlace(db, { name: 'Carrefour' })
    for (let n = 0; n < AGGREGATE_MIN_CONTRIBUTIONS; n += 1) {
      await bought(await insertActor(db), itemId, theirs, amd(300_000 + n))
    }

    expect(await expenses.placePricesFor(sharedPrices(me, [itemId]))).toHaveLength(1)
  })

  it('не приносит цену из другого города', async () => {
    const me = await insertActor(db)
    const itemId = await insertItem(db)
    const erevan = await insertPlace(db, { name: 'SAS', city: 'Ереван' })
    for (let n = 0; n < 4; n += 1) {
      await bought(await insertActor(db), itemId, erevan, amd(200_000))
    }

    expect(await expenses.placePricesFor(sharedPrices(me, [itemId]))).toEqual([])
  })

  it('ставит свой город впереди: «дешевле» через город значит «в другом городе»', async () => {
    // Свой чек из Еревана дешевле гюмрийского места и без этого правила встаёт первым — то
    // есть ровно под словом «Дешевле всего» (адверсариальный раунд 2, G4).
    const me = await insertActor(db)
    const itemId = await insertItem(db)
    const erevan = await insertPlace(db, { name: 'SAS Ереван', city: 'Ереван' })
    const gyumri = await insertPlace(db, { name: 'Carrefour Гюмри', city: 'Гюмри' })
    await bought(me, itemId, erevan, amd(200_000))
    for (const minor of [300_000, 310_000, 320_000]) {
      await bought(await insertActor(db), itemId, gyumri, amd(minor))
    }

    const rows = await expenses.placePricesFor(sharedPrices(me, [itemId]))
    expect(rows.map((row) => row.placeName)).toEqual(['Carrefour Гюмри', 'SAS Ереван'])
  })

  it('внутри своего города порядок по-прежнему по цене', async () => {
    const me = await insertActor(db)
    const itemId = await insertItem(db)
    const dear = await insertPlace(db, { name: 'Дорогое', city: 'Гюмри' })
    const cheap = await insertPlace(db, { name: 'Дешёвое', city: 'Гюмри' })
    await bought(me, itemId, dear, amd(400_000))
    await bought(me, itemId, cheap, amd(300_000))

    const rows = await expenses.placePricesFor(sharedPrices(me, [itemId]))
    expect(rows.map((row) => row.placeName)).toEqual(['Дешёвое', 'Дорогое'])
  })

  it('в своём режиме мои покупки видны из любого города', async () => {
    const me = await insertActor(db)
    const itemId = await insertItem(db)
    const erevan = await insertPlace(db, { name: 'SAS', city: 'Ереван' })
    await bought(me, itemId, erevan, amd(200_000))

    expect(await expenses.placePricesFor(ownPrices(me, [itemId]))).toHaveLength(1)
  })

  it('усредняет медиану по троим и отступает к своей на двоих', async () => {
    const me = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    await bought(me, itemId, placeId, amd(500_000))
    await bought(await insertActor(db), itemId, placeId, amd(300_000))

    const [two] = await expenses.medianPriceFor(sharedPrices(me, [itemId]))
    expect(two?.scaledMinor).toBe(unitPrice(amd(500_000), kilo).scaledMinor)

    await bought(await insertActor(db), itemId, placeId, amd(400_000))
    const [three] = await expenses.medianPriceFor(sharedPrices(me, [itemId]))
    expect(three?.scaledMinor).toBe(unitPrice(amd(400_000), kilo).scaledMinor)
    expect(three?.observations).toBe(3)
  })
})

describe('название места', () => {
  it('приходит со строкой, чтобы экран не ходил за ним вторым запросом', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db, { name: 'Рынок в Гюмри' })
    const itemId = await insertItem(db)
    await bought(actorId, itemId, placeId, amd(479_000))

    const [row] = await expenses.placePricesFor(ownPrices(actorId, [itemId]))
    expect(row?.placeName).toBe('Рынок в Гюмри')
    expect(row?.placeId).toBe(placeId)
  })
})

describe('цена места — последняя, а не минимум (MOL-166)', () => {
  const price = (minor: number) => unitPrice(amd(minor), kilo).scaledMinor

  it('своё место: последняя покупка, а не самая дешёвая — «цены поднимаются, а спускаются редко»', async () => {
    const me = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    await bought(me, itemId, placeId, amd(500_000), kilo, { on: '2026-06-12' })
    await bought(me, itemId, placeId, amd(600_000), kilo, { on: '2026-09-20' })
    await bought(me, itemId, placeId, amd(540_000), kilo, { on: '2026-08-12' })

    const [row] = await expenses.placePricesFor(ownPrices(me, [itemId]))
    expect(row?.scaledMinor).toBe(price(600_000))
    expect(row?.observations).toBe(3)
  })

  it('решает день записи, как его назвал телефон, а не момент её начала', async () => {
    const me = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    await bought(me, itemId, placeId, amd(540_000), kilo, {
      on: '2026-09-13',
      at: new Date('2026-09-12T20:00:00Z'),
    })
    await bought(me, itemId, placeId, amd(600_000), kilo, {
      on: '2026-09-12',
      at: new Date('2026-09-12T21:00:00Z'),
    })

    const [row] = await expenses.placePricesFor(ownPrices(me, [itemId]))
    expect(row?.scaledMinor).toBe(price(540_000))
  })

  it('две пачки одной записи — по поздней строке', async () => {
    const me = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    const tripId = await insertTrip(db, { actorId: me, placeId, startedOn: '2026-09-12' })
    await bought(me, itemId, placeId, amd(540_000), kilo, { tripId })
    await db.execute(sql`select pg_sleep(0.01)`)
    await bought(me, itemId, placeId, amd(560_000), kilo, { tripId })

    const [row] = await expenses.placePricesFor(ownPrices(me, [itemId]))
    expect(row?.scaledMinor).toBe(price(560_000))
  })

  it('запись старой очереди без своего дня читается днём в зоне телефона', async () => {
    // 01:30 13-го в Ереване — 14:30 12-го в Лос-Анджелесе; вторая запись — 12-е по своему телефону.
    const me = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    await bought(me, itemId, placeId, amd(540_000), kilo, {
      on: null,
      at: new Date('2026-09-12T21:30:00Z'),
    })
    await bought(me, itemId, placeId, amd(600_000), kilo, {
      on: '2026-09-12',
      at: new Date('2026-09-12T23:00:00Z'),
    })

    const [yerevan] = await expenses.placePricesFor(ownPrices(me, [itemId]))
    expect(yerevan?.scaledMinor).toBe(price(540_000))
    const [la] = await expenses.placePricesFor({
      ...ownPrices(me, [itemId]),
      zone: 'America/Los_Angeles',
    })
    expect(la?.scaledMinor).toBe(price(600_000))
    // `Intl` знает имя, tzdata — нет: день Еревана, а не 500 (адверсариальный Ж MOL-92).
    const [unknown] = await expenses.placePricesFor({
      ...ownPrices(me, [itemId]),
      zone: 'US/Pacific-New',
    })
    expect(unknown?.scaledMinor).toBe(price(540_000))
  })

  it('удалённая запись не в счёт: цена — предыдущей', async () => {
    const me = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    await bought(me, itemId, placeId, amd(540_000), kilo, { on: '2026-09-01' })
    const removed = await insertTrip(db, {
      actorId: me,
      placeId,
      startedOn: '2026-09-20',
      deletedAt: new Date(),
    })
    await bought(me, itemId, placeId, amd(600_000), kilo, { tripId: removed })

    const [row] = await expenses.placePricesFor(ownPrices(me, [itemId]))
    expect(row?.scaledMinor).toBe(price(540_000))
    expect(row?.observations).toBe(1)
  })

  it('места упорядочены по последней цене: дешёвое по минимуму, но подорожавшее — ниже', async () => {
    const me = await insertActor(db)
    const itemId = await insertItem(db)
    const zovuni = await insertPlace(db, { name: 'Зовуни' })
    const sas = await insertPlace(db, { name: 'SAS' })
    await bought(me, itemId, zovuni, amd(540_000), kilo, { on: '2026-08-12' })
    await bought(me, itemId, zovuni, amd(600_000), kilo, { on: '2026-09-20' })
    await bought(me, itemId, sas, amd(580_000), kilo, { on: '2026-09-15' })

    const rows = await expenses.placePricesFor(ownPrices(me, [itemId]))
    expect(rows.map((row) => [row.placeName, row.scaledMinor])).toEqual([
      ['SAS', price(580_000)],
      ['Зовуни', price(600_000)],
    ])
  })

  it('общий режим, своё место: моя последняя, даже когда чужие брали там позже и дешевле', async () => {
    const me = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    await bought(me, itemId, placeId, amd(600_000), kilo, { on: '2026-09-01' })
    for (const minor of [400_000, 410_000, 420_000]) {
      await bought(await insertActor(db), itemId, placeId, amd(minor), kilo, { on: '2026-09-25' })
    }

    const [row] = await expenses.placePricesFor(sharedPrices(me, [itemId]))
    expect(row?.scaledMinor).toBe(price(600_000))
  })

  it('общий режим, чужое место: нижняя медиана последних цен покупателей, а не чек последнего', async () => {
    // А: акция 520 в августе, потом 590; Б: 610; В: 600 — последним. Середина последних — 600, а не
    // 520 (минимум) и не «кто брал последним».
    const me = await insertActor(db)
    const itemId = await insertItem(db)
    const theirs = await insertPlace(db, { name: 'Ереван Сити' })
    const [a, b, c] = [await insertActor(db), await insertActor(db), await insertActor(db)]
    await bought(a, itemId, theirs, amd(520_000), kilo, { on: '2026-08-05' })
    await bought(a, itemId, theirs, amd(590_000), kilo, { on: '2026-09-28' })
    await bought(b, itemId, theirs, amd(610_000), kilo, { on: '2026-09-20' })
    await bought(c, itemId, theirs, amd(600_000), kilo, { on: '2026-09-30' })

    const [row] = await expenses.placePricesFor(sharedPrices(me, [itemId]))
    expect(row?.scaledMinor).toBe(price(600_000))
    expect(row?.observations).toBe(4)

    // Г покупает дороже всех: середина сдвигается к нижней из двух средних, его чек не назван.
    await bought(await insertActor(db), itemId, theirs, amd(650_000), kilo, { on: '2026-10-01' })
    const [four] = await expenses.placePricesFor(sharedPrices(me, [itemId]))
    expect(four?.scaledMinor).toBe(price(600_000))
  })

  it('общий режим, чужое место: покупатель — один вклад, сколько бы раз ни брал', async () => {
    const me = await insertActor(db)
    const itemId = await insertItem(db)
    const theirs = await insertPlace(db, { name: 'Ереван Сити' })
    const often = await insertActor(db)
    for (const [minor, on] of [
      [300_000, '2026-09-01'],
      [310_000, '2026-09-02'],
      [700_000, '2026-09-03'],
    ] as const) {
      await bought(often, itemId, theirs, amd(minor), kilo, { on })
    }
    await bought(await insertActor(db), itemId, theirs, amd(500_000), kilo, { on: '2026-09-04' })
    await bought(await insertActor(db), itemId, theirs, amd(510_000), kilo, { on: '2026-09-05' })

    const [row] = await expenses.placePricesFor(sharedPrices(me, [itemId]))
    // Последние: 700, 500, 510 — середина 510; по всем покупкам была бы 500 или ниже.
    expect(row?.scaledMinor).toBe(price(510_000))
  })
})
