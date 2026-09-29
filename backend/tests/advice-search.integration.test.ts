/**
 * The search on «Что брать» through the server (MOL-128, В-1): the catalogue searched as «Что
 * взяли?» searches it, and every item found answered with its row of «Что брать» by the list's own
 * rules — or `null`. The corners are «Проверки» of `requirements/MOL-128.md`.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { ADVICE_LIMIT, adviceSearchResponseSchema, toSearchKey, unitPrice } from '@molvia/model'
import type { AdviceSearchResponse, Money, Quantity } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { actors, events, expenses, items, searchPicks, verdicts } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, insertTrip, signIn } from './fixtures'

const { db, close } = connectDrizzle()

let app: FastifyInstance

const kilo: Quantity = { milli: 1000n, unit: 'kg' }
const amd = (minor: number): Money => ({ minor: BigInt(minor), currency: 'AMD' })

beforeAll(async () => {
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

async function ask(actor: string | null, query: string) {
  const response = await app.inject({
    method: 'GET',
    url: `/advice/search?${new URLSearchParams({ q: query }).toString()}`,
    headers: actor === null ? {} : { cookie: await signIn(db, actor) },
  })
  return { status: response.statusCode, headers: response.headers, body: response.body }
}

/** Read through the contract the client parses — a server that drifted from it fails here. */
async function search(actor: string, query: string): Promise<AdviceSearchResponse> {
  const reply = await ask(actor, query)
  expect(reply.status).toBe(200)
  return adviceSearchResponseSchema.parse(JSON.parse(reply.body))
}

const item = (name: string) => insertItem(db, { name, searchKey: toSearchKey(name) })

async function rate(actorId: string, itemId: string, score: number) {
  await db
    .insert(verdicts)
    .values({ id: randomUUID(), actorId, itemId, itemKind: 'product', score })
}

async function bought(actorId: string, itemId: string, placeId: string, amount: Money) {
  const tripId = await insertTrip(db, { actorId, placeId })
  await db.insert(expenses).values({
    id: randomUUID(),
    tripId,
    itemId,
    qtyMilli: kilo.milli,
    qtyUnit: kilo.unit,
    amountMinor: amount.minor,
    amountCurrency: amount.currency,
  })
}

async function grantAccess(actorId: string) {
  await db
    .update(actors)
    .set({ sharedUntil: sql`now() + interval '30 days'` })
    .where(eq(actors.id, actorId))
}

const answered = (answer: AdviceSearchResponse) =>
  answer.items.map((found) => [found.name, found.advice?.level ?? null])

