/**
 * The table of failures and the owner's queue (MOL-143) against a real Postgres: one row a
 * fingerprint, the count in a build that drives the owner's messages, the queue handed out once,
 * and what is kept how long. Nothing here points at a person.
 */
import { createHash, randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { OwnerNotice } from '@molvia/model'
import { createFailureRepository } from '@/db/failures-repository'
import type { FailureOccurrence } from '@/db/failures-repository'
import { createOwnerNoticeRepository } from '@/db/owner-notices-repository'
import { ownerNotices } from '@/db/schema'
import { connectDrizzle } from './db'
import { clearAll } from './fixtures'

const { db, close } = connectDrizzle()
const failureRows = createFailureRepository(db)
const notices = createOwnerNoticeRepository(db)

beforeEach(() => clearAll(db))
afterAll(async () => {
  await clearAll(db)
  await close()
})

const AT = new Date('2026-10-03T10:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function occurrence(patch: Partial<FailureOccurrence> = {}): FailureOccurrence {
  return {
    fingerprint: createHash('sha256').update(randomUUID()).digest('hex'),
    source: 'api',
    errorName: 'TypeError',
    route: 'PUT /verdicts/:itemId',
    frames: ['at rateItem (src/usecases/rate-item.ts:42:7)'],
    build: 'v0.2.0-3-gaaaaaaa',
    ...patch,
  }
}

function notice(count?: 10 | 100 | 1000): OwnerNotice {
  const facts = { source: 'api', errorName: 'TypeError', build: 'v0.2.0-3-gaaaaaaa' } as const
  return count === undefined
    ? { kind: 'failure', ...facts, fingerprint: 'abcdef' }
    : { kind: 'failure_count', ...facts, count }
}

const none = (): readonly OwnerNotice[] => []

describe('failures — строка на отпечаток', () => {
  it('повтор того же отпечатка копит счёт, а не строки', async () => {
    const failure = occurrence()
    expect(await failureRows.record(failure, 1, AT, none)).toEqual({ count: 1, buildCount: 1 })
    expect(await failureRows.record(failure, 1, AT, none)).toEqual({ count: 2, buildCount: 2 })

    const [row] = await failureRows.latest(10)
    expect(row).toMatchObject({ count: 2, buildCount: 2, firstSeenAt: AT, lastSeenAt: AT })
    expect(await failureRows.latest(10)).toHaveLength(1)
  })

  it('пачка пишется одной записью со своим счётом и в сборке', async () => {
    const failure = occurrence()
    expect(await failureRows.record(failure, 37, AT, none)).toEqual({ count: 37, buildCount: 37 })
    expect(await failureRows.record(failure, 5, AT, none)).toEqual({ count: 42, buildCount: 42 })
    const moved = { ...failure, build: 'v0.2.0-4-gbbbbbbb' }
    expect(await failureRows.record(moved, 3, AT, none)).toEqual({ count: 45, buildCount: 3 })
  })

  it('другая сборка: счёт в сборке с единицы, общий растёт, кадры — последние', async () => {
    const failure = occurrence()
    await failureRows.record(failure, 1, AT, none)
    await failureRows.record(failure, 1, AT, none)
    const later = new Date(AT.getTime() + 60_000)
    const moved = { ...failure, build: 'v0.2.0-4-gbbbbbbb', frames: ['at rateItem (x.ts:50:1)'] }

    expect(await failureRows.record(moved, 1, later, none)).toEqual({ count: 3, buildCount: 1 })
    const [row] = await failureRows.latest(1)
    expect(row).toMatchObject({ build: moved.build, frames: moved.frames, lastSeenAt: later })
  })

  it('десять разом: каждое число в сборке видит ровно одна запись', async () => {
    const failure = occurrence()
    const seen = await Promise.all(
      Array.from({ length: 10 }, () => failureRows.record(failure, 1, AT, none)),
    )
    expect(seen.map((count) => count.buildCount).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ])
  })

  it('уведомление ложится в той же транзакции, что и счёт', async () => {
    const failure = occurrence()
    await failureRows.record(failure, 1, AT, (count) => (count.buildCount === 1 ? [notice()] : []))
    await failureRows.record(failure, 1, AT, (count) => (count.buildCount === 1 ? [notice()] : []))
    expect(await notices.claim(20, AT)).toEqual([notice()])
  })

  it('уведомление, которое не легло, откатывает и счёт', async () => {
    const failure = occurrence()
    const broken = { ...notice(), kind: 'feedback' } as unknown as OwnerNotice
    await expect(failureRows.record(failure, 1, AT, () => [broken])).rejects.toThrow()
    expect(await failureRows.latest(10)).toEqual([])
  })

  it('отпечаток, не случавшийся 30 дней, уходит; 30 дней без минуты — остаётся', async () => {
    const old = occurrence()
    const fresh = occurrence()
    await failureRows.record(old, 1, new Date(AT.getTime() - 30 * DAY - 60_000), none)
    await failureRows.record(fresh, 1, new Date(AT.getTime() - 30 * DAY + 60_000), none)

    await failureRows.purgeStale(AT)
    expect((await failureRows.latest(10)).map((row) => row.fingerprint)).toEqual([
      fresh.fingerprint,
    ])
  })

  it('база не пускает чужой источник и девятый кадр', async () => {
    await expect(
      failureRows.record(occurrence({ source: 'phone' as 'api' }), 1, AT, none),
    ).rejects.toThrow()
    const nine = Array.from({ length: 9 }, (_, index) => `at f${String(index)} (a.ts)`)
    await expect(failureRows.record(occurrence({ frames: nine }), 1, AT, none)).rejects.toThrow()
  })
})

