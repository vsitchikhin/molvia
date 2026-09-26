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
  parseRate,
  recentPlacesResponseSchema,
  toSearchKey,
  tripViewCodec,
  yerevanDate,
  yerevanMidnight,
} from '@molvia/model'
import type { CachedRate, RateProvider, TripView } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createRateRepository } from '@/db/rates-repository'
import { places, searchPicks, trips } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, signIn, tripContext } from './fixtures'

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
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  actor: string | null,
  body?: unknown,
): Promise<Reply> {
  const response = await app.inject({
    method,
    url,
    headers: actor === null ? {} : { cookie: await signIn(db, actor) },
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

async function start(actor: string, name = 'Ереван Сити', id: string = randomUUID()) {
  return call('POST', '/trips', actor, {
    context: await tripContext(db, actor),
    id,
    place: { kind: 'store', name },
  })
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

  it('чужой expenseId в своём походе: правка 404, удаление 200 — чужая трата не тронута', async () => {
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

    // Правка — 404: цену некуда записать. Удаление — 200 и свой поход как есть (С-8): в своём
    // походе такой строки нет, то есть она «уже удалена»; чужую строку это не трогает.
    expect([patched.status, removed.status]).toEqual([404, 200])
    expect(trip(removed).id).toBe(myTrip)
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
      context: await tripContext(db, actor),
      id: randomUUID(),
      place: { kind: 'venue', name: 'Кафе' },
    })
    expect(reply.status).toBe(400)
  })

  it('поход без id — 400: назвать его может только устройство', async () => {
    const actor = await insertActor(db)
    const reply = await call('POST', '/trips', actor, {
      context: await tripContext(db, actor),
      place: { kind: 'store', name: 'SAS' },
    })
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

describe('личное слово (MOL-45) пишется добавлением в поход', () => {
  async function found(actor: string, query: string): Promise<string[]> {
    const reply = await call('GET', `/catalogue/search?q=${encodeURIComponent(query)}`, actor)
    return catalogueSearchResponseSchema.parse(reply.body).items.map((entry) => entry.name)
  }

  it('запрос, который ничего не нашёл, находит взятое после него — только у этого человека', async () => {
    const actor = await insertActor(db)
    const stranger = await insertActor(db)
    const melon = await item('Арбуз')
    const tripId = trip(await start(actor)).id
    expect(await found(actor, 'бахчевые')).toEqual([])

    await add(actor, tripId, { itemId: melon, query: 'арбуз', missedQuery: 'бахчевые' })

    expect(await found(actor, 'бахчевые')).toEqual(['Арбуз'])
    expect(await found(stranger, 'бахчевые')).toEqual([])
  })

  it('не должно сработать: повтор очереди учит один раз', async () => {
    const actor = await insertActor(db)
    const melon = await item('Арбуз')
    const tripId = trip(await start(actor)).id
    const body = { id: randomUUID(), itemId: melon, query: 'арбуз', missedQuery: 'бахчевые' }

    await call('POST', `/trips/${tripId}/expenses`, actor, body)
    await call('POST', `/trips/${tripId}/expenses`, actor, body)

    const rows = await db.select().from(searchPicks)
    expect(rows.map((row) => [row.picks, row.admits]).sort()).toEqual([
      [1, false],
      [1, true],
    ])
  })

  it('не должно сработать: трата не записалась — слова нет', async () => {
    const actor = await insertActor(db)
    const tripId = trip(await start(actor)).id

    await add(actor, tripId, { itemId: randomUUID(), query: 'арбуз', missedQuery: 'бахчевые' })
    expect(await db.select().from(searchPicks)).toEqual([])
  })
})

describe('курс в походе (MOL-39)', () => {
  // Dated by the real clock: the route snapshots as of now, in Yerevan.
  const today = yerevanDate(new Date())
  const daysAgo = (days: number): string =>
    yerevanDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000))
  const rub = (value: string, date = today, provider: RateProvider = 'cba'): CachedRate => ({
    provider,
    currency: 'RUB',
    date,
    scaled: parseRate(value),
    jump: false,
  })
  const rates = createRateRepository(db)

  it('«Начать поход» снимает курс ЦБ РА, и пересчёт считает сервер', async () => {
    await rates.upsert([rub('4.3123', daysAgo(1))])
    const actor = await insertActor(db)

    const started = await start(actor)
    const view = trip(started)
    const itemId = await insertItem(db)
    const added = await add(actor, view.id, {
      itemId,
      amount: { amount: '10000', currency: 'AMD' },
    })

    expect(started.body).toMatchObject({
      rate: { base: 'RUB', quote: 'AMD', rate: '4.312300', source: 'official' },
    })
    expect(view.rate?.asOf).toEqual(yerevanMidnight(daysAgo(1)))
    // 10 000 ֏ / 4.3123 = 2 318.948… ₽
    expect(added.body).toMatchObject({ converted: { amount: '2318.95', currency: 'RUB' } })
  })

  it('новый курс в кеше не трогает начатый поход — ни в текущем, ни в повторе POST', async () => {
    await rates.upsert([rub('4.3123', daysAgo(1))])
    const actor = await insertActor(db)
    const id = randomUUID()
    const before = trip(await start(actor, 'Ереван Сити', id))

    await rates.upsert([rub('4.5000', today), rub('4.4000', daysAgo(1))])

    expect(await current(actor)).toEqual(before)
    expect(trip(await start(actor, 'Ереван Сити', id)).rate).toEqual(before.rate)
    const [row] = await db.select().from(trips).where(eq(trips.id, id))
    expect(row?.rateScaled).toBe(4_312_300n)
  })

  it('следующий поход берёт уже новый курс', async () => {
    await rates.upsert([rub('4.3123', daysAgo(1))])
    const actor = await insertActor(db)
    const first = trip(await start(actor))
    await call('POST', `/trips/${first.id}/finish`, actor)
    await rates.upsert([rub('4.5000', today)])

    expect(trip(await start(actor)).rate).toMatchObject({ scaled: 4_500_000n })
  })

  it('курс из будущего не берётся — даже если поставщик его уже выставил', async () => {
    const tomorrow = yerevanDate(new Date(Date.now() + 24 * 60 * 60 * 1000))
    await rates.upsert([rub('4.3123', daysAgo(1)), rub('9.9999', tomorrow, 'cba')])
    const actor = await insertActor(db)

    expect(trip(await start(actor)).rate).toMatchObject({ scaled: 4_312_300n })
  })

  it('ЦБ РА молчит больше недели — запасной курс с пометкой fallback', async () => {
    await rates.upsert([rub('4.3123', daysAgo(8)), rub('4.3165', daysAgo(1), 'cbr')])
    const actor = await insertActor(db)

    expect((await start(actor)).body).toMatchObject({
      rate: { rate: '4.316500', source: 'fallback' },
    })
  })

  it('пустой кеш — поход без курса, а не отказ', async () => {
    const actor = await insertActor(db)
    const started = await start(actor)

    expect(started.status).toBe(201)
    expect(trip(started).rate).toBeNull()
  })

  it('доход и траты в одной валюте — курса нет даже при полном кеше', async () => {
    await rates.upsert([rub('4.3123', daysAgo(1))])
    const actor = await insertActor(db, { incomeCurrency: 'AMD' })

    expect(trip(await start(actor)).rate).toBeNull()
  })
})

describe('скачок курса и выбор человека (MOL-39, Р-19)', () => {
  const daysAgo = (days: number): string =>
    yerevanDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000))
  const rub = (value: string, date: string, jump = false): CachedRate => ({
    provider: 'cba',
    currency: 'RUB',
    date,
    scaled: parseRate(value),
    jump,
  })
  const rates = createRateRepository(db)
  const choose = (actor: string, tripId: string, choice: unknown) =>
    call('PUT', `/trips/${tripId}/rate-choice`, actor, { choice })

  async function jumpedTrip(): Promise<{ actor: string; view: TripView }> {
    await rates.upsert([rub('4.3050', daysAgo(2)), rub('431.23', daysAgo(1), true)])
    const actor = await insertActor(db)
    const view = trip(await start(actor))
    const itemId = await insertItem(db)
    const added = await add(actor, view.id, {
      itemId,
      amount: { amount: '10000', currency: 'AMD' },
    })
    return { actor, view: trip(added) }
  }

  it('поход считает по новому курсу, а рядом отдаёт прежний и пустой выбор', async () => {
    const { view } = await jumpedTrip()

    expect(view.rate?.scaled).toBe(431_230_000n)
    expect(view.rateJump).toMatchObject({
      jumped: { scaled: 431_230_000n },
      previous: { scaled: 4_305_000n, source: 'official' },
      choice: null,
    })
    // 10 000 ֏ / 431.23
    expect(view.converted).toEqual({ minor: 2_319n, currency: 'RUB' })
  })

  it('выбор «по прежнему» пересчитывает поход, снимок остаётся как был', async () => {
    const { actor, view } = await jumpedTrip()

    const chosen = await choose(actor, view.id, 'previous')

    expect(chosen.status).toBe(200)
    expect(chosen.body).toMatchObject({
      rate: { rate: '4.305000' },
      rateJump: { choice: 'previous' },
      // 10 000 ֏ / 4.305
      converted: { amount: '2322.88', currency: 'RUB' },
    })
    const [row] = await db.select().from(trips).where(eq(trips.id, view.id))
    expect(row).toMatchObject({ rateScaled: 431_230_000n, rateChoice: 'previous' })
    expect(await current(actor)).toEqual(trip(chosen))
  })

  it('выбор можно повторить и передумать — обратно «по новому»', async () => {
    const { actor, view } = await jumpedTrip()
    await choose(actor, view.id, 'previous')
    const again = await choose(actor, view.id, 'previous')
    const back = await choose(actor, view.id, 'jumped')

    expect(again.status).toBe(200)
    expect(trip(back).rate?.scaled).toBe(431_230_000n)
    expect(trip(back).rateJump?.choice).toBe('jumped')
  })

  it('выбрать можно и в завершённом походе — скачок часто замечают уже дома', async () => {
    const { actor, view } = await jumpedTrip()
    await call('POST', `/trips/${view.id}/finish`, actor)

    expect((await choose(actor, view.id, 'previous')).status).toBe(200)
  })

  it('поход без скачка — 409 conflict: выбирать не из чего', async () => {
    await rates.upsert([rub('4.3123', daysAgo(1))])
    const actor = await insertActor(db)
    const view = trip(await start(actor))

    const reply = await choose(actor, view.id, 'previous')

    expect(reply.status).toBe(409)
    expect(code(reply)).toBe(ERROR.CONFLICT)
    expect(view.rateJump).toBeNull()
  })

  it('чужой поход отвечает как несуществующий — 404, и выбор не записан', async () => {
    const { view } = await jumpedTrip()
    const stranger = await insertActor(db)

    expect((await choose(stranger, view.id, 'previous')).status).toBe(404)
    expect((await choose(stranger, randomUUID(), 'previous')).status).toBe(404)
    const [row] = await db.select().from(trips).where(eq(trips.id, view.id))
    expect(row?.rateChoice).toBeNull()
  })

  it('неизвестный выбор и лишнее поле — 400', async () => {
    const { actor, view } = await jumpedTrip()

    expect((await choose(actor, view.id, 'both')).status).toBe(400)
    expect(
      (await call('PUT', `/trips/${view.id}/rate-choice`, actor, { choice: 'jumped', rate: '4.3' }))
        .status,
    ).toBe(400)
  })

  it('скачок без более раннего курса — скачок виден, прежнего нет, свой курс можно ввести (Р-21)', async () => {
    await rates.upsert([rub('431.23', daysAgo(1), true)])
    const actor = await insertActor(db)
    const started = trip(await start(actor))

    expect(started.rateJump).toMatchObject({
      jumped: { scaled: 431_230_000n },
      previous: null,
      manual: null,
      choice: null,
    })
    expect((await choose(actor, started.id, 'previous')).status).toBe(409)
  })

  it('свой курс: поход считается по нему, источник personal, снимок не тронут', async () => {
    const { actor, view } = await jumpedTrip()

    const chosen = await call('PUT', `/trips/${view.id}/rate-choice`, actor, {
      choice: 'manual',
      rate: '4,31',
    })

    expect(chosen.status).toBe(200)
    expect(chosen.body).toMatchObject({
      rate: { rate: '4.310000', source: 'personal', base: 'RUB', quote: 'AMD' },
      rateJump: { choice: 'manual', manual: { rate: '4.310000', source: 'personal' } },
      // 10 000 ֏ / 4.31
      converted: { amount: '2320.19', currency: 'RUB' },
      rateStale: false,
    })
    const [row] = await db.select().from(trips).where(eq(trips.id, view.id))
    expect(row).toMatchObject({ rateScaled: 431_230_000n, rateManualScaled: 4_310_000n })
  })

  it('свой курс остаётся, если вернуться «по новому», и заменяется новым вводом', async () => {
    const { actor, view } = await jumpedTrip()
    const manual = (rate: string) =>
      call('PUT', `/trips/${view.id}/rate-choice`, actor, { choice: 'manual', rate })

    await manual('4.31')
    const back = trip(await choose(actor, view.id, 'jumped'))
    const again = trip(await manual('4.32'))

    expect(back.rate?.scaled).toBe(431_230_000n)
    expect(back.rateJump?.manual?.scaled).toBe(4_310_000n)
    expect(again.rate?.scaled).toBe(4_320_000n)
  })

  it('свой курс, который не курс, — 400 invalid_rate, и ничего не записано', async () => {
    const { actor, view } = await jumpedTrip()

    for (const rate of ['abc', '0', '-4.31', '0.00001']) {
      const reply = await call('PUT', `/trips/${view.id}/rate-choice`, actor, {
        choice: 'manual',
        rate,
      })
      expect(reply.status).toBe(400)
      expect(code(reply)).toBe(ERROR.INVALID_RATE)
    }
    expect(
      (await call('PUT', `/trips/${view.id}/rate-choice`, actor, { choice: 'manual' })).status,
    ).toBe(400)
    const [row] = await db.select().from(trips).where(eq(trips.id, view.id))
    expect(row).toMatchObject({ rateManualScaled: null, rateChoice: null })
  })

  it('свой курс в походе без скачка — 409: предлагается только при скачке', async () => {
    await rates.upsert([rub('4.3123', daysAgo(1))])
    const actor = await insertActor(db)
    const view = trip(await start(actor))

    const reply = await call('PUT', `/trips/${view.id}/rate-choice`, actor, {
      choice: 'manual',
      rate: '4.31',
    })
    expect(reply.status).toBe(409)
  })
})

