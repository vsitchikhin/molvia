import { randomBytes, randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ACTOR_REFERENCES, createErasureRepository } from '@/db/erasure-repository'
import { createLoginRequestRepository } from '@/db/login-requests-repository'
import { createActorRepository } from '@/db/actors-repository'
import { authTransactOn } from '@/db/auth-unit-of-work'
import { completeLogin } from '@/usecases/complete-login'
import { lockTelegramAccount } from '@/db/telegram-lock'
import {
  actors,
  erasures,
  events,
  exchanges,
  incomes,
  itemBarcodes,
  items,
  loginRequests,
  moneyAccountChecks,
  moneyAccounts,
  moneyMonthRates,
  budgetPlans,
  feedback,
  places,
  searchPicks,
  spendingCategories,
  spendings,
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
  telegramId,
} from './fixtures'

const { db, close } = connectDrizzle()
const erasure = createErasureRepository(db)

afterAll(close)
beforeEach(() => clearAll(db))

/** Every row of every table, as text — a new table cannot hide from this. */
async function rowsMentioning(needle: string, digits = false): Promise<string[]> {
  const tables = await db.execute<{ table_name: string }>(sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'`)
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
    actor: await db.select().from(actors).where(eq(actors.id, actorId)),
    verdicts: await db.select().from(verdicts).where(eq(verdicts.actorId, actorId)),
    picks: await db.select().from(searchPicks).where(eq(searchPicks.actorId, actorId)),
    events: await db.select().from(events).where(eq(events.actorId, actorId)),
    expenses: await db.execute(sql`
      select e.* from expenses e join trips t on t.id = e.trip_id where t.actor_id = ${actorId}`),
    sessions: await db.execute(sql`select * from sessions where actor_id = ${actorId}`),
    exchanges: await db.select().from(exchanges).where(eq(exchanges.actorId, actorId)),
    incomes: await db.select().from(incomes).where(eq(incomes.actorId, actorId)),
    spendings: await db.select().from(spendings).where(eq(spendings.actorId, actorId)),
    categories: await db
      .select()
      .from(spendingCategories)
      .where(eq(spendingCategories.actorId, actorId)),
    monthRates: await db.select().from(moneyMonthRates).where(eq(moneyMonthRates.actorId, actorId)),
    plans: await db.select().from(budgetPlans).where(eq(budgetPlans.actorId, actorId)),
    feedback: await db.select().from(feedback).where(eq(feedback.actorId, actorId)),
    replies: await db.execute(sql`
      select r.* from feedback_replies r join feedback f on f.id = r.feedback_id
      where f.actor_id = ${actorId}`),
    accounts: await db.select().from(moneyAccounts).where(eq(moneyAccounts.actorId, actorId)),
    checks: await db
      .select()
      .from(moneyAccountChecks)
      .where(eq(moneyAccountChecks.actorId, actorId)),
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
    const { exchangeId, incomeId, spendingId, accountId, receiptId } = await aLife(
      db,
      anna,
      tg,
      shared,
    )

    const report = await erasure.erase(tg, { dryRun: false })

    expect(report).toEqual({
      found: true,
      erased: {
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
        spendings: 2,
        receipts: 2,
        budget_plans: 1,
        spending_categories: 1,
        money_month_rates: 1,
        money_account_checks: 1,
        money_accounts: 1,
        login_requests: 2,
        actors: 1,
      },
      itemsReleased: 1,
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
  })

  it('товар, который человек завёл, остаётся в справочнике без автора', async () => {
    const tg = telegramId()
    const anna = await insertActor(db, { telegramUserId: tg })
    const { ownItem } = await aLife(db, anna, tg, {
      itemId: await insertItem(db),
      placeId: await insertPlace(db),
    })

    await erasure.erase(tg, { dryRun: false })

    const [item] = await db.select().from(items).where(eq(items.id, ownItem))
    expect(item?.createdBy).toBeNull()
    expect(item?.name).toBe('Рынок-сыр')
  })

  it('код, который человек дописал к позиции, остаётся в справочнике без автора (MOL-100)', async () => {
    const tg = telegramId()
    const anna = await insertActor(db, { telegramUserId: tg })
    const itemId = await insertItem(db)
    await aLife(db, anna, tg, { itemId, placeId: await insertPlace(db) })

    await erasure.erase(tg, { dryRun: false })

    const codes = await db.select().from(itemBarcodes).where(eq(itemBarcodes.itemId, itemId))
    expect(codes).toHaveLength(1)
    expect(codes[0]?.addedBy).toBeNull()
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
  })

  it('сухой прогон считает ровно то же и не меняет ни строки', async () => {
    const tg = telegramId()
    const anna = await insertActor(db, { telegramUserId: tg })
    await aLife(db, anna, tg, { itemId: await insertItem(db), placeId: await insertPlace(db) })
    const before = await snapshot(anna)

    const dry = await erasure.erase(tg, { dryRun: true })

    expect(await snapshot(anna)).toEqual(before)
    expect(await erasure.erase(tg, { dryRun: false })).toEqual(dry)
  })

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
    const [request] = await db.select().from(loginRequests).where(eq(loginRequests.id, requestId))
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
  })

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
  })

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
  })

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
  })
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

    expect((await weeks()).sort()).toEqual([
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

    expect((await weeks()).sort()).toEqual([
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

describe('страж схемы', () => {
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

    expect(references.map((row) => row.reference)).toEqual([...ACTOR_REFERENCES].sort())
  })
})
