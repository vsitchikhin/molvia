import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  ERROR,
  ITEMS_PROPOSED_DAY_MAX,
  TODAY_HEADER,
  toSearchKey,
  yerevanDate,
} from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { actors, itemBarcodes, items, receiptLines, receiptParts, receipts } from '@/db/schema'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, signIn } from './fixtures'
import { onlyRow } from './rows'

// MOL-362 — «Предложить товар» grows the catalogue everybody searches, so a person puts at most
// `ITEMS_PROPOSED_DAY_MAX` new items into it on a day of their own. The count is set by SQL where a test
// stands at the edge: sixty proposals over HTTP would be time spent on nothing the edge does not show.

const { db, close } = connectDrizzle()
let app: FastifyInstance

/**
 * The phone's day, taken once for the file and sent with every proposal: counted by the server's clock, a
 * midnight between two requests would start the count over under the test (review 1, №4). The hook takes it
 * while it is today somewhere, a day past the Yerevan midnight at least.
 */
const TODAY = yerevanDate(new Date())

beforeAll(async () => {
  app = buildServer({ db, receiptReader: null })
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

interface Owner {
  readonly id: string
  readonly cookie: string
}

async function owner(): Promise<Owner> {
  const id = await insertActor(db)
  return { id, cookie: await signIn(db, id) }
}

const cheese = (name: string, barcodes: readonly string[] = []) => ({
  kind: 'product',
  name,
  defaultUnit: 'kg',
  barcodes,
})

function propose(me: Owner, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/catalogue/items',
    headers: { cookie: me.cookie, [TODAY_HEADER]: TODAY },
    payload,
  })
}

/** The count where it stands: the day it is of, how many, and whether the row moved. */
async function count(me: Owner) {
  const read = db
    .select({ day: actors.itemsDay, proposed: actors.itemsProposed, updatedAt: actors.updatedAt })
    .from(actors)
    .where(eq(actors.id, me.id))
  const row = onlyRow(await read)
  if (row === undefined) throw new Error('no actor')
  return row
}

/** Today's count put at `proposed`, on the phone's day every proposal of the file names. */
async function spent(me: Owner, proposed: number): Promise<void> {
  await db
    .update(actors)
    .set({ itemsDay: TODAY, itemsProposed: proposed })
    .where(eq(actors.id, me.id))
}

async function named(name: string) {
  return db.select({ id: items.id }).from(items).where(eq(items.name, name))
}