describe('GET /advice/search', () => {
  it('транслит и опечатка дают один ответ: у оценённого — строка, у неоценённого — null', async () => {
    const me = await insertActor(db)
    const lori = await item('Сыр Лори')
    await item('Сыр косичка')
    await rate(me, lori, 5)

    const exact = await search(me, 'сыр')
    expect(answered(exact)).toEqual(
      expect.arrayContaining([
        ['Сыр Лори', 'take'],
        ['Сыр косичка', null],
      ]),
    )
    expect(answered(await search(me, 'syr'))).toEqual(answered(exact))
    expect(answered(await search(me, 'сыыр'))).toEqual(answered(exact))
  })

  it('оценённое за пределом списка — со своей оценкой, не «ещё не оценивали»', async () => {
    const me = await insertActor(db)
    // As many fives as the list carries, all ranked above the item looked for: the list cuts it,
    // the search must not. One insert each, or the setup outlives the test's time.
    const fives = Array.from({ length: ADVICE_LIMIT }, (_, n) => ({
      id: randomUUID(),
      kind: 'product' as const,
      name: `Товар ${String(n)}`,
      searchKey: toSearchKey(`Товар ${String(n)}`),
      defaultUnit: 'kg' as const,
    }))
    await db.insert(items).values(fives)
    await db.insert(verdicts).values(
      fives.map((five) => ({
        id: randomUUID(),
        actorId: me,
        itemId: five.id,
        itemKind: 'product' as const,
        score: 5,
      })),
    )
    const quince = await item('Айва')
    await rate(me, quince, 4)

    const list = await app.inject({
      method: 'GET',
      url: '/advice',
      headers: { cookie: await signIn(db, me) },
    })
    expect(list.body).not.toContain('Айва')
    expect(answered(await search(me, 'айва'))).toEqual([['Айва', 'take']])
  })

  it('«не брать нигде» уходит без цены, места и порога — полей нет и в JSON', async () => {
    const me = await insertActor(db)
    const chanakh = await item('Сыр Чанах')
    await rate(me, chanakh, 1)
    await bought(me, chanakh, await insertPlace(db), amd(2500))

    const reply = await ask(me, 'чанах')
    const [found] = (JSON.parse(reply.body) as { items: { advice: Record<string, unknown> }[] })
      .items

    expect(found?.advice.level).toBe('never')
    expect(Object.keys(found?.advice ?? {})).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/places|threshold/)]),
    )
  })

  it('у «брать» — цена, по тем же правилам, что у списка', async () => {
    const me = await insertActor(db)
    const bread = await item('Лаваш')
    await rate(me, bread, 5)
    await bought(me, bread, await insertPlace(db, { name: 'Ереван Сити' }), amd(250))

    const [found] = (await search(me, 'lavash')).items

    expect(found?.advice?.level === 'take' && found.advice.places.map((p) => p.name)).toEqual([
      'Ереван Сити',
    ])
    expect(found?.advice?.level === 'take' && found.advice.places[0]?.unitPrice.scaledMinor).toBe(
      unitPrice(amd(250), kilo).scaledMinor,
    )
  })

  it('в общем режиме чужой одиночный вердикт не виден: позиция — «ещё не оценивали»', async () => {
    const me = await insertActor(db)
    await grantAccess(me)
    const stranger = await insertActor(db)
    const cheese = await item('Сыр Лори')
    await rate(stranger, cheese, 1)

    const answer = await search(me, 'сыр')

    expect(answer.scope).toBe('shared')
    expect(answered(answer)).toEqual([['Сыр Лори', null]])
  })

  it('в общем режиме три человека — среднее, как у списка', async () => {
    const me = await insertActor(db)
    await grantAccess(me)
    const cheese = await item('Сыр Лори')
    for (const score of [5, 4, 4]) await rate(await insertActor(db), cheese, score)

    const [found] = (await search(me, 'сыр')).items

    expect(found?.advice).toMatchObject({ rating: '4.3', ratingsCount: 3, isMine: false })
  })

  it('без доступа чужие оценки не видны вовсе', async () => {
    const me = await insertActor(db)
    const cheese = await item('Сыр Лори')
    for (const score of [5, 4, 4]) await rate(await insertActor(db), cheese, score)

    expect(answered(await search(me, 'сыр'))).toEqual([['Сыр Лори', null]])
  })

  it('ничего не пишет: ни визита в журнал, ни выбора в память поиска', async () => {
    const me = await insertActor(db)
    await grantAccess(me)
    await rate(me, await item('Сыр Лори'), 5)

    await search(me, 'сыр')

    expect(await db.select().from(events)).toEqual([])
    expect(await db.select().from(searchPicks)).toEqual([])
  })

  it('ничего не нашли — пустой ответ и «далеко»', async () => {
    const me = await insertActor(db)
    await item('Молоко')

    expect(await search(me, 'кускус')).toMatchObject({ items: [], near: false })
  })

  it('не отдаёт позицию целиком: ни ключа, ни автора', async () => {
    const me = await insertActor(db)
    await insertItem(db, { name: 'Сыр', searchKey: toSearchKey('Сыр'), createdBy: me })

    const reply = await ask(me, 'сыр')

    expect(reply.body).not.toContain(me)
    expect(reply.body).not.toContain('searchKey')
    expect(reply.headers['cache-control']).toBe('no-store')
  })

  it('без сессии — 401, чужой параметр — отказ', async () => {
    expect((await ask(null, 'сыр')).status).toBe(401)

    const me = await insertActor(db)
    const reply = await app.inject({
      method: 'GET',
      url: `/advice/search?q=сыр&actorId=${me}`,
      headers: { cookie: await signIn(db, me) },
    })
    expect(reply.statusCode).toBe(400)
  })

  it('не отвечает на HEAD: поиск не выполняется ради заголовков', async () => {
    const me = await insertActor(db)
    const reply = await app.inject({
      method: 'HEAD',
      url: '/advice/search?q=сыр',
      headers: { cookie: await signIn(db, me) },
    })
    expect(reply.statusCode).toBe(404)
  })
})