describe('курс устарел (MOL-39, Р-18)', () => {
  const daysAgo = (days: number): string =>
    yerevanDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000))
  const rates = createRateRepository(db)
  const at = (provider: RateProvider, value: string, date: string): CachedRate => ({
    provider,
    currency: 'RUB',
    date,
    scaled: parseRate(value),
    jump: false,
  })

  it('ЦБ РА молчит больше недели, запасных нет — его курс с датой и признаком «устарел»', async () => {
    await rates.upsert([at('cba', '4.3123', daysAgo(10))])
    const actor = await insertActor(db)

    expect(trip(await start(actor))).toMatchObject({
      rate: { source: 'official' },
      rateProvider: 'cba',
      rateStale: true,
    })
  })

  // MOL-22, Р-3: «источник — запасной» ничего не говорит человеку, а условия агрегатора требуют
  // назвать его. Поэтому издатель едет в ответе и переживает перезагрузку.
  it('запасной курс называет издателя, и тот держится в снимке', async () => {
    await rates.upsert([at('cba', '4.3123', daysAgo(10)), at('cbr', '4.3165', daysAgo(1))])
    const actor = await insertActor(db)

    const started = trip(await start(actor))
    expect(started).toMatchObject({ rate: { source: 'fallback' }, rateProvider: 'cbr' })
    expect((await current(actor))?.rateProvider).toBe('cbr')
  })

  it('без курса издателя нет', async () => {
    const actor = await insertActor(db)

    expect(trip(await start(actor))).toMatchObject({ rate: null, rateProvider: null })
  })

  it('запасной такой же старый — всё равно ЦБ РА с признаком', async () => {
    await rates.upsert([at('cba', '4.3123', daysAgo(10)), at('cbr', '4.3165', daysAgo(10))])
    const actor = await insertActor(db)

    expect(trip(await start(actor))).toMatchObject({
      rate: { source: 'official' },
      rateStale: true,
    })
  })

  it('пятничный курс в воскресенье — не устарел: неделя ещё не прошла', async () => {
    await rates.upsert([at('cba', '4.3123', daysAgo(2))])
    const actor = await insertActor(db)

    expect(trip(await start(actor)).rateStale).toBe(false)
  })

  it('без курса признака нет', async () => {
    const actor = await insertActor(db)
    expect(trip(await start(actor)).rateStale).toBe(false)
  })
})
