/**
 * The hint of Open Food Facts (MOL-162) through the server, with a fake of the base: the door, the
 * query, the cache, the log; the cache's table and the mark of an item proposed with a code the base
 * named against the real schema — the CHECKs that keep a row whole, the age by the database's
 * calendar, the overwrite.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { ISSUE, catalogueBarcodeHintResponseSchema } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createOpenFoodFactsRepository } from '@/db/open-food-facts-repository'
import { items, openFoodFacts } from '@/db/schema'
import type { OpenFoodFacts } from '@/open-food-facts/client'
import type { OffAnswer } from '@/open-food-facts/product'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, signIn } from './fixtures'

const { db, close } = connectDrizzle()
const cache = createOpenFoodFactsRepository(db)

/** The base as the tests want it: the answer per code, and what it was asked. */
const base: { answers: Record<string, OffAnswer | null>; asked: string[] } = {
  answers: {},
  asked: [],
}
const fakeBase: OpenFoodFacts = {
  product: (code) => {
    base.asked.push(code)
    return Promise.resolve(code in base.answers ? (base.answers[code] ?? null) : { found: false })
  },
}

const lines: string[] = []
let app: FastifyInstance
let off: FastifyInstance

beforeAll(async () => {
  app = buildServer({
    db,
    openFoodFacts: fakeBase,
    logStream: { write: (line) => lines.push(line) },
  })
  off = buildServer({ db, openFoodFacts: null })
  await Promise.all([app.ready(), off.ready()])
})

const NUTELLA = '3017620422003'
const found = {
  found: true,
  product: { names: { ru: 'Nutella', en: 'Nutella' }, quantity: { milli: 400n, unit: 'kg' } },
} as const

beforeEach(async () => {
  await clearAll(db)
  base.answers = {}
  base.asked = []
  lines.length = 0
})

afterAll(async () => {
  await Promise.all([app.close(), off.close()])
  await clearAll(db)
  await close()
})

describe('кеш ответов Open Food Facts', () => {
  it('находка и промах читаются, как были записаны, возраст — ноль дней', async () => {
    await cache.put(NUTELLA, found)
    await cache.put('4850001270129', { found: false })

    expect(await cache.get(NUTELLA)).toEqual({ answer: found, ageDays: 0 })
    expect(await cache.get('4850001270129')).toEqual({ answer: { found: false }, ageDays: 0 })
    expect(await cache.get('4600000000003')).toBeNull()
  })

  it('находка без объёма — объём null', async () => {
    const noSize = { found: true, product: { names: { ru: 'Сыр', en: 'Cheese' }, quantity: null } }
    await cache.put(NUTELLA, noSize)
    expect((await cache.get(NUTELLA))?.answer).toEqual(noSize)
  })

  it('возраст — по календарю базы', async () => {
    await cache.put(NUTELLA, found)
    await db
      .update(openFoodFacts)
      .set({ fetchedOn: sql`current_date - 31` })
      .where(eq(openFoodFacts.code, NUTELLA))
    expect((await cache.get(NUTELLA))?.ageDays).toBe(31)
  })

  it('новый ответ перезаписывает старый и его день: промах, ставший находкой', async () => {
    await cache.put(NUTELLA, { found: false })
    await db
      .update(openFoodFacts)
      .set({ fetchedOn: sql`current_date - 8` })
      .where(eq(openFoodFacts.code, NUTELLA))

    await cache.put(NUTELLA, found)

    expect(await cache.get(NUTELLA)).toEqual({ answer: found, ageDays: 0 })
    expect(await db.select().from(openFoodFacts)).toHaveLength(1)
  })

  it('находка, ставшая промахом, теряет имена и объём', async () => {
    await cache.put(NUTELLA, found)
    await cache.put(NUTELLA, { found: false })
    const [row] = await db.select().from(openFoodFacts)
    expect(row).toMatchObject({ found: false, nameRu: null, nameEn: null, quantityMilli: null })
  })

  it('named: находка среди кодов — да; промах, незнакомый и пустой список — нет', async () => {
    await cache.put(NUTELLA, found)
    await cache.put('4850001270129', { found: false })

    expect(await cache.named(['4600000000003', NUTELLA])).toBe(true)
    expect(await cache.named(['4850001270129'])).toBe(false)
    expect(await cache.named(['4600000000003'])).toBe(false)
    expect(await cache.named([])).toBe(false)
  })

  it('named: старая находка тоже — что было показано, то показано', async () => {
    await cache.put(NUTELLA, found)
    await db.update(openFoodFacts).set({ fetchedOn: sql`current_date - 400` })
    expect(await cache.named([NUTELLA])).toBe(true)
  })
})

