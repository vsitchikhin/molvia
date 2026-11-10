import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  ERROR,
  RECEIPT_ITEMS_DAY_MAX,
  TODAY_HEADER,
  receiptRecordBodySchema,
  toSearchKey,
  yerevanDate,
} from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import type { Sql } from 'postgres'
import { createActorRepository } from '@/db/actors-repository'
import { createErasureRepository } from '@/db/erasure-repository'
import { lockItemKey } from '@/db/items-repository'
import { actors, items, receiptLines, receiptParts, receipts, trips } from '@/db/schema'
import { transactOn } from '@/db/unit-of-work'
import { buildServer } from '@/server'
import { recordReceipt } from '@/usecases/record-receipt'
import { connect, connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, signIn } from './fixtures'
import { onlyRow } from './rows'

// MOL-373 — «Записать» of a receipt takes any name over every line, so the new items it puts into the
// catalogue everybody searches count in `RECEIPT_ITEMS_DAY_MAX` of the person's day, a count of their own.
// The count is set by SQL where a test stands at the edge, as for the proposals (MOL-362).

const { db, close } = connectDrizzle()
let app: FastifyInstance

/** The phone's day, taken once for the file: a midnight between two requests would start the count over. */
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

/** A parsed receipt of `count` lines of 1 000 ֏ each, every one with no item of the catalogue. */
async function parsedReceipt(actorId: string, count: number): Promise<string> {
  const id = randomUUID()
  await db.insert(receipts).values({
    id,
    actorId,
    status: 'parsed',
    parts: 1,
    country: 'AM',
    language: 'ru',
    currency: 'AMD',
    capturedAt: new Date('2026-09-26T16:00:00Z'),
    queuedAt: new Date('2026-09-26T16:00:01Z'),
    printedOn: '2026-09-26',
    totalMinor: BigInt(count) * 100_000n,
    city: 'Гюмри',
    layout: 'card',
  })
  await db.insert(receiptParts).values({
    receiptId: id,
    position: 1,
    photo: Buffer.from([0xff, 0xd8]),
    width: 800,
    height: 2400,
  })
  await db.insert(receiptLines).values(
    Array.from({ length: count }, (_, position) => ({
      receiptId: id,
      position,
      printed: `ԱՊՐԱՆՔ ${String(position + 1)}`,
      qtyMilli: 1000n,
      qtyUnit: 'piece' as const,
      priceMinor: 100_000n,
      sumMinor: 100_000n,
      discountMinor: 0n,
      settled: true,
      match: 'new' as const,
    })),
  )
  return id
}

type Pick = { readonly name: string } | { readonly id: string }

/** «Записать» as the phone sends it: a line of the receipt for each item, in their order. */
function bodyOf(lines: readonly Pick[], added: readonly Pick[] = [], tripId = randomUUID()) {
  return {
    tripId,
    place: { name: 'Ереван Сити', city: 'Гюмри' },
    purchasedOn: '2026-09-26',
    lines: lines.map((item, position) => ({
      position,
      skip: false,
      item,
      quantity: { value: '1', unit: 'piece' },
      amount: { amount: '1000', currency: 'AMD' },
    })),
    ...(added.length > 0
      ? { added: added.map((item) => ({ item, quantity: null, amount: null })) }
      : {}),
  }
}

function record(me: Owner, receiptId: string, payload: ReturnType<typeof bodyOf>) {
  return app.inject({
    method: 'POST',
    url: `/receipts/${receiptId}/record`,
    headers: { cookie: me.cookie, [TODAY_HEADER]: TODAY },
    payload,
  })
}

/** The count where it stands: the day it is of, how many, and whether the row moved. */
async function count(me: Owner) {
  const read = db
    .select({
      day: actors.receiptItemsDay,
      n: actors.receiptItemsNew,
      proposed: actors.itemsProposed,
      updatedAt: actors.updatedAt,
    })
    .from(actors)
    .where(eq(actors.id, me.id))
  const row = onlyRow(await read)
  if (row === undefined) throw new Error('no actor')
  return row
}

/** Today's count put at `n`, on the phone's day every record of the file names. */
async function spent(me: Owner, n: number): Promise<void> {
  await db
    .update(actors)
    .set({ receiptItemsDay: TODAY, receiptItemsNew: n })
    .where(eq(actors.id, me.id))
}

async function named(name: string) {
  return db.select({ id: items.id }).from(items).where(eq(items.name, name))
}

async function statusOf(receiptId: string) {
  const read = db
    .select({ status: receipts.status })
    .from(receipts)
    .where(eq(receipts.id, receiptId))
  return onlyRow(await read)?.status
}