describe('owner_notices — выдаётся один раз', () => {
  async function queue(count: number, at = AT): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      await db.insert(ownerNotices).values({ kind: 'failure', payload: notice(), createdAt: at })
    }
  }

  it('по порядку и не больше предела; выданное второй раз не выдаётся', async () => {
    await queue(3)
    expect(await notices.claim(2, AT)).toHaveLength(2)
    expect(await notices.claim(2, AT)).toHaveLength(1)
    expect(await notices.claim(2, AT)).toEqual([])
  })

  it('два claim разом делят очередь, а не выдают её дважды', async () => {
    await queue(10)
    const [first, second] = await Promise.all([notices.claim(20, AT), notices.claim(20, AT)])
    expect(first.length + second.length).toBe(10)
  })

  it('невыданное старше суток уходит, выданное живёт 30 дней', async () => {
    await queue(1, new Date(AT.getTime() - DAY - 60_000))
    await queue(1, new Date(AT.getTime() - DAY + 60_000))
    await notices.purgeStale(AT)
    expect(await db.select().from(ownerNotices)).toHaveLength(1)

    await notices.claim(20, new Date(AT.getTime() - 30 * DAY - 60_000))
    await queue(1)
    await notices.claim(20, AT)
    await notices.purgeStale(AT)
    expect(await db.select().from(ownerNotices)).toHaveLength(1)
  })

  it('вид в строке и в теле — один', async () => {
    await expect(
      db.insert(ownerNotices).values({ kind: 'failure_count', payload: notice(), createdAt: AT }),
    ).rejects.toThrow()
  })
})

describe('сбой не принадлежит человеку (Р-8 MOL-149)', () => {
  it('ни одна колонка новых таблиц не ссылается на actors', async () => {
    const references = await db.execute<{ table: string; target: string }>(sql`
      select conrelid::regclass::text as table, confrelid::regclass::text as target
      from pg_constraint
      where contype = 'f' and conrelid in ('failures'::regclass, 'owner_notices'::regclass)`)
    // The one key is a message's to the developer (MOL-148): its notice goes with it, and a
    // notice about a failure cannot carry it (`owner_notices_feedback_named`).
    expect([...references]).toEqual([{ table: 'owner_notices', target: 'feedback' }])
  })

  it('в таблице нет колонки, куда мог бы лечь человек', async () => {
    const columns = await db.execute<{ column_name: string }>(sql`
      select column_name from information_schema.columns where table_name = 'failures'
      order by ordinal_position`)
    expect([...columns].map((row) => row.column_name)).toEqual([
      'fingerprint',
      'source',
      'error_name',
      'code',
      'route',
      'frames',
      'build',
      'first_seen_at',
      'last_seen_at',
      'count',
      'build_count',
    ])
  })
})
