import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { EXPORT_FORMAT, EXPORT_VERSION, exportFileCodec } from '@molvia/model'
import { ACTOR_REFERENCES, ERASED_TABLES, createErasureRepository } from '@/db/erasure-repository'
import { EXPORT_COLUMNS, EXPORT_SECTION_OF, createExportRepository } from '@/db/export-repository'
import { events, expenses, itemBarcodes, loginRequests, sessions, spendings } from '@/db/schema'
import { connectDrizzle } from './db'
import {
  clearAll,
  insertActor,
  insertItem,
  insertPlace,
  insertSession,
  insertTrip,
  telegramId,
} from './fixtures'
import { aLife } from './life'

const { db, close } = connectDrizzle()
const repository = createExportRepository(db)
const erasure = createErasureRepository(db)

afterAll(close)
beforeEach(() => clearAll(db))

/** The file as the route sends it: read, dated and encoded — a row the codec refuses fails here. */
async function fileOf(actorId: string, currentSessionId: string = randomUUID()) {
  const content = await repository.exportOf(actorId, currentSessionId)
  if (content === null) throw new Error('no owner')
  const wire = z.encode(exportFileCodec, {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date(),
    ...content,
  })
  return { content, wire, text: JSON.stringify(wire) }
}

async function someone() {
  const tg = telegramId()
  const actorId = await insertActor(db, { telegramUserId: tg })
  return { tg, actorId }
}