describe('the new items of a day’s records (MOL-373)', () => {
  it('takes the day’s last new items and refuses one past them, writing nothing of the record', async () => {
    const me = await owner()
    await spent(me, RECEIPT_ITEMS_DAY_MAX - 2)

    const first = await parsedReceipt(me.id, 2)
    const taken = await record(me, first, bodyOf([{ name: 'Сыр Тушети' }, { name: 'Сыр Чечил' }]))
    expect(taken.statusCode).toBe(200)
    expect((await count(me)).n).toBe(RECEIPT_ITEMS_DAY_MAX)

    const lori = await insertItem(db, { name: 'Сыр Лори', searchKey: toSearchKey('Сыр Лори') })
    const second = await parsedReceipt(me.id, 2)
    const tripId = randomUUID()
    const refused = await record(
      me,
      second,
      bodyOf([{ id: lori }, { name: 'Сыр Чанах' }], [], tripId),
    )
    expect(refused.statusCode).toBe(429)
    expect(refused.json()).toMatchObject({ code: ERROR.ITEMS_DAY_LIMITED })
    expect(await named('Сыр Чанах')).toHaveLength(0)
    expect(await db.select({ id: trips.id }).from(trips).where(eq(trips.id, tripId))).toHaveLength(
      0,
    )
    expect(await statusOf(second)).toBe('parsed')
    expect((await count(me)).n).toBe(RECEIPT_ITEMS_DAY_MAX)

    // the line put right with an item of the catalogue, as the review offers it, is recorded
    const again = await record(me, second, bodyOf([{ id: lori }, { id: lori }], [], tripId))
    expect(again.statusCode).toBe(200)
    expect(await statusOf(second)).toBe('recorded')
  })

  it('refuses a record past its day before any of its names is locked, and takes one of names there (adversarial А2)', async () => {
    const me = await owner()
    await spent(me, RECEIPT_ITEMS_DAY_MAX)
    await insertItem(db, { name: 'Сыр Брынза', searchKey: toSearchKey('Сыр Брынза') })
    const receiptId = await parsedReceipt(me.id, 2)

    // the name already there locked elsewhere — «Предложить товар» of another person on that very name. Its key,
    // `sir brinza`, comes before the new one's, `sir chanah`, and names are made in the order of their keys: a
    // record that met its day only at its new name would wait here, and the test would run out of time
    const holder = connectDrizzle()
    let letGo: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (letGo = resolve))
    let locked: () => void = () => undefined
    const lockTaken = new Promise<void>((resolve) => (locked = resolve))
    const holding = holder.db.transaction(async (tx) => {
      await lockItemKey(tx, 'product', toSearchKey('Сыр Брынза'))
      locked()
      await gate
    })
    try {
      await lockTaken
      const refused = await record(
        me,
        receiptId,
        bodyOf([{ name: 'Сыр Брынза' }, { name: 'Сыр Чанах' }]),
      )
      expect(refused.statusCode).toBe(429)
      expect(refused.json()).toMatchObject({ code: ERROR.ITEMS_DAY_LIMITED })
    } finally {
      letGo()
      await holding
      await holder.close()
    }

    // names already there are no new items: the full day takes them
    const taken = await record(
      me,
      receiptId,
      bodyOf([{ name: 'Сыр Брынза' }, { name: 'сыр  брынза' }]),
    )
    expect(taken.statusCode).toBe(200)
    expect(await named('Сыр Чанах')).toHaveLength(0)
    expect((await count(me)).n).toBe(RECEIPT_ITEMS_DAY_MAX)
  }, 30_000)

  it('counts a name typed on a line added as any other new item', async () => {
    const me = await owner()
    await spent(me, RECEIPT_ITEMS_DAY_MAX - 1)
    const receiptId = await parsedReceipt(me.id, 1)

    const refused = await record(
      me,
      receiptId,
      bodyOf([{ name: 'Сыр Тушети' }], [{ name: 'Пакет фасовочный' }]),
    )

    expect(refused.statusCode).toBe(429)
    expect(await named('Сыр Тушети')).toHaveLength(0)
    expect(await named('Пакет фасовочный')).toHaveLength(0)
  })

  it('counts no item chosen, no name already there nor its trace’s, and one name of two lines once', async () => {
    const me = await owner()
    const lori = await insertItem(db, { name: 'Сыр Лори', searchKey: toSearchKey('Сыр Лори') })
    await insertItem(db, {
      name: 'Сыр Лорри',
      searchKey: toSearchKey('Сыр Лорри'),
      mergedInto: lori,
    })
    const before = (await count(me)).updatedAt
    const receiptId = await parsedReceipt(me.id, 4)

    const recorded = await record(
      me,
      receiptId,
      bodyOf(
        [{ id: lori }, { name: 'сыр  лори' }, { name: 'Сыр Лорри' }, { name: 'Пакет фасовочный' }],
        [{ name: 'пакет фасовочный' }],
      ),
    )

    expect(recorded.statusCode).toBe(200)
    expect(await named('Пакет фасовочный')).toHaveLength(1)
    expect(await count(me)).toMatchObject({ day: TODAY, n: 1, updatedAt: before })
  })

  it('answers a record sent again with its trip whatever the count', async () => {
    const me = await owner()
    await spent(me, RECEIPT_ITEMS_DAY_MAX - 1)
    const receiptId = await parsedReceipt(me.id, 1)
    const payload = bodyOf([{ name: 'Сыр Тушети' }])

    const first = await record(me, receiptId, payload)
    const again = await record(me, receiptId, payload)

    expect(first.statusCode).toBe(200)
    expect(again.statusCode).toBe(200)
    expect(again.json()).toMatchObject({ tripId: payload.tripId })
    expect((await count(me)).n).toBe(RECEIPT_ITEMS_DAY_MAX)
  })

  it('starts a new day over, and counts a day the phone names before the one begun in it', async () => {
    const me = await owner()
    await db
      .update(actors)
      .set({ receiptItemsDay: '2000-01-01', receiptItemsNew: RECEIPT_ITEMS_DAY_MAX })
      .where(eq(actors.id, me.id))
    const today = await parsedReceipt(me.id, 1)
    expect((await record(me, today, bodyOf([{ name: 'Сыр Тушети' }]))).statusCode).toBe(200)
    expect(await count(me)).toMatchObject({ day: TODAY, n: 1 })

    // a header made up, or a flight west: the day only moves on
    await db
      .update(actors)
      .set({ receiptItemsDay: '2999-12-31', receiptItemsNew: RECEIPT_ITEMS_DAY_MAX })
      .where(eq(actors.id, me.id))
    const later = await parsedReceipt(me.id, 1)
    expect((await record(me, later, bodyOf([{ name: 'Сыр Чечил' }]))).statusCode).toBe(429)
    expect(await count(me)).toMatchObject({ day: '2999-12-31', n: RECEIPT_ITEMS_DAY_MAX })
  })

  it('keeps its count apart from «Предложить товар»: a full one lets the other through', async () => {
    const me = await owner()
    await spent(me, RECEIPT_ITEMS_DAY_MAX)

    const proposed = await app.inject({
      method: 'POST',
      url: '/catalogue/items',
      headers: { cookie: me.cookie, [TODAY_HEADER]: TODAY },
      payload: { kind: 'product', name: 'Сыр Тушети', defaultUnit: 'kg', barcodes: [] },
    })

    expect(proposed.statusCode).toBe(201)
    expect(await count(me)).toMatchObject({ n: RECEIPT_ITEMS_DAY_MAX, proposed: 1 })
  })
})

