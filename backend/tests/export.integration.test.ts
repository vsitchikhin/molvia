import { randomUUID } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { EXPORT_FORMAT, EXPORT_VERSION, exportFileCodec } from '@molvia/model'
import { ACTOR_REFERENCES, ERASED_TABLES, createErasureRepository } from '@/db/erasure-repository'
import { EXPORT_COLUMNS, EXPORT_SECTION_OF, createExportRepository } from '@/db/export-repository'
import {
  actors,
  events,
  exchangeRevisions,
  exchanges,
  expenses,
  incomeRevisions,
  incomes,
  itemBarcodes,
  loginRequests,
  moneyAccountChecks,
  moneyAccounts,
  moneyMonthRates,
  searchPicks,
  sessions,
  spendingCategories,
  spendings,
  trips,
  verdicts,
} from '@/db/schema'
import { connectDrizzle } from './db'
import {
  clearAll,
  insertActor,
  insertItem,
  insertLoginRequest,
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

/** Keys whose value is empty in every row: a column mapped to the wrong field reads as one. */
function emptyEverywhere(rows: readonly unknown[], prefix = ''): string[] {
  const keys = new Set(rows.flatMap((row) => Object.keys(row as object)))
  return [...keys].flatMap((key) => {
    const values = rows.map((row) => (row as Record<string, unknown>)[key])
    const present = values.filter((value) => value !== null && value !== undefined)
    if (present.length === 0) return [`${prefix}${key}`]
    const nested = present.filter(
      (value): value is object => typeof value === 'object' && !Array.isArray(value),
    )
    return nested.length === present.length ? emptyEverywhere(nested, `${prefix}${key}.`) : []
  })
}

/** A person with every column the file names filled in some row of theirs. */
async function aFullLife(actorId: string, telegramUserId: number) {
  const at = (minute: number) => new Date(Date.UTC(2026, 8, 20, 10, minute))
  await db
    .update(actors)
    .set({ incomeCurrencySince: at(0), salaryShiftDay: 25, sharedUntil: at(1) })
    .where(eq(actors.id, actorId))
  await insertSession(db, { actorId, deviceName: 'iPhone · Safari' })
  await insertLoginRequest(db, { telegramUserId, deviceName: 'Mac', consumedAt: new Date() })
  const placeId = await insertPlace(db, { name: 'Ереван Сити' })
  const itemId = await insertItem(db, {
    name: 'Сыр чанах',
    searchKey: 'sir chanah',
    note: 'в рассоле',
    defaultUnit: 'kg',
    typicalQtyMilli: 500n,
    typicalQtyUnit: 'kg',
    createdBy: actorId,
  })
  await db.insert(itemBarcodes).values({ code: '4850001234567', itemId })
  const cash = randomUUID()
  const dollars = randomUUID()
  const card = randomUUID()
  await db.insert(moneyAccounts).values([
    {
      id: cash,
      actorId,
      name: 'Наличные',
      currency: 'AMD',
      startMinor: 1_000_000n,
      startOn: '2026-09-01',
      savings: true,
      archivedAt: at(2),
    },
    {
      id: dollars,
      actorId,
      name: 'Доллары',
      currency: 'USD',
      startMinor: 10_000n,
      startOn: '2026-09-01',
      deletedAt: at(3),
    },
    { id: card, actorId, name: 'Карта ₽', currency: 'RUB', startMinor: 0n, startOn: '2026-09-01' },
  ])
  await db.insert(moneyAccountChecks).values({
    id: randomUUID(),
    actorId,
    accountId: cash,
    checkedOn: '2026-09-10',
    factMinor: 900_000n,
    countedMinor: 950_000n,
  })
  const tripId = await insertTrip(db, {
    actorId,
    placeId,
    rateBase: 'RUB',
    rateQuote: 'AMD',
    rateScaled: 4_812_345n,
    rateSource: 'official',
    rateAsOf: at(4),
    rateProvider: 'cba',
    rateJumped: true,
    ratePreviousScaled: 4_700_000n,
    ratePreviousAsOf: at(5),
    rateManualScaled: 4_900_000n,
    rateManualAsOf: at(6),
    rateChoice: 'manual',
    startedAt: at(3),
    finishedAt: at(8),
    finishedOnDeviceAt: at(7),
    accountId: cash,
    debitedMinor: 52_000n,
    debitedCurrency: 'AMD',
    accountSetAt: at(9),
    deletedAt: at(10),
  })
  await db.insert(expenses).values({
    id: randomUUID(),
    tripId,
    itemId,
    qtyMilli: 350n,
    qtyUnit: 'kg',
    amountMinor: 52_000n,
    amountCurrency: 'AMD',
  })
  const dish = await insertItem(db, { kind: 'dish', name: 'Хоровац', searchKey: 'horovac' })
  const venue = await insertPlace(db, { kind: 'venue', name: 'Кафе у рынка' })
  await db.insert(verdicts).values([
    { id: randomUUID(), actorId, itemId, itemKind: 'product', score: 4, review: 'Солёный' },
    {
      id: randomUUID(),
      actorId,
      itemId: dish,
      itemKind: 'dish',
      placeId: venue,
      score: 2,
      ratedAt: at(0),
      updatedAt: at(0),
      deletedAt: at(1),
    },
  ])
  await db.insert(searchPicks).values({ actorId, queryKey: 'sir', itemId, admits: true })
  await db
    .insert(events)
    .values({ actorId, type: 'advice_viewed', payload: { subject: 'product' } })
  const exchangeId = randomUUID()
  const exchange = {
    givenMinor: 1_000_000n,
    givenCurrency: 'RUB',
    receivedMinor: 4_700_000n,
    receivedCurrency: 'AMD',
    exchangedOn: '2026-09-20',
    heldBeforeMinor: 100_000n,
    note: 'Абовяна',
  } as const
  await db.insert(exchanges).values({
    id: exchangeId,
    actorId,
    ...exchange,
    givenAccountId: card,
    receivedAccountId: cash,
    accountSetAt: at(11),
    revision: 2,
    amendedAt: at(12),
    deletedAt: at(13),
  })
  await db.insert(exchangeRevisions).values({ exchangeId, revision: 1, ...exchange })
  const incomeId = randomUUID()
  const income = {
    amountMinor: 9_961_500n,
    currency: 'RUB',
    receivedOn: '2026-09-15',
    heldBeforeMinor: 5_000n,
    source: 'salary',
    note: 'аванс',
  } as const
  await db.insert(incomes).values({
    id: incomeId,
    actorId,
    ...income,
    accountId: card,
    accountSetAt: at(22),
    revision: 2,
    amendedAt: at(14),
    deletedAt: at(15),
  })
  await db.insert(incomeRevisions).values({ incomeId, revision: 1, ...income })
  const own = randomUUID()
  await db.insert(spendingCategories).values([
    { id: own, actorId, name: 'Такси', colour: 3, archivedAt: at(16) },
    { id: randomUUID(), actorId, preset: 'groceries' },
  ])
  await db.insert(spendings).values({
    id: randomUUID(),
    actorId,
    spentOn: '2026-09-20',
    amountMinor: 50_000n,
    currency: 'RUB',
    categoryId: own,
    note: 'барбер',
    place: 'Гюмри',
    rateBase: 'RUB',
    rateQuote: 'AMD',
    rateScaled: 4_812_345n,
    rateSource: 'official',
    rateAsOf: at(17),
    accountId: cash,
    debitedMinor: 240_000n,
    debitedCurrency: 'AMD',
    accountSetAt: at(18),
    revision: 2,
    amendedAt: at(19),
    deletedAt: at(20),
  })
  await db.insert(moneyMonthRates).values({
    actorId,
    month: '2026-08',
    base: 'RUB',
    quote: 'AMD',
    scaled: 4_100_000n,
    source: 'personal',
    asOf: at(21),
  })
}

describe('состав экспорта — один источник правды со стиранием (MOL-93)', () => {
  it('каждая таблица со ссылкой на actors выгружается', () => {
    const tables = new Set(
      ACTOR_REFERENCES.map((reference) => reference.split('.')[0] ?? reference),
    )
    expect([...tables].filter((table) => !(table in EXPORT_COLUMNS))).toEqual([])
    expect(ERASED_TABLES.filter((table) => !(table in EXPORT_COLUMNS))).toEqual([])
  })

  it('и каждая таблица, что ведёт к actors через другую, — тоже (ревизии, покупки, штрихкоды)', async () => {
    const edges = await db.execute<{ child: string; parent: string }>(sql`
      select distinct kcu.table_name as child, ccu.table_name as parent
      from information_schema.referential_constraints rc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = rc.constraint_name and kcu.constraint_schema = rc.constraint_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = rc.unique_constraint_name
       and ccu.constraint_schema = rc.unique_constraint_schema
      where kcu.constraint_schema = 'public'`)
    const reaching = new Set(['actors'])
    for (let grown = true; grown;) {
      grown = false
      for (const { child, parent } of edges) {
        if (reaching.has(parent) && !reaching.has(child)) {
          reaching.add(child)
          grown = true
        }
      }
    }

    expect([...reaching].filter((table) => !(table in EXPORT_COLUMNS)).sort()).toEqual([])
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

  it('каждое поле файла заполнено хоть в одной строке, когда заполнено в базе', async () => {
    const { tg, actorId } = await someone()
    await aFullLife(actorId, tg)
    await insertItem(db, { name: 'Чужое', createdBy: (await someone()).actorId })

    const { wire } = await fileOf(actorId)

    const { account, catalogue, format, version, exportedAt, ...sections } = wire
    expect(emptyEverywhere([account])).toEqual([])
    expect(emptyEverywhere(catalogue.items)).toEqual([])
    expect(emptyEverywhere(catalogue.places)).toEqual([])
    for (const [section, rows] of Object.entries(sections)) {
      expect({ section, empty: emptyEverywhere(rows) }).toEqual({ section, empty: [] })
    }
    expect([format, version, exportedAt]).not.toContain(null)
    const trip = wire.trips[0]
    expect([trip?.rateChoice, trip?.ratePrevious?.rate, trip?.rateManual?.rate]).toEqual([
      'manual',
      '4.700000',
      '4.900000',
    ])
    expect(trip?.finishedOnDeviceAt).toBe('2026-09-20T10:07:00.000Z')
    expect(trip?.finishedAt).toBe('2026-09-20T10:08:00.000Z')
    expect(wire.exchanges[0]?.heldBefore).toEqual({ amount: '1000.00', currency: 'AMD' })
    expect(wire.spendings[0]?.debited).toEqual({ amount: '2400.00', currency: 'AMD' })
    expect(wire.accountChecks[0]).toMatchObject({
      fact: { amount: '9000.00', currency: 'AMD' },
      counted: { amount: '9500.00', currency: 'AMD' },
    })
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

  it('тот же магазин и та же позиция у другого человека — его строк в файле нет', async () => {
    const anna = await someone()
    const boris = await someone()
    const shared = { itemId: await insertItem(db), placeId: await insertPlace(db) }
    await aLife(db, anna.actorId, anna.tg, shared)
    await aLife(db, boris.actorId, boris.tg, shared)
    await db
      .update(verdicts)
      .set({ review: 'Отзыв Бориса' })
      .where(and(eq(verdicts.actorId, boris.actorId), isNull(verdicts.deletedAt)))
    const [annaFile, borisTrips] = [
      await fileOf(anna.actorId),
      await db.select({ id: trips.id }).from(trips).where(eq(trips.actorId, boris.actorId)),
    ]

    const { content, text } = annaFile
    const { erased } = await erasure.erase(anna.tg, { dryRun: true })
    expect(content.expenses).toHaveLength(erased.expenses)
    expect(content.verdicts).toHaveLength(erased.verdicts)
    expect(text).not.toContain('Отзыв Бориса')
    for (const { id } of borisTrips) expect(text).not.toContain(id)
    expect(content.catalogue.places.map((place) => place.id)).toEqual([shared.placeId])
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
