import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { ERROR, money } from '@molvia/model'
import type { ExchangeBody } from '@molvia/model'
import { createExchangeRepository } from '@/db/exchanges-repository'
import { actors, exchanges, expenses } from '@/db/schema'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace, insertTrip } from './fixtures'

const { db, close } = connectDrizzle()
const repository = createExchangeRepository(db)

beforeEach(async () => {
  await clearAll(db)
})
afterAll(async () => {
  await clearAll(db)
  await close()
})

function body(patch: Partial<ExchangeBody> = {}): ExchangeBody {
  return {
    id: randomUUID(),
    given: money(2_000_000n, 'RUB'),
    received: money(9_500_000n, 'AMD'),
    exchangedOn: '2026-09-15',
    ...patch,
  }
}

describe('exchanges: запись', () => {
  it('пишет обмен целиком, и остаток — в полученной валюте', async () => {
    const owner = await insertActor(db)
    const input = body({ heldBefore: money(2_000_000n, 'AMD') })
    const { exchange, created } = await repository.add(owner, input)

    expect(created).toBe(true)
    expect(exchange).toMatchObject({
      id: input.id,
      actorId: owner,
      given: money(2_000_000n, 'RUB'),
      received: money(9_500_000n, 'AMD'),
      exchangedOn: '2026-09-15',
      heldBefore: money(2_000_000n, 'AMD'),
    })
  })

  it('«не сказал» остаётся null, а ноль — нулём', async () => {
    const owner = await insertActor(db)
    const unsaid = await repository.add(owner, body())
    const empty = await repository.add(owner, body({ heldBefore: money(0n, 'AMD') }))
    expect(unsaid.exchange.heldBefore).toBeNull()
    expect(empty.exchange.heldBefore).toEqual(money(0n, 'AMD'))
  })

  it('повтор тем же id — тот же обмен, даже с другими числами', async () => {
    const owner = await insertActor(db)
    const input = body()
    await repository.add(owner, input)
    const again = await repository.add(owner, { ...input, received: money(1n, 'AMD') })

    expect(again.created).toBe(false)
    expect(again.exchange.received).toEqual(money(9_500_000n, 'AMD'))
    expect(await db.select().from(exchanges)).toHaveLength(1)
  })

  it('чужой id — CONFLICT, и чужой обмен не тронут', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const input = body()
    await repository.add(stranger, input)

    await expect(repository.add(owner, input)).rejects.toMatchObject({ code: ERROR.CONFLICT })
    const [row] = await db.select().from(exchanges)
    expect(row?.actorId).toBe(stranger)
  })

  it('база не пускает обмен в одной валюте, ноль и отрицательный остаток', async () => {
    const owner = await insertActor(db)
    const row = {
      id: randomUUID(),
      actorId: owner,
      givenMinor: 100n,
      givenCurrency: 'RUB' as const,
      receivedMinor: 100n,
      receivedCurrency: 'AMD' as const,
      exchangedOn: '2026-09-15',
    }
    await expect(db.insert(exchanges).values({ ...row, receivedCurrency: 'RUB' })).rejects.toThrow()
    await expect(db.insert(exchanges).values({ ...row, givenMinor: 0n })).rejects.toThrow()
    await expect(db.insert(exchanges).values({ ...row, heldBeforeMinor: -1n })).rejects.toThrow()
    await expect(
      db.insert(exchanges).values({ ...row, givenCurrency: 'GEL' as 'RUB' }),
    ).rejects.toThrow()
  })
})

describe('exchanges: чтение и удаление', () => {
  it('отдаёт только свои, по дню, затем по порядку записи', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const late = await repository.add(owner, body({ exchangedOn: '2026-09-20' }))
    const early = await repository.add(owner, body({ exchangedOn: '2026-09-01' }))
    const sameDay = await repository.add(owner, body({ exchangedOn: '2026-09-20' }))
    await repository.add(stranger, body())

    expect((await repository.list(owner)).map((exchange) => exchange.id)).toEqual([
      early.exchange.id,
      late.exchange.id,
      sameDay.exchange.id,
    ])
  })

  it('удаляет свой; чужой, отсутствующий и кривой id — молча и без следа', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const own = await repository.add(owner, body())
    const theirs = await repository.add(stranger, body())

    await repository.remove(owner, theirs.exchange.id)
    await repository.remove(owner, randomUUID())
    await repository.remove(owner, 'not-a-uuid')
    await repository.remove(owner, own.exchange.id.toUpperCase())

    expect((await db.select().from(exchanges)).map((row) => row.id)).toEqual([theirs.exchange.id])
  })

  it('уходит вместе с владельцем', async () => {
    const owner = await insertActor(db)
    await repository.add(owner, body())
    await db.delete(actors).where(eq(actors.id, owner))
    expect(await db.select().from(exchanges)).toEqual([])
  })
})

describe('exchanges: подсказка остатка и источник курса', () => {
  it('складывает траты с ценой в этой валюте с данного момента — все походы, только свои', async () => {
    const owner = await insertActor(db)
    const stranger = await insertActor(db)
    const item = await insertItem(db)
    const place = await insertPlace(db)
    const trip = await insertTrip(db, { actorId: owner, placeId: place })
    const older = await insertTrip(db, {
      actorId: owner,
      placeId: place,
      startedAt: new Date('2026-09-14T10:00:00Z'),
      finishedAt: new Date('2026-09-15T10:00:00Z'),
    })
    const theirs = await insertTrip(db, { actorId: stranger, placeId: place })
    const since = new Date('2026-09-15T00:00:00+04:00')
    const row = (tripId: string, minor: bigint | null, currency: 'AMD' | 'RUB', at: string) => ({
      id: randomUUID(),
      tripId,
      itemId: item,
      amountMinor: minor,
      amountCurrency: minor === null ? null : currency,
      createdAt: new Date(at),
    })
    await db
      .insert(expenses)
      .values([
        row(trip, 100_000n, 'AMD', '2026-09-16T10:00:00Z'),
        row(older, 50_000n, 'AMD', '2026-09-15T08:00:00Z'),
        row(trip, 7_000n, 'RUB', '2026-09-16T10:00:00Z'),
        row(trip, null, 'AMD', '2026-09-16T10:00:00Z'),
        row(trip, 999n, 'AMD', '2026-09-14T10:00:00Z'),
        row(theirs, 888_888n, 'AMD', '2026-09-16T10:00:00Z'),
      ])

    expect(await repository.spentSince(owner, 'AMD', since)).toBe(150_000n)
    expect(await repository.spentSince(owner, 'USD', since)).toBe(0n)
  })

  it('источник по умолчанию — свой, и переключается', async () => {
    const owner = await insertActor(db)
    expect(await repository.preference(owner)).toBe('personal')
    await repository.setPreference(owner, 'official')
    expect(await repository.preference(owner)).toBe('official')
  })

  it('база не пускает неизвестный источник', async () => {
    const owner = await insertActor(db)
    await expect(
      db.execute(sql`update actors set rate_preference = 'fallback' where id = ${owner}`),
    ).rejects.toThrow()
  })
})