describe('база держит строку целой', () => {
  async function refused(values: Record<string, unknown>): Promise<string> {
    try {
      await db.insert(openFoodFacts).values({ code: NUTELLA, found: true, ...values })
    } catch (error) {
      return String((error as { cause?: { constraint_name?: string } }).cause?.constraint_name)
    }
    return 'accepted'
  }

  it.each([
    ['находка без имени', { nameRu: null, nameEn: 'x' }, 'open_food_facts_names_found'],
    ['находка с одним именем', { nameRu: 'x', nameEn: null }, 'open_food_facts_names_found'],
    ['промах с именем', { found: false, nameRu: 'x', nameEn: 'x' }, 'open_food_facts_names_found'],
    [
      'объём без единицы',
      { nameRu: 'x', nameEn: 'x', quantityMilli: 1n },
      'open_food_facts_quantity_paired',
    ],
    [
      'объём у промаха',
      { found: false, quantityMilli: 1n, quantityUnit: 'kg' },
      'open_food_facts_quantity_found',
    ],
    [
      'объём ноль',
      { nameRu: 'x', nameEn: 'x', quantityMilli: 0n, quantityUnit: 'kg' },
      'open_food_facts_quantity_positive',
    ],
    [
      'объём в штуках',
      { nameRu: 'x', nameEn: 'x', quantityMilli: 1000n, quantityUnit: 'piece' },
      'open_food_facts_quantity_unit',
    ],
    ['код не той формы', { code: '123', nameRu: 'x', nameEn: 'x' }, 'open_food_facts_gtin_shape'],
  ])('%s — отказ', async (_case, values, constraint) => {
    expect(await refused(values)).toBe(constraint)
  })
})

describe('пометка происхождения позиции', () => {
  it('ничего, кроме open_food_facts и null, база не примет', async () => {
    const base = {
      kind: 'product' as const,
      name: 'Nutella',
      searchKey: 'nutela',
      defaultUnit: 'kg' as const,
    }
    await db.insert(items).values({ id: crypto.randomUUID(), ...base, origin: 'open_food_facts' })
    await db.insert(items).values({ id: crypto.randomUUID(), ...base, origin: null })
    await expect(
      db.insert(items).values({ id: crypto.randomUUID(), ...base, origin: 'gs1' as never }),
    ).rejects.toMatchObject({ cause: { constraint_name: 'items_origin_known' } })
  })
})

