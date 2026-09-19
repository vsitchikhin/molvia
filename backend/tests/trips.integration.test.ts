/**
 * The trip through the server rather than around it: the hook, the body seam, the use cases,
 * the transaction, the central error handler and the wire contract all take part. Every reply
 * is read through the codec the client parses, so a server that drifted from it fails here.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  CATALOGUE_QUERY_MAX,
  ERROR,
  catalogueSearchResponseSchema,
  currentTripResponseSchema,
  recentPlacesResponseSchema,
  toSearchKey,
  tripViewCodec,
} from '@molvia/model'
import type { TripView } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { places, searchPicks, trips } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem } from './fixtures'

const { db, close } = connectDrizzle()

let app: FastifyInstance

beforeAll(async () => {
  // Pointed at the test database: otherwise the server writes into the one entered by hand.
  app = buildServer({ db })
  await app.ready()
})

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await app.close()
  await clearAll(db)
  await close()
})

interface Reply {
  readonly status: number
  readonly body: unknown
  readonly headers: Record<string, unknown>
}

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  actor: string | null,
  body?: unknown,
): Promise<Reply> {
  const response = await app.inject({
    method,
    url,
    headers: actor === null ? {} : { 'x-molvia-actor': actor },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  })
  return {
    status: response.statusCode,
    body: response.body === '' ? undefined : (JSON.parse(response.body) as unknown),
    headers: response.headers,
  }
}

const trip = (reply: Reply): TripView => tripViewCodec.parse(reply.body)
const code = (reply: Reply): unknown => (reply.body as { code?: unknown } | undefined)?.code

function start(actor: string, name = 'Ереван Сити', id: string = randomUUID()) {
  return call('POST', '/trips', actor, { id, place: { kind: 'store', name } })
}

function add(actor: string, tripId: string, body: Record<string, unknown>) {
  return call('POST', `/trips/${tripId}/expenses`, actor, { id: randomUUID(), ...body })
}

async function current(actor: string): Promise<TripView | null> {
  const reply = await call('GET', '/trips/current', actor)
  expect(reply.status).toBe(200)
  return currentTripResponseSchema.parse(reply.body).trip
}

async function item(name: string, unit: 'kg' | 'l' | 'piece' = 'l'): Promise<string> {
  return insertItem(db, { name, searchKey: toSearchKey(name), defaultUnit: unit })
}

const amd = (amount: string) => ({ amount, currency: 'AMD' })

describe('поход у полки — фикстуры хендоффа', () => {
  it('начать, три позиции, итог 6 493,12 ֏ и цена за литр, где 520 дороже 570', async () => {
    const actor = await insertActor(db)
    const ashkhar = await item('Молоко «Ашхар»')
    const marianna = await item('Молоко «Марианна»')
    const beef = await item('Говядина, вырезка', 'kg')

    const started = await start(actor)
    expect(started.status).toBe(201)
    const tripId = trip(started).id

    await add(actor, tripId, {
      itemId: ashkhar,
      quantity: { value: '1', unit: 'l' },
      amount: amd('570'),
    })
    await add(actor, tripId, {
      itemId: marianna,
      quantity: { value: '0,9', unit: 'l' },
      amount: amd('520'),
    })
    const last = await add(actor, tripId, {
      itemId: beef,
      quantity: { value: '1.128', unit: 'kg' },
      amount: amd('5 403,12'),
    })

    expect(last.status).toBe(201)
    const wire = last.body as { expenses: { unitPrice: unknown }[]; total: unknown }
    expect(wire.expenses.map((row) => row.unitPrice)).toEqual([
      { amount: '570.00000000', currency: 'AMD', unit: 'l' },
      { amount: '577.77777778', currency: 'AMD', unit: 'l' },
      { amount: '4790.00000000', currency: 'AMD', unit: 'kg' },
    ])
    expect(wire.total).toEqual([{ amount: '6493.12', currency: 'AMD' }])
    expect(await current(actor)).toEqual(trip(last))
  })

  it('место, страна и город — из настроек; валюта похода — снимок валюты трат', async () => {
    const actor = await insertActor(db, { spendCurrency: 'USD', city: 'Ереван' })

    const view = trip(await start(actor, 'SAS'))

    expect(view.currency).toBe('USD')
    expect(view.rate).toBeNull()
    expect(view.converted).toBeNull()
    const [place] = await db.select().from(places).where(eq(places.id, view.place.id))
    expect(place).toMatchObject({ name: 'SAS', country: 'AM', city: 'Ереван', kind: 'store' })
  })

  it('ответ не кэшируется: траты приватны', async () => {
    const actor = await insertActor(db)
    expect((await start(actor)).headers['cache-control']).toBe('no-store')
    expect((await call('GET', '/trips/current', actor)).headers['cache-control']).toBe('no-store')
  })
})

describe('обязательна только позиция', () => {
  it('NULL: позиция без цены и количества — в списке есть, в итоге нет', async () => {
    const actor = await insertActor(db)
    const milk = await item('Молоко «Ашхар»')
    const bread = await item('Хлеб', 'piece')
    const tripId = trip(await start(actor)).id
    await add(actor, tripId, {
      itemId: milk,
      quantity: { value: '1', unit: 'l' },
      amount: amd('570'),
    })

    const view = trip(await add(actor, tripId, { itemId: bread }))

    expect(view.expenses).toHaveLength(2)
    expect(view.expenses[1]).toMatchObject({ quantity: null, amount: null, unitPrice: null })
    expect(view.total).toEqual([{ minor: 57_000n, currency: 'AMD' }])
  })

  it('вернуться позже: цена дописывается, потом стирается', async () => {
    const actor = await insertActor(db)
    const beef = await item('Говядина, вырезка', 'kg')
    const tripId = trip(await start(actor)).id
    const expenseId = trip(await add(actor, tripId, { itemId: beef })).expenses[0]?.id ?? ''

    const priced = await call('PATCH', `/trips/${tripId}/expenses/${expenseId}`, actor, {
      quantity: { value: '1.128', unit: 'kg' },
      amount: amd('5403.12'),
    })
    expect(priced.status).toBe(200)
    expect(trip(priced).total).toEqual([{ minor: 540_312n, currency: 'AMD' }])

    const cleared = await call('PATCH', `/trips/${tripId}/expenses/${expenseId}`, actor, {
      amount: null,
    })
    expect(trip(cleared).expenses[0]).toMatchObject({ amount: null, unitPrice: null })
    expect(trip(cleared).total).toEqual([])
  })

  it('пустой патч — 400, строка не тронута', async () => {
    const actor = await insertActor(db)
    const milk = await item('Молоко «Ашхар»')
    const tripId = trip(await start(actor)).id
    const expenseId = trip(await add(actor, tripId, { itemId: milk, amount: amd('570') }))
      .expenses[0]?.id

    const reply = await call('PATCH', `/trips/${tripId}/expenses/${String(expenseId)}`, actor, {})
    expect(reply.status).toBe(400)
    expect((await current(actor))?.total).toEqual([{ minor: 57_000n, currency: 'AMD' }])
  })

  it('удалить позицию — итог пересчитан', async () => {
    const actor = await insertActor(db)
    const milk = await item('Молоко «Ашхар»')
    const tripId = trip(await start(actor)).id
    const expenseId = trip(await add(actor, tripId, { itemId: milk, amount: amd('570') }))
      .expenses[0]?.id

    const reply = await call('DELETE', `/trips/${tripId}/expenses/${String(expenseId)}`, actor)

    expect(reply.status).toBe(200)
    expect(trip(reply)).toMatchObject({ expenses: [], total: [] })
  })

  it('доллары в драмовом походе — второй итог, а не ошибка', async () => {
    const actor = await insertActor(db)
    const milk = await item('Молоко «Ашхар»')
    const tripId = trip(await start(actor)).id
    await add(actor, tripId, { itemId: milk, amount: amd('570') })

    const view = trip(
      await add(actor, tripId, { itemId: milk, amount: { amount: '2', currency: 'USD' } }),
    )

    expect(view.total).toEqual([
      { minor: 57_000n, currency: 'AMD' },
      { minor: 200n, currency: 'USD' },
    ])
  })

  it('граница: цена 0 — можно, количество 0 — 400', async () => {
    const actor = await insertActor(db)
    const bag = await item('Пакет', 'piece')
    const tripId = trip(await start(actor)).id

    expect((await add(actor, tripId, { itemId: bag, amount: amd('0') })).status).toBe(201)
    const zero = await add(actor, tripId, { itemId: bag, quantity: { value: '0', unit: 'piece' } })
    expect(zero.status).toBe(400)
    expect(code(zero)).toBe(ERROR.INVALID_QUANTITY)
  })
})

describe('повторы: id от устройства (В-2)', () => {
  it('повтор «Начать поход» тем же id — 200 и тот же поход', async () => {
    const actor = await insertActor(db)
    const id = randomUUID()

    const first = await start(actor, 'Ереван Сити', id)
    const again = await start(actor, 'Ереван Сити', id)

    expect([first.status, again.status]).toEqual([201, 200])
    expect(trip(again)).toEqual(trip(first))
  })

  it('повтор траты тем же id — 200, одна покупка', async () => {
    const actor = await insertActor(db)
    const milk = await item('Молоко «Ашхар»')
    const tripId = trip(await start(actor)).id
    const body = { id: randomUUID(), itemId: milk, amount: amd('570') }

    const first = await call('POST', `/trips/${tripId}/expenses`, actor, body)
    const again = await call('POST', `/trips/${tripId}/expenses`, actor, body)

    expect([first.status, again.status]).toEqual([201, 200])
    expect(trip(again).expenses).toHaveLength(1)
  })

  it('id, занятый чужим походом, — 409 conflict (В-13)', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const id = randomUUID()
    await start(stranger, 'Рынок', id)

    const reply = await start(owner, 'Рынок', id)
    expect(reply.status).toBe(409)
    expect(code(reply)).toBe(ERROR.CONFLICT)
  })
})

describe('«Начать поход», когда открыт другой (В-4, В-6, В-7)', () => {
  it('409 trip_open и ни строки; «завершить и начать новый» — 204, затем 201', async () => {
    const actor = await insertActor(db)
    const market = trip(await start(actor, 'Рынок')).id
    const next = randomUUID()

    const refused = await start(actor, 'Ереван Сити', next)
    expect(refused.status).toBe(409)
    expect(code(refused)).toBe(ERROR.TRIP_OPEN)
    expect(await db.select().from(trips)).toHaveLength(1)
    // «Ереван Сити» не заведён: отказ откатил и место.
    expect(await db.select().from(places)).toHaveLength(1)

    // «Продолжить» — это просто текущий поход.
    expect((await current(actor))?.id).toBe(market)

    // «Завершить и начать новый».
    expect((await call('POST', `/trips/${market}/finish`, actor)).status).toBe(204)
    const started = await start(actor, 'Ереван Сити', next)
    expect(started.status).toBe(201)
    expect((await current(actor))?.id).toBe(next)
  })

  it('тот же магазин — тоже выбор, а не тихое продолжение', async () => {
    const actor = await insertActor(db)
    await start(actor, 'Ереван Сити')

    expect(code(await start(actor, 'Ереван Сити'))).toBe(ERROR.TRIP_OPEN)
  })

  it('после завершения текущего похода нет — экран «Новый поход»', async () => {
    const actor = await insertActor(db)
    const tripId = trip(await start(actor)).id

    await call('POST', `/trips/${tripId}/finish`, actor)
    expect(await current(actor)).toBeNull()
  })
})

describe('завершённый поход (В-8)', () => {
  it('принимает забытое: соевый соус, найденный дома', async () => {
    const actor = await insertActor(db)
    const sauce = await item('Соевый соус', 'piece')
    const tripId = trip(await start(actor)).id
    await call('POST', `/trips/${tripId}/finish`, actor)

    const reply = await add(actor, tripId, { itemId: sauce, amount: amd('890') })

    expect(reply.status).toBe(201)
    expect(trip(reply).finishedAt).toBeInstanceOf(Date)
    expect(trip(reply).total).toEqual([{ minor: 89_000n, currency: 'AMD' }])
  })

  it('повторное завершение — 204, момент не сдвигается', async () => {
    const actor = await insertActor(db)
    const tripId = trip(await start(actor)).id
    await call('POST', `/trips/${tripId}/finish`, actor)
    const [first] = await db.select().from(trips).where(eq(trips.id, tripId))

    expect((await call('POST', `/trips/${tripId}/finish`, actor)).status).toBe(204)
    const [again] = await db.select().from(trips).where(eq(trips.id, tripId))
    expect(again?.finishedAt).toEqual(first?.finishedAt)
  })
})

describe('чужое отвечает как несуществующее (IDOR)', () => {
  it('чужой tripId: добавить, завершить — 404, и ни строки', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const milk = await item('Молоко «Ашхар»')
    const tripId = trip(await start(owner)).id

    const added = await add(stranger, tripId, { itemId: milk })
    const finished = await call('POST', `/trips/${tripId}/finish`, stranger)

    expect([added.status, finished.status]).toEqual([404, 404])
    expect(code(added)).toBe(ERROR.NOT_FOUND)
    expect((await current(owner))?.expenses).toEqual([])
    expect((await current(owner))?.finishedAt).toBeNull()
  })

  it('чужой expenseId в своём походе — 404, чужая трата не тронута', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const milk = await item('Молоко «Ашхар»')
    const theirTrip = trip(await start(stranger)).id
    const theirs = trip(await add(stranger, theirTrip, { itemId: milk, amount: amd('570') }))
      .expenses[0]?.id
    const myTrip = trip(await start(owner)).id

    const patched = await call('PATCH', `/trips/${myTrip}/expenses/${String(theirs)}`, owner, {
      amount: amd('1'),
    })
    const removed = await call('DELETE', `/trips/${myTrip}/expenses/${String(theirs)}`, owner)

    expect([patched.status, removed.status]).toEqual([404, 404])
    expect((await current(stranger))?.total).toEqual([{ minor: 57_000n, currency: 'AMD' }])
  })

  it('своя трата под чужим tripId — 404', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const milk = await item('Молоко «Ашхар»')
    const myTrip = trip(await start(owner)).id
    const mine = trip(await add(owner, myTrip, { itemId: milk })).expenses[0]?.id
    const theirTrip = trip(await start(stranger)).id

    const reply = await call('DELETE', `/trips/${theirTrip}/expenses/${String(mine)}`, owner)

    expect(reply.status).toBe(404)
    expect((await current(owner))?.expenses).toHaveLength(1)
  })

  it('своя трата из другого своего похода — 404, а не правка не того похода', async () => {
    const actor = await insertActor(db)
    const milk = await item('Молоко «Ашхар»')
    const earlier = trip(await start(actor, 'Рынок')).id
    const old = trip(await add(actor, earlier, { itemId: milk })).expenses[0]?.id
    await call('POST', `/trips/${earlier}/finish`, actor)
    const now = trip(await start(actor, 'Ереван Сити')).id

    const reply = await call('PATCH', `/trips/${now}/expenses/${String(old)}`, actor, {
      amount: amd('1'),
    })
    expect(reply.status).toBe(404)
  })

  it('кривой id в пути — тот же 404, а не 500', async () => {
    const actor = await insertActor(db)
    const milk = await item('Молоко «Ашхар»')

    expect((await add(actor, 'not-a-uuid', { itemId: milk })).status).toBe(404)
    expect((await call('POST', '/trips/not-a-uuid/finish', actor)).status).toBe(404)
  })

  it('товара, которого нет, — 404, и траты нет', async () => {
    const actor = await insertActor(db)
    const tripId = trip(await start(actor)).id

    const reply = await add(actor, tripId, { itemId: randomUUID() })

    expect(reply.status).toBe(404)
    expect((await current(actor))?.expenses).toEqual([])
  })

  it('без заголовка владельца — 401 на любой ручке похода', async () => {
    expect((await call('GET', '/trips/current', null)).status).toBe(401)
    expect((await call('GET', '/places/recent', null)).status).toBe(401)
    const reply = await call('POST', '/trips', null, {
      id: randomUUID(),
      place: { kind: 'store', name: 'SAS' },
    })
    expect(reply.status).toBe(401)
  })
})

describe('тело запроса', () => {
  it('заведение до 0.3 — 400', async () => {
    const actor = await insertActor(db)
    const reply = await call('POST', '/trips', actor, {
      id: randomUUID(),
      place: { kind: 'venue', name: 'Кафе' },
    })
    expect(reply.status).toBe(400)
  })

  it('поход без id — 400: назвать его может только устройство', async () => {
    const actor = await insertActor(db)
    const reply = await call('POST', '/trips', actor, { place: { kind: 'store', name: 'SAS' } })
    expect(reply.status).toBe(400)
  })

  it('граница: query в 200 символов принимается, в 201 — 400', async () => {
    const actor = await insertActor(db)
    const milk = await item('Молоко «Ашхар»')
    const tripId = trip(await start(actor)).id
    const at = 'м'.repeat(CATALOGUE_QUERY_MAX)

    expect((await add(actor, tripId, { itemId: milk, query: at })).status).toBe(201)
    expect((await add(actor, tripId, { itemId: milk, query: `${at}м` })).status).toBe(400)
  })
})

describe('последние места', () => {
  it('регистр и пробелы по краям — одно место: «Ереван Сити» и « ЕРЕВАН СИТИ »', async () => {
    const actor = await insertActor(db)
    const first = trip(await start(actor, 'Ереван Сити'))
    await call('POST', `/trips/${first.id}/finish`, actor)
    const second = trip(await start(actor, ' ЕРЕВАН СИТИ '))

    expect(second.place.id).toBe(first.place.id)
    const reply = await call('GET', '/places/recent', actor)
    expect(recentPlacesResponseSchema.parse(reply.body).places).toEqual([
      { id: first.place.id, kind: 'store', name: 'Ереван Сити' },
    ])
  })

  it('закреплено как есть: двойной пробел внутри — второе место (MOL-6; склейка — 0.2, В-11)', async () => {
    const actor = await insertActor(db)
    const first = trip(await start(actor, 'Ереван Сити'))
    await call('POST', `/trips/${first.id}/finish`, actor)
    const second = trip(await start(actor, 'Ереван  Сити'))

    expect(second.place.id).not.toBe(first.place.id)
  })

  it('чужие места не видны', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    await start(stranger, 'Рынок')

    const reply = await call('GET', '/places/recent', owner)
    expect(recentPlacesResponseSchema.parse(reply.body).places).toEqual([])
  })
})

describe('запомненный выбор (MOL-11) пишется добавлением в поход', () => {
  async function searchFirst(actor: string, query: string): Promise<string | undefined> {
    const reply = await call('GET', `/catalogue/search?q=${encodeURIComponent(query)}`, actor)
    return catalogueSearchResponseSchema.parse(reply.body).items[0]?.name
  }

  it('взятая по «молоко» марка встаёт первой на «молоко» в следующий раз', async () => {
    const actor = await insertActor(db)
    const byName = new Map([
      ['Молоко «Ашхар»', await item('Молоко «Ашхар»')],
      ['Молоко «Марианна»', await item('Молоко «Марианна»')],
    ])
    const tripId = trip(await start(actor)).id
    // The two are one tie at the same distance, broken by the row's uuid — so the one taken is
    // whichever was *not* first, and only a pick can have put it there.
    const before = await searchFirst(actor, 'молоко')
    const [takenName] = [...byName.keys()].filter((name) => name !== before)

    await add(actor, tripId, { itemId: byName.get(takenName ?? ''), query: 'молоко' })

    expect(await searchFirst(actor, 'молоко')).toBe(takenName)
  })

  it('не должно сработать: без query выбора нет', async () => {
    const actor = await insertActor(db)
    const milk = await item('Молоко «Ашхар»')
    const tripId = trip(await start(actor)).id

    await add(actor, tripId, { itemId: milk })
    expect(await db.select().from(searchPicks)).toEqual([])
  })

  it('не должно сработать: повтор очереди — выбор считан один раз', async () => {
    const actor = await insertActor(db)
    const milk = await item('Молоко «Ашхар»')
    const tripId = trip(await start(actor)).id
    const body = { id: randomUUID(), itemId: milk, query: 'молоко' }

    await call('POST', `/trips/${tripId}/expenses`, actor, body)
    await call('POST', `/trips/${tripId}/expenses`, actor, body)

    const rows = await db.select().from(searchPicks)
    expect(rows.map((row) => row.picks)).toEqual([1])
  })

  it('не должно сработать: трата не записалась — выбора нет', async () => {
    const actor = await insertActor(db)
    const tripId = trip(await start(actor)).id

    await add(actor, tripId, { itemId: randomUUID(), query: 'молоко' })
    expect(await db.select().from(searchPicks)).toEqual([])
  })
})
