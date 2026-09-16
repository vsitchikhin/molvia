import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { DomainError, moneySchema, newItemSchema, toSearchKey } from '@molvia/model'
import type { ExchangeRate, Money, Quantity } from '@molvia/model'
import { INT8_MAX } from '@molvia/model'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace } from './fixtures'
import { createActorRepository } from '@/db/actors-repository'
import { createExpenseRepository } from '@/db/expenses-repository'
import { createItemRepository } from '@/db/items-repository'
import { createPlaceRepository } from '@/db/places-repository'
import { createTripRepository } from '@/db/trips-repository'
import { createVerdictRepository } from '@/db/verdicts-repository'

const { db, close } = connectDrizzle()
const actors = createActorRepository(db)
const catalogue = createItemRepository(db)
const places = createPlaceRepository(db)
const trips = createTripRepository(db)
const expenses = createExpenseRepository(db)
const verdicts = createVerdictRepository(db)

const settings = {
  country: 'AM' as const,
  city: 'Гюмри',
  spendCurrency: 'AMD' as const,
  incomeCurrency: 'RUB' as const,
}
const litre: Quantity = { milli: 900n, unit: 'l' }
const price: Money = { minor: 57_000n, currency: 'AMD' }

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await close()
})

describe('владелец', () => {
  it('пишется с идентификатором, который принесло устройство, и читается обратно', async () => {
    const id = randomUUID()
    const created = await actors.create(id, settings)

    expect(created.id).toBe(id)
    expect(await actors.byId(id)).toEqual(created)
  })

  it('несуществующий владелец — это null, а не ошибка', async () => {
    expect(await actors.byId(randomUUID())).toBeNull()
  })

  it('правка настроек двигает updated_at триггером, а не сервером', async () => {
    const id = await insertActor(db)
    const before = await actors.byId(id)
    const updated = await actors.update(id, { city: 'Ереван' })

    expect(updated?.city).toBe('Ереван')
    // По той же причине, что и у вердикта: сравнение идёт там, где метки не теряют точность.
    const [row] = await db.execute<{ apart: boolean }>(sql`
      select updated_at > created_at as apart from actors where id = ${id}::uuid
    `)
    expect(row?.apart).toBe(true)
    expect(updated?.createdAt).toEqual(before?.createdAt)
  })
})

describe('справочник', () => {
  it('ключ поиска считается при записи, посимвольно', async () => {
    const name = 'Молоко «Ашхар» 3,2%'
    const item = await catalogue.create(
      { kind: 'product', name, barcodes: [], defaultUnit: 'l' },
      null,
    )

    expect(item.searchKey).toBe(toSearchKey(name))
  })

  it('кириллица и латиница сходятся в один ключ', async () => {
    const item = await catalogue.create(
      { kind: 'product', name: 'Молоко', barcodes: [], defaultUnit: 'l' },
      null,
    )

    expect(item.searchKey).toBe(toSearchKey('Moloko'))
  })

  it('позиция без заметки, без типичного количества и без штрихкодов читается', async () => {
    const item = await catalogue.create(
      { kind: 'product', name: 'Соль', barcodes: [], defaultUnit: 'kg' },
      null,
    )

    expect(item.note).toBeNull()
    expect(item.typicalQuantity).toBeNull()
    expect(item.barcodes).toEqual([])
    expect((await catalogue.byId(item.id))?.barcodes).toEqual([])
  })

  it('имя в 200 символов проходит, и ключ от него влезает', async () => {
    const name = 'я'.repeat(200)
    const item = await catalogue.create(
      { kind: 'product', name, barcodes: [], defaultUnit: 'kg' },
      null,
    )

    expect(item.name).toHaveLength(200)
    expect(item.searchKey.length).toBeLessThanOrEqual(800)
  })

  it('двадцать штрихкодов пишутся, двадцать первый до базы не доходит', async () => {
    const codes = Array.from({ length: 20 }, (_, index) => String(40_000_000 + index))
    const item = await catalogue.create(
      { kind: 'product', name: 'Вода', barcodes: codes, defaultUnit: 'l' },
      null,
    )
    expect(item.barcodes).toHaveLength(20)

    expect(() =>
      newItemSchema.parse({
        kind: 'product',
        name: 'Вода',
        defaultUnit: 'l',
        barcodes: [...codes, '40000020'],
      }),
    ).toThrow()
  })

  it('byIds отдаёт позиции в устойчивом порядке и со своими штрихкодами', async () => {
    const first = await catalogue.create(
      { kind: 'product', name: 'Молоко', barcodes: ['48200001'], defaultUnit: 'l' },
      null,
    )
    const second = await catalogue.create(
      { kind: 'product', name: 'Сыр', barcodes: [], defaultUnit: 'kg' },
      null,
    )

    const loaded = await catalogue.byIds([second.id, first.id])
    expect(loaded.map((item) => item.id)).toEqual([first.id, second.id].sort())
    expect(loaded.find((item) => item.id === first.id)?.barcodes).toEqual(['48200001'])
  })

  it('пустой список идентификаторов не идёт в базу', async () => {
    expect(await catalogue.byIds([])).toEqual([])
  })
})