/** Until `n` statements of this database wait on a lock: a step of a race seen, never a time. */
async function waitingOn(watcher: Sql, n: number): Promise<void> {
  for (;;) {
    const row = onlyRow(
      await watcher<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
    )
    if ((row?.n ?? 0) >= n) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

describe('the account locked first (MOL-373)', () => {
  it('a record while its person is erased waits for the account, and finds nobody — no deadlock', async () => {
    const me = await owner()
    const read = db.select({ tg: actors.telegramUserId }).from(actors).where(eq(actors.id, me.id))
    const tg = onlyRow(await read)?.tg
    if (tg === undefined) throw new Error('no actor')
    const actor = await createActorRepository(db).byId(me.id)
    if (actor === null) throw new Error('no actor')
    const receiptId = await parsedReceipt(me.id, 1)
    const body = receiptRecordBodySchema.parse(bodyOf([{ name: 'Сыр Тушети' }]))

    const blocker = connect()
    const eraser = connectDrizzle()
    const recorder = connectDrizzle()
    const watcher = connect()
    try {
      // erasure held between the account's lock and its rows: a session of the person locked elsewhere
      let letGo: () => void = () => undefined
      const gate = new Promise<void>((resolve) => (letGo = resolve))
      let locked: () => void = () => undefined
      const lockTaken = new Promise<void>((resolve) => (locked = resolve))
      const holding = blocker.begin(async (tx) => {
        await tx`select 1 from sessions where actor_id = ${me.id} for update`
        locked()
        await gate
      })
      await lockTaken

      const erasing = createErasureRepository(eraser.db).erase(tg, { dryRun: false })
      erasing.catch(() => undefined) // judged below, by allSettled
      await waitingOn(watcher, 1) // erasure holds the account and waits at `sessions`
      const recording = recordReceipt(
        transactOn(recorder.db),
        { ...actor, today: TODAY },
        receiptId,
        body,
      )
      recording.catch(() => undefined) // judged below, by allSettled
      await waitingOn(watcher, 2) // the record waits for the account before the receipt's row

      letGo()
      await holding
      const [erased, recorded] = await Promise.allSettled([erasing, recording])
      expect(erased.status).toBe('fulfilled')
      expect(recorded).toMatchObject({ status: 'rejected', reason: { code: ERROR.NO_ACTOR } })
    } finally {
      await blocker.end()
      await eraser.close()
      await recorder.close()
      await watcher.end()
    }
  }, 30_000)
})