describe('the items of a day (MOL-362)', () => {
  it('takes the sixtieth and refuses the sixty-first, writing nothing', async () => {
    const me = await owner()
    await spent(me, ITEMS_PROPOSED_DAY_MAX - 1)

    expect((await propose(me, cheese('Сыр Тушети'))).statusCode).toBe(201)
    expect((await count(me)).proposed).toBe(ITEMS_PROPOSED_DAY_MAX)

    const refused = await propose(me, cheese('Сыр Чечил', ['4850000000007']))
    expect(refused.statusCode).toBe(429)
    expect(refused.json()).toMatchObject({ code: ERROR.ITEMS_DAY_LIMITED })
    expect(await named('Сыр Чечил')).toHaveLength(0)
    expect(
      await db.select().from(itemBarcodes).where(eq(itemBarcodes.code, '4850000000007')),
    ).toHaveLength(0)
    expect((await count(me)).proposed).toBe(ITEMS_PROPOSED_DAY_MAX)
  })

  it('counts each new item once, and is no change of the person’s row', async () => {
    const me = await owner()
    const before = (await count(me)).updatedAt

    expect((await propose(me, cheese('Сыр Лори'))).statusCode).toBe(201)
    expect((await propose(me, cheese('Сыр Чанах'))).statusCode).toBe(201)

    expect(await count(me)).toMatchObject({ proposed: 2, updatedAt: before })
  })

  it('answers a name already there past the quota, its trace’s too, and counts neither', async () => {
    const me = await owner()
    const there = await insertItem(db, { name: 'Сыр Лори', searchKey: toSearchKey('Сыр Лори') })
    await insertItem(db, {
      name: 'Сыр Лорри',
      searchKey: toSearchKey('Сыр Лорри'),
      mergedInto: there,
    })
    await spent(me, ITEMS_PROPOSED_DAY_MAX)

    for (const name of ['сыр  лори', 'Сыр Лорри']) {
      const answer = await propose(me, cheese(name))
      expect(answer.statusCode).toBe(200)
      expect(answer.json()).toMatchObject({ id: there })
    }
    expect((await count(me)).proposed).toBe(ITEMS_PROPOSED_DAY_MAX)
  })

  it('names the item holding the code past the quota, and counts nothing', async () => {
    const me = await owner()
    const holder = await insertItem(db, { name: 'Сыр Лори', searchKey: toSearchKey('Сыр Лори') })
    await db.insert(itemBarcodes).values({ code: '4850000000007', itemId: holder })
    await spent(me, ITEMS_PROPOSED_DAY_MAX)

    const answer = await propose(me, cheese('Сыр Чечил', ['4850000000007']))
    expect(answer.statusCode).toBe(409)
    expect(answer.json()).toMatchObject({ taken: { id: holder } })
    expect((await count(me)).proposed).toBe(ITEMS_PROPOSED_DAY_MAX)
  })

  it('starts a new day over, and counts a day the phone names before the one begun in it', async () => {
    const me = await owner()
    await db
      .update(actors)
      .set({ itemsDay: '2000-01-01', itemsProposed: ITEMS_PROPOSED_DAY_MAX })
      .where(eq(actors.id, me.id))
    expect((await propose(me, cheese('Сыр Тушети'))).statusCode).toBe(201)
    expect(await count(me)).toMatchObject({ day: TODAY, proposed: 1 })

    // a header made up, or a flight west: the day only moves on
    await db
      .update(actors)
      .set({ itemsDay: '2999-12-31', itemsProposed: ITEMS_PROPOSED_DAY_MAX })
      .where(eq(actors.id, me.id))
    const answer = await propose(me, cheese('Сыр Чечил'))
    expect(answer.statusCode).toBe(429)
    expect(await count(me)).toMatchObject({ day: '2999-12-31', proposed: ITEMS_PROPOSED_DAY_MAX })
  })

  it('lets one of two proposals at once through at the last place', async () => {
    const me = await owner()
    await spent(me, ITEMS_PROPOSED_DAY_MAX - 1)

    const answers = await Promise.all([
      propose(me, cheese('Сыр Тушети')),
      propose(me, cheese('Сыр Чечил')),
    ])

    expect(answers.map((answer) => answer.statusCode).sort()).toEqual([201, 429])
    expect((await count(me)).proposed).toBe(ITEMS_PROPOSED_DAY_MAX)
  })
})

describe('what the quota does not count (MOL-362)', () => {
  it('lets «Записать» of a receipt make new items past it, and leaves the count as it was', async () => {
    const me = await owner()
    await spent(me, ITEMS_PROPOSED_DAY_MAX)
    const receiptId = randomUUID()
    await db.insert(receipts).values({
      id: receiptId,
      actorId: me.id,
      status: 'parsed',
      parts: 1,
      country: 'AM',
      language: 'ru',
      currency: 'AMD',
      capturedAt: new Date('2026-09-26T16:00:00Z'),
      queuedAt: new Date('2026-09-26T16:00:01Z'),
      printedOn: '2026-09-26',
      totalMinor: 145_000n,
      city: 'Гюмри',
      layout: 'card',
    })
    await db.insert(receiptParts).values({
      receiptId,
      position: 1,
      photo: Buffer.from([0xff, 0xd8]),
      width: 800,
      height: 2400,
    })
    await db.insert(receiptLines).values({
      receiptId,
      position: 0,
      printed: 'ՊԱՆԻՐ ԼՈՌԻ ԱՊԽ.',
      qtyMilli: 1000n,
      qtyUnit: 'piece',
      priceMinor: 145_000n,
      sumMinor: 145_000n,
      discountMinor: 0n,
      settled: true,
      match: 'new',
    })

    const recorded = await app.inject({
      method: 'POST',
      url: `/receipts/${receiptId}/record`,
      headers: { cookie: me.cookie },
      payload: {
        tripId: randomUUID(),
        place: { name: 'Ереван Сити', city: 'Гюмри' },
        purchasedOn: '2026-09-26',
        lines: [
          {
            position: 0,
            skip: false,
            item: { name: 'Сыр Лори копчёный' },
            quantity: { value: '1', unit: 'piece' },
            amount: { amount: '1450', currency: 'AMD' },
          },
        ],
        added: [
          {
            item: { name: 'Пакет фасовочный' },
            quantity: null,
            amount: null,
          },
        ],
      },
    })

    expect(recorded.statusCode).toBe(200)
    expect(await named('Сыр Лори копчёный')).toHaveLength(1)
    expect(await named('Пакет фасовочный')).toHaveLength(1)
    expect((await count(me)).proposed).toBe(ITEMS_PROPOSED_DAY_MAX)
  })
})
