/**
 * The adversarial pass of MOL-21 (`.scratch/tasks/selftests/MOL-21-adversarial.md`), kept with
 * the answers turned the right way round: each case here was green on the attack while the
 * defect lived. The races are not left to timing — a third connection holds the lock the
 * attacked request has to wait on.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { ERROR, recentPlacesResponseSchema, tripViewCodec } from '@molvia/model'
import type { TripView } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { expenses, places, searchPicks } from '@/db/schema'
import { searchQueryKey } from '@/db/items-repository'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem } from './fixtures'

const { db, close } = connectDrizzle()
// The test pool holds one connection, so a second server needs its own to run beside the first,
// and a third holds locks the way a concurrent request would.
const second = connectDrizzle()
const third = connectDrizzle()

let app: FastifyInstance
let app2: FastifyInstance

beforeAll(async () => {
  app = buildServer({ db })
  app2 = buildServer({ db: second.db })
  await Promise.all([app.ready(), app2.ready()])
})

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await Promise.all([app.close(), app2.close()])
  await clearAll(db)
  await Promise.all([close(), second.close(), third.close()])
})

interface Reply {
  readonly status: number
  readonly body: unknown
}

async function call(
  server: FastifyInstance,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  actor: string,
  body?: unknown,
): Promise<Reply> {
  const response = await server.inject({
    method,
    url,
    headers: { 'x-molvia-actor': actor },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  })
  return {
    status: response.statusCode,
    body: response.body === '' ? undefined : (JSON.parse(response.body) as unknown),
  }
}

const view = (reply: Reply): TripView => tripViewCodec.parse(reply.body)
const code = (reply: Reply): unknown => (reply.body as { code?: unknown } | undefined)?.code
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function startTrip(actor: string, name = 'Ереван Сити'): Promise<string> {
  const id = randomUUID()
  const reply = await call(app, 'POST', '/trips', actor, { id, place: { kind: 'store', name } })
  expect(reply.status).toBe(201)
  return id
}

async function rowsOf(tripId: string) {
  return db.select().from(expenses).where(eq(expenses.tripId, tripId))
}

describe('А. цена за единицу за пределом int8 — не повод терять поход', () => {
  // 92 233 720,37 ֏ за 1 г: каждое поле в границах домена, отношение — за INT8_MAX.
  const OVER = {
    amount: { amount: '92233720.37', currency: 'AMD' },
    quantity: { value: '0.001', unit: 'kg' },
  }

  it('трата записана и ответ 201 — цена за единицу несётся проводом целиком', async () => {
    const actor = await insertActor(db)
    const saffron = await insertItem(db, {
      name: 'Шафран',
      searchKey: 'shafran',
      defaultUnit: 'kg',
    })
    const tripId = await startTrip(actor)

    const reply = await call(app, 'POST', `/trips/${tripId}/expenses`, actor, {
      id: randomUUID(),
      itemId: saffron,
      ...OVER,
    })

    expect(reply.status).toBe(201)
    expect(view(reply).expenses[0]?.unitPrice?.scaledMinor).toBe(9_223_372_037_000_000_000n)
  })

  it('после неё поход читается, повтор — 200, следующая трата — 201', async () => {
    const actor = await insertActor(db)
    const saffron = await insertItem(db, {
      name: 'Шафран',
      searchKey: 'shafran',
      defaultUnit: 'kg',
    })
    const milk = await insertItem(db, { name: 'Молоко', searchKey: 'moloko' })
    const tripId = await startTrip(actor)
    const id = randomUUID()
    await call(app, 'POST', `/trips/${tripId}/expenses`, actor, { id, itemId: saffron, ...OVER })

    expect((await call(app, 'GET', '/trips/current', actor)).status).toBe(200)
    const repeat = await call(app, 'POST', `/trips/${tripId}/expenses`, actor, {
      id,
      itemId: saffron,
      ...OVER,
    })
    expect(repeat.status).toBe(200)
    const next = await call(app, 'POST', `/trips/${tripId}/expenses`, actor, {
      id: randomUUID(),
      itemId: milk,
      amount: { amount: '570', currency: 'AMD' },
    })
    expect(next.status).toBe(201)
    expect(await rowsOf(tripId)).toHaveLength(2)
  })
})

describe('Б. итог похода держится и между двумя одновременными тратами', () => {
  // Половина INT8_MAX с округлением вверх: каждая сумма в одиночку законна, двух — уже нет.
  const HALF = { amount: '46116860184527379.04', currency: 'AMD' }

  it('две траты одновременно: одна 201, другая 400 и откат; поход читается', async () => {
    const actor = await insertActor(db)
    const gold = await insertItem(db, { name: 'Слиток', searchKey: 'slitok', defaultUnit: 'piece' })
    const bread = await insertItem(db, { name: 'Хлеб', searchKey: 'hleb', defaultUnit: 'piece' })
    const tripId = await startTrip(actor)
    const keyA = searchQueryKey('слиток') ?? ''
    const keyB = searchQueryKey('слит') ?? ''

    // Третье соединение держит незафиксированные строки выбора под теми же ключами: без замка
    // похода каждая трата вставляла свою строку и проверяла итог, не видя другой.
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let held!: () => void
    const holding = new Promise<void>((resolve) => (held = resolve))
    const holder = third.db
      .transaction(async (tx) => {
        await tx.insert(searchPicks).values([
          { actorId: actor, queryKey: keyA, itemId: gold },
          { actorId: actor, queryKey: keyB, itemId: gold },
        ])
        held()
        await gate
        tx.rollback()
      })
      .catch(() => undefined)
    await holding

    const a = call(app, 'POST', `/trips/${tripId}/expenses`, actor, {
      id: randomUUID(),
      itemId: gold,
      amount: HALF,
      query: 'слиток',
    })
    const b = call(app2, 'POST', `/trips/${tripId}/expenses`, actor, {
      id: randomUUID(),
      itemId: gold,
      amount: HALF,
      query: 'слит',
    })
    await sleep(400)
    release()
    await holder
    const replies = await Promise.all([a, b])

    expect(replies.map((reply) => reply.status).sort()).toEqual([201, 400])
    expect(replies.map(code)).toContain(ERROR.INVALID_AMOUNT)
    expect(await rowsOf(tripId)).toHaveLength(1)

    expect((await call(app, 'GET', '/trips/current', actor)).status).toBe(200)
    const loaf = await call(app, 'POST', `/trips/${tripId}/expenses`, actor, {
      id: randomUUID(),
      itemId: bread,
    })
    expect(loaf.status).toBe(201)
  })
})

describe('В. id устройства в верхнем регистре', () => {
  it('трата с id в верхнем регистре правится и удаляется тем же id', async () => {
    const actor = await insertActor(db)
    const milk = await insertItem(db, { name: 'Молоко', searchKey: 'moloko' })
    const tripId = await startTrip(actor)
    // Так id выдаёт, например, `UUID().uuidString` на iOS; `z.uuid()` его принимает.
    const upper = randomUUID().toUpperCase()

    expect(
      (await call(app, 'POST', `/trips/${tripId}/expenses`, actor, { id: upper, itemId: milk }))
        .status,
    ).toBe(201)

    const patched = await call(app, 'PATCH', `/trips/${tripId}/expenses/${upper}`, actor, {
      amount: { amount: '570', currency: 'AMD' },
    })
    expect(patched.status).toBe(200)
    expect(view(patched).total).toEqual([{ minor: 57_000n, currency: 'AMD' }])

    expect((await call(app, 'DELETE', `/trips/${tripId}/expenses/${upper}`, actor)).status).toBe(
      200,
    )
    expect(await rowsOf(tripId)).toEqual([])
  })
})

describe('Г. правка и удаление наперегонки с удалением', () => {
  async function withRow() {
    const actor = await insertActor(db)
    const milk = await insertItem(db, { name: 'Молоко', searchKey: 'moloko' })
    const tripId = await startTrip(actor)
    const expenseId = randomUUID()
    const added = await call(app, 'POST', `/trips/${tripId}/expenses`, actor, {
      id: expenseId,
      itemId: milk,
    })
    expect(added.status).toBe(201)
    return { actor, tripId, expenseId }
  }

  /** Держит строку под замком, пока `during` не встанет на неё, затем удаляет и фиксирует. */
  async function deleteUnder<T>(expenseId: string, during: () => Promise<T>): Promise<T> {
    let locked!: () => void
    const isLocked = new Promise<void>((resolve) => (locked = resolve))
    let go!: () => void
    const gate = new Promise<void>((resolve) => (go = resolve))
    const holder = third.db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from expenses where id = ${expenseId} for update`)
      locked()
      await gate
      await tx.delete(expenses).where(eq(expenses.id, expenseId))
    })
    await isLocked
    const pending = during()
    await sleep(300)
    go()
    await holder
    return pending
  }

  it('цена, сохраняемая в удаляемую трату, — 404, а не «сохранено»', async () => {
    const { actor, tripId, expenseId } = await withRow()

    const reply = await deleteUnder(expenseId, () =>
      call(app, 'PATCH', `/trips/${tripId}/expenses/${expenseId}`, actor, {
        amount: { amount: '570', currency: 'AMD' },
      }),
    )

    expect(reply.status).toBe(404)
    expect(code(reply)).toBe(ERROR.NOT_FOUND)
  })

  it('С-8: удаление отвечает одинаково, успел ли первый — 200 наперегонки и 200 после', async () => {
    const { actor, tripId, expenseId } = await withRow()

    const racing = await deleteUnder(expenseId, () =>
      call(app, 'DELETE', `/trips/${tripId}/expenses/${expenseId}`, actor),
    )
    const after = await call(app, 'DELETE', `/trips/${tripId}/expenses/${expenseId}`, actor)

    expect([racing.status, after.status]).toEqual([200, 200])
    expect(view(after).expenses).toEqual([])
  })

  it('С-8: повтор удаления не трогает чужую трату и не открывает чужой поход', async () => {
    const { actor: stranger, tripId: theirTrip, expenseId: theirs } = await withRow()
    const owner = await insertActor(db)
    const myTrip = await startTrip(owner, 'Рынок')

    const underMine = await call(app, 'DELETE', `/trips/${myTrip}/expenses/${theirs}`, owner)
    const underTheirs = await call(app, 'DELETE', `/trips/${theirTrip}/expenses/${theirs}`, owner)

    expect(underMine.status).toBe(200)
    expect(view(underMine).id).toBe(myTrip)
    expect(underTheirs.status).toBe(404)
    expect(await rowsOf(theirTrip)).toHaveLength(1)
    expect((await call(app, 'GET', '/trips/current', stranger)).status).toBe(200)
  })
})

describe('Д. невидимый знак по краю имени — то же место', () => {
  async function startAndFinish(actor: string, name: string) {
    const id = randomUUID()
    const reply = await call(app, 'POST', '/trips', actor, { id, place: { kind: 'store', name } })
    expect(reply.status).toBe(201)
    expect((await call(app, 'POST', `/trips/${id}/finish`, actor)).status).toBe(204)
    return view(reply).place.id
  }

  it.each([
    ['U+200B zero width space', '​'],
    ['U+00A0 no-break space', ' '],
    ['U+2060 word joiner', '⁠'],
    ['U+00AD soft hyphen', '­'],
    ['U+2800 braille blank', '⠀'],
    ['U+3164 hangul filler', 'ㅤ'],
  ])('%s в начале и в конце — то же место', async (_label, mark) => {
    const actor = await insertActor(db)
    const first = await startAndFinish(actor, 'Ереван Сити')

    expect(await startAndFinish(actor, `Ереван Сити${mark}`)).toBe(first)
    expect(await startAndFinish(actor, `${mark}Ереван Сити`)).toBe(first)

    const recent = recentPlacesResponseSchema.parse(
      (await call(app, 'GET', '/places/recent', actor)).body,
    )
    expect(recent.places.map((place) => place.name)).toEqual(['Ереван Сити'])
    expect(await db.select().from(places)).toHaveLength(1)
  })

  it('не должно сработать: знак внутри имени остаётся — это уже другое имя', async () => {
    const actor = await insertActor(db)
    const first = await startAndFinish(actor, 'Ереван Сити')
    expect(await startAndFinish(actor, 'Ереван­Сити')).not.toBe(first)
  })
})