describe('состав экспорта — один источник правды со стиранием (MOL-93)', () => {
  it('каждая таблица со ссылкой на actors выгружается', () => {
    const tables = new Set(
      ACTOR_REFERENCES.map((reference) => reference.split('.')[0] ?? reference),
    )
    expect([...tables].filter((table) => !(table in EXPORT_COLUMNS))).toEqual([])
    expect(ERASED_TABLES.filter((table) => !(table in EXPORT_COLUMNS))).toEqual([])
  })

  it('каждая колонка этих таблиц — в файле или в пропущенных с причиной', async () => {
    const rows = await db.execute<{ table_name: string; column_name: string }>(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'`)
    for (const [table, { exported, omitted = {} }] of Object.entries(EXPORT_COLUMNS)) {
      const actual = rows
        .filter((row) => row.table_name === table)
        .map((row) => row.column_name)
        .sort()
      const declared = [...exported, ...Object.keys(omitted)]
      expect({ table, columns: actual }).toEqual({ table, columns: [...declared].sort() })
      expect(new Set(declared).size).toBe(declared.length)
    }
  })

  it('строк в каждом разделе столько же, сколько насчитает сухой прогон стирания', async () => {
    const { tg, actorId } = await someone()
    await aLife(db, actorId, tg, { itemId: await insertItem(db), placeId: await insertPlace(db) })

    const { content } = await fileOf(actorId)
    const { erased } = await erasure.erase(tg, { dryRun: true })

    for (const table of ERASED_TABLES) {
      const section = content[EXPORT_SECTION_OF[table]]
      const exported = Array.isArray(section) ? section.length : 1
      expect({ table, rows: exported }).toEqual({ table, rows: erased[table] })
    }
    expect(content.exchanges.flatMap((exchange) => exchange.earlierVersions)).toHaveLength(1)
    expect(content.incomes.flatMap((income) => income.earlierVersions)).toHaveLength(1)
  })
})

describe('экспорт всего своего (MOL-93)', () => {
  it('чужая жизнь рядом не просачивается — ни id, ни Telegram id, ни тексты', async () => {
    const anna = await someone()
    const boris = await someone()
    const shared = { itemId: await insertItem(db), placeId: await insertPlace(db) }
    await aLife(db, anna.actorId, anna.tg, shared)
    const borisItem = await insertItem(db, {
      name: 'Борисов лаваш',
      searchKey: 'borisov lavash',
      createdBy: boris.actorId,
    })
    const borisPlace = await insertPlace(db, { name: 'Рынок Бориса' })
    await aLife(db, boris.actorId, boris.tg, { itemId: borisItem, placeId: borisPlace })
    await db
      .update(spendings)
      .set({ note: 'стрижка Бориса' })
      .where(eq(spendings.actorId, boris.actorId))

    const { text, content } = await fileOf(anna.actorId)

    expect(text).not.toContain(boris.actorId)
    expect(text).not.toMatch(new RegExp(`(^|[^0-9])${String(boris.tg)}([^0-9]|$)`))
    expect(text).not.toContain(borisItem)
    expect(text).not.toContain(borisPlace)
    expect(text).not.toContain('Бориса')
    expect(content.proposedItems.map((item) => item.name)).toEqual(['Рынок-сыр'])
    expect(text).toContain(anna.actorId)
  })

  it('удалённое и снятое — в файле, каждое со своей отметкой', async () => {
    const { tg, actorId } = await someone()
    await aLife(db, actorId, tg, { itemId: await insertItem(db), placeId: await insertPlace(db) })

    const { content } = await fileOf(actorId)

    expect(content.verdicts.filter((verdict) => verdict.withdrawnAt !== null)).toHaveLength(1)
    expect(content.exchanges.filter((exchange) => exchange.removedAt !== null)).toHaveLength(1)
    expect(content.incomes.filter((income) => income.removedAt !== null)).toHaveLength(1)
    expect(content.spendings.filter((spending) => spending.removedAt !== null)).toHaveLength(1)
  })

  it('прежняя версия обмена — внутри него, с тем, что было записано до правки', async () => {
    const { tg, actorId } = await someone()
    const { exchangeId } = await aLife(db, actorId, tg, {
      itemId: await insertItem(db),
      placeId: await insertPlace(db),
    })

    const { wire } = await fileOf(actorId)

    const exchange = wire.exchanges.find((row) => row.id === exchangeId)
    expect(exchange?.revision).toBe(2)
    expect(exchange?.given).toEqual({ amount: '10000.00', currency: 'RUB' })
    expect(exchange?.earlierVersions).toEqual([
      expect.objectContaining({
        revision: 1,
        received: { amount: '47000.00', currency: 'AMD' },
        exchangedOn: '2026-09-20',
      }),
    ])
  })

  it('ни одного секрета: ни хеша токена, ни кода и секрета запроса входа', async () => {
    const { tg, actorId } = await someone()
    await aLife(db, actorId, tg, { itemId: await insertItem(db), placeId: await insertPlace(db) })
    const [session] = await db.select().from(sessions).where(eq(sessions.actorId, actorId))
    const requests = await db
      .select()
      .from(loginRequests)
      .where(eq(loginRequests.telegramUserId, tg))

    const { text, content } = await fileOf(actorId, session?.id)

    expect(session).toBeDefined()
    expect(text).not.toContain(session?.tokenHash)
    for (const request of requests) {
      expect(text).not.toContain(request.code)
      expect(text).not.toContain(request.secretHash)
    }
    expect(content.loginRequests).toHaveLength(2)
    expect(content.sessions).toEqual([expect.objectContaining({ id: session?.id, current: true })])
  })

  it('весовое и штучное, трата не в валюте по умолчанию, курс похода — как на проводе', async () => {
    const { actorId } = await someone()
    const cheese = await insertItem(db, { name: 'Сыр чанах', searchKey: 'sir chanah' })
    const water = await insertItem(db, { name: 'Вода Бжни', defaultUnit: 'piece' })
    const tripId = await insertTrip(db, {
      actorId,
      placeId: await insertPlace(db, { name: 'Рынок' }),
      rateBase: 'RUB',
      rateQuote: 'AMD',
      rateScaled: 4_812_345n,
      rateSource: 'official',
      rateAsOf: new Date('2026-09-19T20:00:00Z'),
      rateProvider: 'cba',
    })
    await db.insert(expenses).values([
      {
        id: randomUUID(),
        tripId,
        itemId: cheese,
        qtyMilli: 350n,
        qtyUnit: 'kg',
        amountMinor: 126_000n,
        amountCurrency: 'AMD',
      },
      {
        id: randomUUID(),
        tripId,
        itemId: water,
        qtyMilli: 6000n,
        qtyUnit: 'piece',
        amountMinor: 1_500n,
        amountCurrency: 'USD',
      },
      // Only the item is required: a row with nothing else is still the person's.
      { id: randomUUID(), tripId, itemId: water },
    ])

    const { wire } = await fileOf(actorId)

    expect(wire.trips[0]?.rate).toEqual({
      base: 'RUB',
      quote: 'AMD',
      rate: '4.812345',
      source: 'official',
      asOf: '2026-09-19T20:00:00.000Z',
    })
    expect(wire.expenses.map(({ quantity, amount }) => ({ quantity, amount }))).toEqual([
      { quantity: { value: '0.350', unit: 'kg' }, amount: { amount: '1260.00', currency: 'AMD' } },
      { quantity: { value: '6.000', unit: 'piece' }, amount: { amount: '15.00', currency: 'USD' } },
      { quantity: null, amount: null },
    ])
    expect(wire.catalogue.items.map((item) => item.name)).toEqual(['Вода Бжни', 'Сыр чанах'])
    expect(wire.catalogue.places.map((place) => place.name)).toEqual(['Рынок'])
  })

  it('своя позиция — со штрихкодом и без, и справочник по ней не дублирует автора', async () => {
    const { actorId } = await someone()
    const coded = await insertItem(db, { name: 'Кола 0,5', createdBy: actorId })
    await insertItem(db, { name: 'Зелень пучок', createdBy: actorId })
    await db.insert(itemBarcodes).values({ code: '4870001234567', itemId: coded })

    const { wire, text } = await fileOf(actorId)

    expect(
      wire.proposedItems
        .map(({ name, barcodes }) => ({ name, barcodes }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ).toEqual([
      { name: 'Зелень пучок', barcodes: [] },
      { name: 'Кола 0,5', barcodes: ['4870001234567'] },
    ])
    expect(text).not.toContain('createdBy')
  })

  it('человек без единой строки — файл с пустыми разделами, а не ошибка', async () => {
    const { actorId } = await someone()

    const { content } = await fileOf(actorId)

    expect(content.account.id).toBe(actorId)
    expect(content.trips).toEqual([])
    expect(content.proposedItems).toEqual([])
    expect(content.catalogue).toEqual({ items: [], places: [] })
  })

  it('событие журнала — как записано, и чтение ничего в журнал не пишет', async () => {
    const { tg, actorId } = await someone()
    await aLife(db, actorId, tg, { itemId: await insertItem(db), placeId: await insertPlace(db) })

    const { wire } = await fileOf(actorId)
    await fileOf(actorId)

    expect(wire.events).toEqual([
      expect.objectContaining({ type: 'advice_viewed', payload: { subject: 'product' } }),
    ])
    expect(await db.select().from(events).where(eq(events.actorId, actorId))).toHaveLength(1)
  })

  it('нет такого владельца — нечего и выгружать', async () => {
    expect(await repository.exportOf(randomUUID(), randomUUID())).toBeNull()
  })

  it('сессия, которой пришёл запрос, помечена текущей, остальные — нет', async () => {
    const { actorId } = await someone()
    const current = await insertSession(db, { actorId, deviceName: 'iPhone' })
    await insertSession(db, { actorId, deviceName: 'Mac' })

    const { content } = await fileOf(actorId, current)

    expect(
      content.sessions.map(({ deviceName, current: isCurrent }) => [deviceName, isCurrent]),
    ).toEqual(
      expect.arrayContaining([
        ['iPhone', true],
        ['Mac', false],
      ]),
    )
  })
})
