import { randomBytes, randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { storeMemoryWords } from '@molvia/model'
import { ACTOR_REFERENCES, ITEM_REFERENCES, createErasureRepository } from '@/db/erasure-repository'
import { createLoginRequestRepository } from '@/db/login-requests-repository'
import { createActorRepository } from '@/db/actors-repository'
import { authTransactOn } from '@/db/auth-unit-of-work'
import { completeLogin } from '@/usecases/complete-login'
import { lockTelegramAccount } from '@/db/telegram-lock'
import {
  actors,
  catalogueApart,
  catalogueMergeCandidates,
  catalogueMerges,
  erasures,
  events,
  exchanges,
  incomes,
  expenses,
  itemBarcodes,
  itemEmbeddings,
  itemHeadings,
  itemNames,
  items,
  loginRequests,
  moneyAccountChecks,
  moneyAccounts,
  moneyMonthRates,
  budgetPlans,
  feedback,
  places,
  receiptLines,
  receipts,
  searchPicks,
  spendingCategories,
  spendings,
  storeMemory,
  verdicts,
} from '@/db/schema'
import { connect, connectDrizzle } from './db'
import { aLife } from './life'
import {
  anHourFromNow,
  clearAll,
  insertActor,
  insertItem,
  insertLoginRequest,
  insertPlace,
  insertTrip,
  telegramId,
} from './fixtures'
import { onlyRow, sorted } from './rows'

// The 4 tests here past half a second on CI carry a timeout of 10 s: the slowest took 796 ms there
// (MOL-266). Ten times that, rounded up to 5 s, so the time reporter names one only on a run slower
// than any yet seen.

const { db, close } = connectDrizzle()
const erasure = createErasureRepository(db)

afterAll(close)
beforeEach(() => clearAll(db))

/** Every row of every table, as text — a new table cannot hide from this. */
async function rowsMentioning(needle: string, digits = false): Promise<string[]> {
  const tables = await db.execute<{ table_name: string }>(sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name`)
  const found: string[] = []
  for (const { table_name } of tables) {
    // A Telegram id is a number: match it whole, not inside some other number.
    const pattern = digits ? `(^|[^0-9])${needle}([^0-9]|$)` : needle
    const rows = await db.execute(
      sql`select 1 from ${sql.identifier(table_name)} t where t::text ~ ${pattern}`,
    )
    if (rows.length > 0) found.push(table_name)
  }
  return found
}

async function snapshot(actorId: string) {
  return {
    actor: await db.select().from(actors).where(eq(actors.id, actorId)).orderBy(actors.id),
    verdicts: await db
      .select()
      .from(verdicts)
      .where(eq(verdicts.actorId, actorId))
      .orderBy(verdicts.id),
    picks: await db
      .select()
      .from(searchPicks)
      .where(eq(searchPicks.actorId, actorId))
      .orderBy(searchPicks.actorId, searchPicks.queryKey, searchPicks.itemId),
    events: await db.select().from(events).where(eq(events.actorId, actorId)).orderBy(events.id),
    expenses: await db.execute(sql`
      select e.* from expenses e join trips t on t.id = e.trip_id where t.actor_id = ${actorId}
      order by e.id`),
    sessions: await db.execute(sql`select * from sessions where actor_id = ${actorId} order by id`),
    exchanges: await db
      .select()
      .from(exchanges)
      .where(eq(exchanges.actorId, actorId))
      .orderBy(exchanges.id),
    incomes: await db
      .select()
      .from(incomes)
      .where(eq(incomes.actorId, actorId))
      .orderBy(incomes.id),
    spendings: await db
      .select()
      .from(spendings)
      .where(eq(spendings.actorId, actorId))
      .orderBy(spendings.id),
    categories: await db
      .select()
      .from(spendingCategories)
      .where(eq(spendingCategories.actorId, actorId))
      .orderBy(spendingCategories.id),
    monthRates: await db
      .select()
      .from(moneyMonthRates)
      .where(eq(moneyMonthRates.actorId, actorId))
      .orderBy(moneyMonthRates.month, moneyMonthRates.base, moneyMonthRates.quote),
    plans: await db
      .select()
      .from(budgetPlans)
      .where(eq(budgetPlans.actorId, actorId))
      .orderBy(budgetPlans.actorId, budgetPlans.categoryId, budgetPlans.fromMonth),
    feedback: await db
      .select()
      .from(feedback)
      .where(eq(feedback.actorId, actorId))
      .orderBy(feedback.id),
    replies: await db.execute(sql`
      select r.* from feedback_replies r join feedback f on f.id = r.feedback_id
      where f.actor_id = ${actorId}
      order by r.id`),
    accounts: await db
      .select()
      .from(moneyAccounts)
      .where(eq(moneyAccounts.actorId, actorId))
      .orderBy(moneyAccounts.id),
    checks: await db
      .select()
      .from(moneyAccountChecks)
      .where(eq(moneyAccountChecks.actorId, actorId))
      .orderBy(moneyAccountChecks.id),
  }
}

/** Whether a promise settles within `ms`: the lock either holds it back or it does not. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) =>
      setTimeout(() => {
        resolve(false)
      }, ms),
    ),
  ])
}

describe('стирание владельца по Telegram-id (MOL-58)', () => {
  it('после стирания о человеке не остаётся ни строки — ни в одной таблице базы', async () => {
    const tg = telegramId()
    const anna = await insertActor(db, { telegramUserId: tg })
    const shared = { itemId: await insertItem(db), placeId: await insertPlace(db) }
    const { exchangeId, incomeId, spendingId, accountId, receiptId, transferId } = await aLife(
      db,
      anna,
      tg,
      shared,
    )

    const report = await erasure.erase(tg, { dryRun: false })

    expect(report).toEqual({
      found: true,
      erased: {
        login_notices: 1,
        sessions: 1,
        search_picks: 1,
        rating_reminders: 1,
        verdicts: 2,
        events: 1,
        feedback: 2,
        expenses: 2,
        trips: 1,
        exchanges: 2,
        incomes: 2,
        spendings: 3,
        account_transfers: 1,
        receipts: 2,
        budget_plans: 1,
        spending_categories: 1,
        money_month_rates: 1,
        money_account_checks: 1,
        money_accounts: 2,
        login_requests: 2,
        actors: 1,
      },
      itemsErased: 1,
      itemsReleased: 0,
      barcodesReleased: 1,
      memoryReleased: 0,
      counted: true,
    })
    expect(await rowsMentioning(anna)).toEqual([])
    expect(await rowsMentioning(accountId)).toEqual([])
    expect(await rowsMentioning(spendingId)).toEqual([])
    // the photo, the lines read and the lines cut out go with the receipt (MOL-125)
    expect(await rowsMentioning(receiptId)).toEqual([])
    expect(await rowsMentioning(String(tg), true)).toEqual([])
    expect(await rowsMentioning(exchangeId)).toEqual([])
    expect(await rowsMentioning(incomeId)).toEqual([])
    expect(await rowsMentioning(transferId)).toEqual([])
  }, 15_000)

  it('код, который человек дописал к позиции, остаётся в справочнике без автора (MOL-100)', async () => {
    const tg = telegramId()
    const anna = await insertActor(db, { telegramUserId: tg })
    const itemId = await insertItem(db)
    await aLife(db, anna, tg, { itemId, placeId: await insertPlace(db) })

    await erasure.erase(tg, { dryRun: false })

    const codes = await db.select().from(itemBarcodes).where(eq(itemBarcodes.itemId, itemId))
    expect(codes).toHaveLength(1)
    expect(onlyRow(codes)?.addedBy).toBeNull()
  })

  it('места остаются все — и то, где бывал только он (решение Q4)', async () => {
    const tg = telegramId()
    const anna = await insertActor(db, { telegramUserId: tg })
    const onlyHers = await insertPlace(db, { name: 'Рынок у дома' })
    await aLife(db, anna, tg, { itemId: await insertItem(db), placeId: onlyHers })

    await erasure.erase(tg, { dryRun: false })

    expect(await db.select().from(places).where(eq(places.id, onlyHers))).toHaveLength(1)
  })

  it('не трогает другого человека, даже в том же магазине и с тем же товаром', async () => {
    const tg = telegramId()
    const boris = telegramId()
    const anna = await insertActor(db, { telegramUserId: tg })
    const witness = await insertActor(db, { telegramUserId: boris })
    const shared = { itemId: await insertItem(db), placeId: await insertPlace(db) }
    const { ownItem } = await aLife(db, anna, tg, shared)
    // Boris bought and rated what Anna added to the catalogue.
    await aLife(db, witness, boris, { ...shared, itemId: ownItem })
    const before = await snapshot(witness)

    await erasure.erase(tg, { dryRun: false })

    expect(await snapshot(witness)).toEqual(before)
    // The same scan that proves Anna gone must be able to see somebody who is not.
    expect(await rowsMentioning(witness)).not.toEqual([])
    expect(
      await db.select().from(loginRequests).where(eq(loginRequests.telegramUserId, boris)),
    ).toHaveLength(2)
  }, 10_000)

  it('сухой прогон считает ровно то же и не меняет ни строки', async () => {
    const tg = telegramId()
    const anna = await insertActor(db, { telegramUserId: tg })
    await aLife(db, anna, tg, { itemId: await insertItem(db), placeId: await insertPlace(db) })
    const before = await snapshot(anna)

    const dry = await erasure.erase(tg, { dryRun: true })

    expect(await snapshot(anna)).toEqual(before)
    expect(await erasure.erase(tg, { dryRun: false })).toEqual(dry)
  }, 10_000)

  it('неизвестный владелец: стирает только его запросы входа', async () => {
    const tg = telegramId()
    await insertLoginRequest(db, { telegramUserId: tg })
    const bystander = await insertLoginRequest(db, { telegramUserId: telegramId() })

    const report = await erasure.erase(tg, { dryRun: false })

    expect(report.found).toBe(false)
    expect(report.erased.login_requests).toBe(1)
    expect(report.erased.actors).toBe(0)
    expect(
      await db.select().from(loginRequests).where(eq(loginRequests.id, bystander)),
    ).toHaveLength(1)
  })

  it('повтор после стирания — «нет владельца», не ошибка', async () => {
    const tg = telegramId()
    await insertActor(db, { telegramUserId: tg })
    await erasure.erase(tg, { dryRun: false })

    const again = await erasure.erase(tg, { dryRun: false })

    expect(again.found).toBe(false)
    expect(Object.values(again.erased).every((n) => n === 0)).toBe(true)
  })

  it.each([0, -1, 1.5, 2 ** 53])('id %s не доходит до базы', async (id) => {
    await expect(erasure.erase(id, { dryRun: true })).rejects.toThrow()
  })
})

describe('стирание и вход, который собирается в это же время (adversarial О-3)', () => {
  it('владелец, созданный сборкой входа во время стирания, стирается, а не переживает его', async () => {
    const tg = telegramId()
    // Confirmed in the bot, not collected yet: there is no owner, and the browser's poll is on
    // its way. The collection is played by hand on its own connection, in the order
    // `completeLogin` takes: lock the request row, then create the owner, then commit.
    const request = await insertLoginRequest(db, { telegramUserId: tg })
    const collector = connect()
    try {
      let erasing: Promise<unknown> | undefined
      await collector.begin(async (tx) => {
        await tx`select id from login_requests where id = ${request} for update`
        erasing = erasure.erase(tg, { dryRun: false })
        // Long enough for the erasure to reach its first statement and wait there.
        await new Promise((resolve) => setTimeout(resolve, 200))
        await tx`insert into actors (id, telegram_user_id, country, city, spend_currency, income_currency)
                 values (${randomUUID()}, ${tg}, 'AM', 'Гюмри', 'AMD', 'RUB')`
      })
      const report = (await erasing) as Awaited<ReturnType<typeof erasure.erase>>

      expect(report.found).toBe(true)
      expect(report.erased.actors).toBe(1)
      expect(await db.select().from(actors).where(eq(actors.telegramUserId, tg))).toEqual([])
    } finally {
      await collector.end()
    }
  })
})

describe('подтверждение входа и стирание одного аккаунта идут по очереди (adversarial П-2)', () => {
  it('подтверждение ждёт, пока идёт стирание этого аккаунта', async () => {
    const tg = telegramId()
    // Started in the browser, not confirmed yet: the row has no Telegram id for erasure to lock.
    const requestId = await insertLoginRequest(db)
    const request = onlyRow(
      await db.select().from(loginRequests).where(eq(loginRequests.id, requestId)),
    )
    const holder = connectDrizzle()
    try {
      let confirming: Promise<unknown> | undefined
      await holder.db.transaction(async (tx) => {
        await tx.execute(lockTelegramAccount(tg))
        confirming = createLoginRequestRepository(db).confirm(request?.code ?? '', tg)
        expect(await settlesWithin(confirming, 300)).toBe(false)
      })
      expect(await confirming).not.toBeNull()
    } finally {
      await holder.close()
    }
  }, 10_000)

  it('и стирание ждёт того же замка — первым, до любой строки', async () => {
    const tg = telegramId()
    await insertActor(db, { telegramUserId: tg })
    const holder = connectDrizzle()
    try {
      let erasing: Promise<unknown> | undefined
      await holder.db.transaction(async (tx) => {
        await tx.execute(lockTelegramAccount(tg))
        erasing = erasure.erase(tg, { dryRun: false })
        expect(await settlesWithin(erasing, 300)).toBe(false)
      })
      expect(await erasing).toMatchObject({ found: true })
    } finally {
      await holder.close()
    }
  }, 10_000)

  it('а другой аккаунт этот замок не держит', async () => {
    const tg = telegramId()
    await insertActor(db, { telegramUserId: tg })
    const holder = connectDrizzle()
    try {
      await holder.db.transaction(async (tx) => {
        await tx.execute(lockTelegramAccount(telegramId()))
        expect(await settlesWithin(erasure.erase(tg, { dryRun: false }), 2000)).toBe(true)
      })
    } finally {
      await holder.close()
    }
  })
})

describe('владельца, пока идёт стирание, не создаёт никто (adversarial Р-1)', () => {
  const settings = {
    country: 'AM',
    city: 'Гюмри',
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
  } as const

  it('создание владельца ждёт замка аккаунта — каким бы путём оно ни шло', async () => {
    const tg = telegramId()
    const holder = connectDrizzle()
    try {
      let creating: Promise<unknown> | undefined
      await holder.db.transaction(async (tx) => {
        await tx.execute(lockTelegramAccount(tg))
        // What `signIn` does for the development seam, and for any sign-in that comes later.
        creating = createActorRepository(db).createIfMissing(randomUUID(), tg, settings)
        expect(await settlesWithin(creating, 300)).toBe(false)
      })
      await creating
    } finally {
      await holder.close()
    }
  }, 10_000)

  it('сборка входа тоже ждёт — и ждёт до строки запроса, так что стиранию ждать нечего', async () => {
    const tg = telegramId()
    const id = randomUUID()
    const code = randomBytes(32).toString('base64url')
    const secret = randomBytes(32).toString('base64url')
    const requests = createLoginRequestRepository(db)
    await requests.create(id, code, secret, null, anHourFromNow())
    await requests.confirm(code, tg)
    const holder = connectDrizzle()
    try {
      let collecting: Promise<unknown> | undefined
      await holder.db.transaction(async (tx) => {
        await tx.execute(lockTelegramAccount(tg))
        collecting = completeLogin(authTransactOn(db), id, secret)
        expect(await settlesWithin(collecting, 300)).toBe(false)
        // The row is still free: erasure, holding the account, can take it without a deadlock.
        await tx.execute(sql`select 1 from login_requests where id = ${id} for update nowait`)
      })
      expect(await collecting).toMatchObject({ status: 'authenticated' })
    } finally {
      await holder.close()
    }
  }, 10_000)
})

describe('стирание не закрывает вход остальным (adversarial Р-3)', () => {
  it('пока идёт стирание человека с истёкшим запросом входа, чужой вход начинается сразу', async () => {
    const tg = telegramId()
    const actorId = await insertActor(db, { telegramUserId: tg })
    const expired = await insertLoginRequest(db, { telegramUserId: tg })
    await db.execute(sql`
      update login_requests
      set created_at = now() - interval '10 minutes', expires_at = now() - interval '5 minutes'
      where id = ${expired}`)
    const holder = connectDrizzle()
    try {
      await holder.db.transaction(async (tx) => {
        // What erasure holds for its whole transaction: the account, every request, the owner.
        await tx.execute(lockTelegramAccount(tg))
        await tx.execute(
          sql`select 1 from login_requests where telegram_user_id = ${tg} for update`,
        )
        await tx.execute(sql`select 1 from actors where id = ${actorId} for update`)

        const started = createLoginRequestRepository(db).createLimited(
          randomUUID(),
          randomUUID().replaceAll('-', ''),
          randomBytes(32).toString('base64url'),
          null,
        )
        expect(await settlesWithin(started, 2000)).toBe(true)
      })
      // Skipped, not lost: the next pass takes the expired row.
      await createLoginRequestRepository(db).removeExpired()
      expect(await db.select().from(loginRequests).where(eq(loginRequests.id, expired))).toEqual([])
    } finally {
      await holder.close()
    }
  })
})

describe('стирание оставляет одно число — сколько пришедших за неделю стёрли себя (MOL-91)', () => {
  const weeks = async () =>
    (await db.select().from(erasures)).map((row) => [row.appearedWeek, row.erased])

  it('прибавляет единицу к неделе прихода, и только к ней', async () => {
    // Monday 5 October 2026 in Yerevan: Wednesday and Sunday of that week, Monday of the next.
    const wednesday = telegramId()
    const sunday = telegramId()
    const nextMonday = telegramId()
    await insertActor(db, {
      telegramUserId: wednesday,
      createdAt: new Date('2026-10-07T09:00:00Z'),
    })
    await insertActor(db, { telegramUserId: sunday, createdAt: new Date('2026-10-11T12:00:00Z') })
    await insertActor(db, {
      telegramUserId: nextMonday,
      createdAt: new Date('2026-10-12T09:00:00Z'),
    })

    for (const tg of [wednesday, sunday, nextMonday]) {
      await expect(erasure.erase(tg, { dryRun: false })).resolves.toMatchObject({ counted: true })
    }

    expect(sorted(await weeks())).toEqual([
      ['2026-10-05', 2],
      ['2026-10-12', 1],
    ])
  })

  it('неделя — по Еревану: воскресенье 21:00 UTC — это уже понедельник', async () => {
    const mondayInYerevan = telegramId()
    const sundayInYerevan = telegramId()
    await insertActor(db, {
      telegramUserId: mondayInYerevan,
      createdAt: new Date('2026-10-11T20:00:00Z'), // 00:00 on Monday the 12th in Yerevan
    })
    await insertActor(db, {
      telegramUserId: sundayInYerevan,
      createdAt: new Date('2026-10-11T19:59:59.999Z'), // 23:59 on Sunday the 11th
    })

    await erasure.erase(mondayInYerevan, { dryRun: false })
    await erasure.erase(sundayInYerevan, { dryRun: false })

    expect(sorted(await weeks())).toEqual([
      ['2026-10-05', 1],
      ['2026-10-12', 1],
    ])
  })

  it('сухой прогон не считает — он откатывается целиком', async () => {
    const tg = telegramId()
    await insertActor(db, { telegramUserId: tg })

    await expect(erasure.erase(tg, { dryRun: true })).resolves.toMatchObject({ counted: true })

    expect(await weeks()).toEqual([])
  })

  it('нет владельца — нечего и считать', async () => {
    const tg = telegramId()
    await insertLoginRequest(db, { telegramUserId: tg })

    await expect(erasure.erase(tg, { dryRun: false })).resolves.toMatchObject({
      found: false,
      counted: false,
    })
    expect(await weeks()).toEqual([])
  })
})

describe('товары человека при стирании (MOL-374)', () => {
  /** Anna, her item, and Boris with a trip of his own — the somebody else who may stand on it. */
  async function annaAndBoris() {
    const tg = telegramId()
    const anna = await insertActor(db, { telegramUserId: tg })
    const boris = await insertActor(db, { telegramUserId: telegramId() })
    const item = await insertItem(db, {
      name: 'Лаваш домашний',
      searchKey: 'lavash domashnij',
      createdBy: anna,
    })
    return { tg, anna, boris, item }
  }

  async function itemRow(id: string) {
    return onlyRow(await db.select().from(items).where(eq(items.id, id)))
  }

  async function aWord(actorId: string | null, itemId: string, printed: string) {
    const [said] = storeMemoryWords({ printed, sku: null })
    if (said === undefined) throw new Error('a line with letters says a word')
    await db
      .insert(storeMemory)
      .values({ id: randomUUID(), tin: '01282006', ...said, actorId, itemId })
  }

  it('товар, на который опирался только он сам, уходит с вектором, его кодом и его словом', async () => {
    const { tg, anna, item } = await annaAndBoris()
    // everything Anna's own: a purchase, a withdrawn verdict, a pick, a code, a word of the shops' memory
    const tripId = await insertTrip(db, { actorId: anna, placeId: await insertPlace(db) })
    await db.insert(expenses).values({ id: randomUUID(), tripId, itemId: item })
    await db.insert(verdicts).values({
      id: randomUUID(),
      actorId: anna,
      itemId: item,
      itemKind: 'product',
      score: 2,
      ratedAt: new Date(Date.now() - 60_000),
      deletedAt: new Date(),
    })
    await db.insert(searchPicks).values({ actorId: anna, queryKey: 'lavash', itemId: item })
    await db.insert(itemBarcodes).values({ code: '4850001234567', itemId: item, addedBy: anna })
    await aWord(anna, item, 'Լավաշ տնական')
    await db
      .insert(itemEmbeddings)
      .values({ itemId: item, model: 'test', embedding: Array<number>(768).fill(0.1) })
    const other = await insertItem(db, { name: 'Лаваш армянский', searchKey: 'lavash armyanskij' })
    const [a, b] = [item, other].toSorted()
    await db.insert(catalogueMergeCandidates).values({
      subject: 'item',
      a: a ?? item,
      b: b ?? other,
      namedOn: '2026-11-10',
    })

    const report = await erasure.erase(tg, { dryRun: false })

    expect(report).toMatchObject({ itemsErased: 1, itemsReleased: 0 })
    expect(await itemRow(item)).toBeUndefined()
    expect(await rowsMentioning(item)).toEqual([])
    expect(await itemRow(other)).toBeDefined()
  }, 10_000)

  it('сухой прогон называет удаляемый товар и оставляет его на месте', async () => {
    const { tg, item } = await annaAndBoris()

    const dry = await erasure.erase(tg, { dryRun: true })

    expect(dry).toMatchObject({ itemsErased: 1, itemsReleased: 0 })
    expect(await itemRow(item)).toBeDefined()
  })

  type Holder = (who: { boris: string; item: string }) => Promise<unknown>
  const holders: [string, Holder][] = [
    [
      'чужая покупка',
      async ({ boris, item }) => {
        const tripId = await insertTrip(db, { actorId: boris, placeId: await insertPlace(db) })
        await db.insert(expenses).values({ id: randomUUID(), tripId, itemId: item })
      },
    ],
    [
      'чужая снятая оценка',
      ({ boris, item }) =>
        db.insert(verdicts).values({
          id: randomUUID(),
          actorId: boris,
          itemId: item,
          itemKind: 'product',
          score: 4,
          ratedAt: new Date(Date.now() - 60_000),
          deletedAt: new Date(),
        }),
    ],
    [
      'чужой выбор в поиске',
      ({ boris, item }) =>
        db.insert(searchPicks).values({ actorId: boris, queryKey: 'lavash', itemId: item }),
    ],
    [
      'строка чужого незаписанного чека (В-2 «а»)',
      async ({ boris, item }) => {
        const receiptId = randomUUID()
        const at = new Date()
        await db.insert(receipts).values({
          id: receiptId,
          actorId: boris,
          status: 'queued',
          parts: 1,
          country: 'AM',
          language: 'ru',
          currency: 'AMD',
          capturedAt: at,
          queuedAt: at,
        })
        await db.insert(receiptLines).values({
          receiptId,
          position: 0,
          printed: 'Լավաշ տնական',
          settled: false,
          itemId: item,
        })
      },
    ],
    [
      'код, привязанный другим',
      ({ boris, item }) =>
        db.insert(itemBarcodes).values({ code: '4850007654321', itemId: item, addedBy: boris }),
    ],
    [
      'код уже стёртого автора',
      ({ item }) =>
        db.insert(itemBarcodes).values({ code: '4850007654321', itemId: item, addedBy: null }),
    ],
    ['чужое слово памяти магазина', ({ boris, item }) => aWord(boris, item, 'Լավաշ')],
    ['слово уже стёртого автора', ({ item }) => aWord(null, item, 'Լավաշ')],
    [
      'на него склеен след',
      async ({ item }) => {
        const twin = await insertItem(db, {
          name: 'Лаваш домашни',
          searchKey: 'lavash domashni',
          mergedInto: item,
        })
        await db
          .insert(catalogueMerges)
          .values({ subject: 'item', fromItem: twin, intoItem: item, by: 'hand' })
      },
    ],
    [
      'он сам — след склейки',
      async ({ item }) => {
        const survivor = await insertItem(db, { name: 'Лаваш', searchKey: 'lavash' })
        await db.update(items).set({ mergedInto: survivor }).where(eq(items.id, item))
        await db
          .insert(catalogueMerges)
          .values({ subject: 'item', fromItem: item, intoItem: survivor, by: 'hand' })
      },
    ],
    [
      'слово владельца «это разное»',
      async ({ item }) => {
        const other = await insertItem(db, {
          name: 'Лаваш армянский',
          searchKey: 'lavash armyanskij',
        })
        const [a, b] = [item, other].toSorted()
        await db.insert(catalogueApart).values({ subject: 'item', a: a ?? item, b: b ?? other })
      },
    ],
    [
      'армянское имя сида',
      ({ item }) => db.insert(itemNames).values({ itemId: item, language: 'hy', name: 'լավաշ' }),
    ],
    ['заголовок сида', ({ item }) => db.insert(itemHeadings).values({ itemId: item, hs: '1905' })],
  ]

  it.each(holders)('товар держит %s — остаётся без автора', async (_, hold) => {
    const { tg, boris, item } = await annaAndBoris()
    await hold({ boris, item })

    const report = await erasure.erase(tg, { dryRun: false })

    expect(report).toMatchObject({ itemsErased: 0, itemsReleased: 1 })
    expect((await itemRow(item))?.createdBy).toBeNull()
  })

  it('его код и его слово на товаре, который остаётся, остаются без автора', async () => {
    const { tg, anna, boris, item } = await annaAndBoris()
    await db.insert(searchPicks).values({ actorId: boris, queryKey: 'lavash', itemId: item })
    await db.insert(itemBarcodes).values({ code: '4850001234567', itemId: item, addedBy: anna })
    await aWord(anna, item, 'Լավաշ տնական')

    await erasure.erase(tg, { dryRun: false })

    const code = onlyRow(await db.select().from(itemBarcodes).where(eq(itemBarcodes.itemId, item)))
    expect(code?.addedBy).toBeNull()
    const word = onlyRow(await db.select().from(storeMemory).where(eq(storeMemory.itemId, item)))
    expect(word?.actorId).toBeNull()
  })

  it('товар, который сейчас пишет чужая транзакция, остаётся без автора, и стирание её не ждёт', async () => {
    const { tg, item } = await annaAndBoris()
    const writer = connect()
    try {
      await writer.begin(async (tx) => {
        // what a foreign key takes while somebody's purchase of it is being written
        await tx`select 1 from items where id = ${item} for key share`
        // Waiting on the lock, the erasure would never settle while this transaction stays open.
        const report = await erasure.erase(tg, { dryRun: false })
        expect(report).toMatchObject({ itemsErased: 0, itemsReleased: 1 })
      })
    } finally {
      await writer.end()
    }
    expect((await itemRow(item))?.createdBy).toBeNull()
  })
})

describe('страж схемы', () => {
  it('каждый внешний ключ на items известен стиранию (MOL-374)', async () => {
    const references = await db.execute<{ reference: string }>(sql`
      select distinct kcu.table_name || '.' || kcu.column_name as reference
      from information_schema.referential_constraints rc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = rc.constraint_name and kcu.constraint_schema = rc.constraint_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = rc.unique_constraint_name
       and ccu.constraint_schema = rc.unique_constraint_schema
      where ccu.table_name = 'items' and ccu.column_name = 'id' and kcu.column_name <> 'item_kind'
        and kcu.constraint_schema = 'public'
      order by 1`)

    // Red here is a new table that points at an item: erasure must decide whether it holds one.
    expect(references.map((row) => row.reference)).toEqual([...ITEM_REFERENCES].sort())
  })

  it('каждый внешний ключ на actors известен стиранию', async () => {
    const references = await db.execute<{ reference: string }>(sql`
      select kcu.table_name || '.' || kcu.column_name as reference
      from information_schema.referential_constraints rc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = rc.constraint_name and kcu.constraint_schema = rc.constraint_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = rc.unique_constraint_name
       and ccu.constraint_schema = rc.unique_constraint_schema
      where ccu.table_name = 'actors' and kcu.constraint_schema = 'public'
      order by 1`)

    // Red here is a person's new data: it also adds its row to the record of processing
    // (Confluence 12091393, MOL-97) in the same PR — no test holds it, only this line and `CLAUDE.md`.
    expect(references.map((row) => row.reference)).toEqual([...ACTOR_REFERENCES].sort())
  })
})