describe('места', () => {
  it('ensure заводит место и возвращает его же на повторный вызов', async () => {
    const first = await places.ensure({ kind: 'store', name: 'SAS', country: 'AM', city: 'Гюмри' })
    const again = await places.ensure({ kind: 'store', name: 'SAS', country: 'AM', city: 'Гюмри' })

    expect(again.id).toBe(first.id)
    expect(await places.byId(first.id)).toEqual(first)
  })

  it('регистр, пробелы и полноширинные буквы не заводят второй карточки', async () => {
    const first = await places.ensure({ kind: 'store', name: 'SAS', country: 'AM', city: 'Гюмри' })

    for (const name of [' sas ', 'ＳＡＳ', 'SAS\ufeff', '\u200bSAS']) {
      const again = await places.ensure({ kind: 'store', name, country: 'AM', city: 'Гюмри' })
      expect(again.id).toBe(first.id)
      // Написание остаётся тем, каким место завели: DO UPDATE переписал бы его чужим вводом.
      expect(again.name).toBe('SAS')
    }
  })

  it('byIds отдаёт только запрошенные', async () => {
    const one = await places.ensure({ kind: 'store', name: 'SAS', country: 'AM', city: 'Гюмри' })
    await places.ensure({ kind: 'store', name: 'Рынок', country: 'AM', city: 'Гюмри' })

    expect((await places.byIds([one.id])).map((place) => place.name)).toEqual(['SAS'])
  })
})

describe('походы и траты', () => {
  it('поход без курса читается как null, а не как половина снимка', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const trip = await trips.start(actorId, { placeId }, 'AMD', null)

    expect(trip.rate).toBeNull()
    expect((await trips.byId(trip.id, actorId))?.rate).toBeNull()
  })

  it('курс уходит пятью колонками и возвращается объектом до последней цифры', async () => {
    const rate: ExchangeRate = {
      base: 'RUB',
      quote: 'AMD',
      scaled: 4_500_000n,
      source: 'personal',
      asOf: new Date('2026-09-10T09:00:00Z'),
    }
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)

    const trip = await trips.start(actorId, { placeId }, 'AMD', rate)
    expect(trip.rate).toEqual(rate)
    expect((await trips.byId(trip.id, actorId))?.rate).toEqual(rate)
  })

  it('свой поход завершается, и время завершения сохраняется', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const trip = await trips.start(actorId, { placeId }, 'AMD', null)

    const at = new Date()
    const finished = await trips.finish(trip.id, actorId, at)
    expect(finished?.finishedAt).toEqual(at)
    expect((await trips.byId(trip.id, actorId))?.finishedAt).toEqual(at)
  })

  it('трата без количества и без суммы — это null, а не ноль', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    const trip = await trips.start(actorId, { placeId }, 'AMD', null)

    const added = await expenses.add(actorId, { tripId: trip.id, itemId })
    expect(added.quantity).toBeNull()
    expect(added.amount).toBeNull()
  })

  it('предельная сумма пишется, а сумма за пределом не проходит домен', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    const trip = await trips.start(actorId, { placeId }, 'AMD', null)

    const added = await expenses.add(actorId, {
      tripId: trip.id,
      itemId,
      amount: { minor: INT8_MAX, currency: 'AMD' },
    })
    expect(added.amount?.minor).toBe(INT8_MAX)

    expect(() => moneySchema.parse({ minor: INT8_MAX + 1n, currency: 'AMD' })).toThrow()
  })

  it('дробная штука не проходит домен', () => {
    expect(() =>
      newItemSchema.parse({
        kind: 'product',
        name: 'Яйцо',
        defaultUnit: 'piece',
        typicalQuantity: { value: '1.5', unit: 'piece' },
      }),
    ).toThrow()
  })

  it('патч без полей до базы не доходит и говорит, где искать', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    const trip = await trips.start(actorId, { placeId }, 'AMD', null)
    const added = await expenses.add(actorId, { tripId: trip.id, itemId, amount: price })

    // Разобранный патч пустым не бывает — expensePatchSchema его отвергает, — поэтому
    // пустой здесь означает, что вызывающий обошёл домен. Это дефект сервера (Р-11), но
    // он обязан называть себя, а не отвечать «No values to set» из недр drizzle.
    await expect(expenses.update(added.id, actorId, {})).rejects.toThrow(/patch with no fields/)

    // И трата при этом не тронута.
    expect((await expenses.forTrip(trip.id, actorId))[0]?.amount).toEqual(price)
  })

  it('трата правится и удаляется', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db)
    const itemId = await insertItem(db)
    const trip = await trips.start(actorId, { placeId }, 'AMD', null)
    const added = await expenses.add(actorId, {
      tripId: trip.id,
      itemId,
      quantity: litre,
      amount: price,
    })

    const updated = await expenses.update(added.id, actorId, { amount: null })
    expect(updated?.amount).toBeNull()
    expect(updated?.quantity).toEqual(litre)

    expect(await expenses.remove(added.id, actorId)).toBe(true)
    expect(await expenses.forTrip(trip.id, actorId)).toEqual([])
  })
})