describe('GET /catalogue/barcode/hint', () => {
  async function hint(query: string, server = app, signedIn = true) {
    const actor = await insertActor(db)
    const response = await server.inject({
      method: 'GET',
      url: `/catalogue/barcode/hint${query}`,
      headers: signedIn ? { cookie: await signIn(db, actor) } : {},
    })
    return { status: response.statusCode, body: JSON.parse(response.body) as unknown, response }
  }

  it('отвечает подсказкой на языке интерфейса, с объёмом и ссылкой, и запоминает ответ', async () => {
    base.answers[NUTELLA] = found

    const { status, body, response } = await hint(`?code=${NUTELLA}&lang=ru`)

    expect(status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(body).toEqual({
      hint: {
        name: 'Nutella',
        quantity: { value: '0.400', unit: 'kg' },
        url: `https://world.openfoodfacts.org/product/${NUTELLA}`,
      },
    })
    expect(catalogueBarcodeHintResponseSchema.safeParse(body).success).toBe(true)
    expect((await cache.get(NUTELLA))?.answer).toEqual(found)
  })

  it('второй раз — из кеша, база не спрошена', async () => {
    base.answers[NUTELLA] = found
    await hint(`?code=${NUTELLA}&lang=ru`)
    await hint(`?code=${NUTELLA}&lang=en`)
    expect(base.asked).toEqual([NUTELLA])
  })

  it('английскому интерфейсу — английское имя', async () => {
    base.answers[NUTELLA] = {
      found: true,
      product: { names: { ru: 'Нутелла', en: 'Nutella' }, quantity: null },
    }
    const { body } = await hint(`?code=${NUTELLA}&lang=en`)
    expect(body).toMatchObject({ hint: { name: 'Nutella', quantity: null } })
  })

  it('промах — hint: null, и он тоже запомнен', async () => {
    const { status, body } = await hint('?code=4850001270126&lang=ru')
    expect([status, body]).toEqual([200, { hint: null }])
    expect((await cache.get('4850001270126'))?.answer).toEqual({ found: false })
  })

  it('база не ответила — hint: null, ничего не запомнено', async () => {
    base.answers[NUTELLA] = null
    expect((await hint(`?code=${NUTELLA}&lang=ru`)).body).toEqual({ hint: null })
    expect(await cache.get(NUTELLA)).toBeNull()
  })

  it('этикетка магазина и код с неверной цифрой в базу не уходят', async () => {
    expect((await hint('?code=2000000000008&lang=ru')).body).toEqual({ hint: null })
    expect((await hint('?code=3017620422004&lang=ru')).body).toEqual({ hint: null })
    expect(base.asked).toEqual([])
  })

  it('двенадцать цифр спрошены тринадцатью, как пишется код', async () => {
    await hint('?code=012345678905&lang=ru')
    expect(base.asked).toEqual(['0012345678905'])
  })

  it('подсказка выключена — null, кеш не читается', async () => {
    await cache.put(NUTELLA, found)
    expect((await hint(`?code=${NUTELLA}&lang=ru`, off)).body).toEqual({ hint: null })
  })

  it('за дверью: без сессии — 401, база не спрошена', async () => {
    const { status } = await hint(`?code=${NUTELLA}&lang=ru`, app, false)
    expect(status).toBe(401)
    expect(base.asked).toEqual([])
  })

  it.each([
    ['без языка', `?code=${NUTELLA}`],
    ['чужой язык', `?code=${NUTELLA}&lang=hy`],
    ['без кода', '?lang=ru'],
    ['лишний параметр', `?code=${NUTELLA}&lang=ru&actorId=x`],
  ])('запрос не той формы — 400: %s', async (_case, query) => {
    const { status, body } = await hint(query)
    expect(status).toBe(400)
    expect(body).toMatchObject({ code: ISSUE.QUERY_INVALID })
  })

  it('в журнал — путь, без кода', async () => {
    await hint(`?code=${NUTELLA}&lang=ru`)
    const log = lines.join('')
    expect(log).toContain('/catalogue/barcode/hint')
    expect(log).not.toContain(NUTELLA)
  })

  it('без HEAD-двойника', async () => {
    const actor = await insertActor(db)
    const response = await app.inject({
      method: 'HEAD',
      url: `/catalogue/barcode/hint?code=${NUTELLA}&lang=ru`,
      headers: { cookie: await signIn(db, actor) },
    })
    expect(response.statusCode).toBe(404)
    expect(base.asked).toEqual([])
  })
})

describe('«Предложить товар» после подсказки (В-2)', () => {
  async function propose(barcodes: string[]) {
    const actor = await insertActor(db)
    const response = await app.inject({
      method: 'POST',
      url: '/catalogue/items',
      headers: { cookie: await signIn(db, actor) },
      payload: { kind: 'product', name: 'Нутелла', defaultUnit: 'kg', barcodes },
    })
    const [row] = await db.select().from(items)
    return { status: response.statusCode, origin: row?.origin }
  }

  it('код, который назвала база, — позиция помечена', async () => {
    await cache.put(NUTELLA, found)
    expect(await propose([NUTELLA])).toEqual({ status: 201, origin: 'open_food_facts' })
  })

  it('код, который база не знает, — без пометки', async () => {
    await cache.put(NUTELLA, { found: false })
    expect(await propose([NUTELLA])).toEqual({ status: 201, origin: null })
  })

  it('без кода — без пометки', async () => {
    expect(await propose([])).toEqual({ status: 201, origin: null })
  })
})