describe('вердикты', () => {
  it('товар оценивается без места, блюдо — вместе с местом', async () => {
    const actorId = await insertActor(db)
    const product = await insertItem(db)
    const dish = await insertItem(db, { kind: 'dish', name: 'Карбонара', searchKey: 'karbonara' })
    const cafe = await insertPlace(db, { kind: 'venue', name: 'Кафе' })

    expect((await verdicts.put(actorId, { itemId: product, score: 5 })).placeId).toBeNull()
    expect((await verdicts.put(actorId, { itemId: dish, placeId: cafe, score: 4 })).placeId).toBe(
      cafe,
    )
  })

  it('товар с местом и блюдо без места база не принимает', async () => {
    const actorId = await insertActor(db)
    const product = await insertItem(db)
    const dish = await insertItem(db, { kind: 'dish', name: 'Карбонара', searchKey: 'karbonara' })
    const cafe = await insertPlace(db, { kind: 'venue', name: 'Кафе' })

    // Р-11: сценарий обязан отказать раньше, через newVerdictSchemaFor(kind). Если дошло
    // сюда — это дефект сервера, поэтому отказ базы намеренно не переводится в доменный.
    await expect(
      verdicts.put(actorId, { itemId: product, placeId: cafe, score: 4 }),
    ).rejects.toThrow()
    await expect(verdicts.put(actorId, { itemId: dish, score: 4 })).rejects.toThrow()

    expect(await verdicts.listFor(actorId, 10)).toEqual([])
  })

  it('вердикт без отзыва читается', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    await verdicts.put(actorId, { itemId, score: 3 })

    expect((await verdicts.forItem(actorId, itemId, null))?.review).toBeNull()
  })

  it('оценка несуществующей позиции — NOT_FOUND', async () => {
    const actorId = await insertActor(db)

    await expect(verdicts.put(actorId, { itemId: randomUUID(), score: 4 })).rejects.toThrow(
      DomainError,
    )
  })

  it('переоценка заменяет мнение и оставляет след триггером', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)

    const first = await verdicts.put(actorId, { itemId, score: 5 })
    const second = await verdicts.put(actorId, { itemId, score: 2 })

    expect(second.id).toBe(first.id)
    expect(second.score).toBe(2)

    // След ищется в базе, а не через `Date`. Postgres хранит микросекунды, `Date` —
    // миллисекунды, и две метки внутри одной миллисекунды складываются в одну: замер дал
    // 10 таких случаев из 300. Домен это и не запрещает — `verdictSchema` требует
    // `updatedAt >= ratedAt`, — так что проверка строгого «>» через `Date` была строже
    // домена и краснела бы по расписанию часов, а не по состоянию кода.
    const [row] = await db.execute<{ apart: boolean }>(sql`
      select updated_at > rated_at as apart from verdicts where id = ${second.id}::uuid
    `)
    expect(row?.apart).toBe(true)
    expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(second.ratedAt.getTime())
  })
})
