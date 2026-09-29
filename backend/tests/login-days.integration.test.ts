import { randomBytes, randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ERROR, LOGIN_WINDOW_LIMIT } from '@molvia/model'
import { authRepositories, authTransactOn } from '@/db/auth-unit-of-work'
import { createLoginRequestRepository } from '@/db/login-requests-repository'
import { loginDays, loginRequests, sessions } from '@/db/schema'
import { completeLogin } from '@/usecases/complete-login'
import { connectDrizzle } from './db'
import { clearAll, telegramId } from './fixtures'

const first = connectDrizzle()
const second = connectDrizzle()
const requests = createLoginRequestRepository(first.db)
const transact = authTransactOn(first.db)
const mint = (): string => randomBytes(32).toString('base64url')

beforeEach(() => clearAll(first.db))
afterAll(async () => {
  await clearAll(first.db)
  await first.close()
  await second.close()
})

type Day = Omit<typeof loginDays.$inferSelect, 'day'>

const NOTHING: Day = {
  started: 0,
  again: 0,
  confirmed: 0,
  declined: 0,
  collected: 0,
  expiredUnconfirmed: 0,
  expiredConfirmed: 0,
  refused: 0,
}

async function days(): Promise<Record<string, Day>> {
  const rows = await first.db.select().from(loginDays).orderBy(loginDays.day)
  return Object.fromEntries(rows.map(({ day, ...counts }) => [day, counts]))
}

async function today(): Promise<string> {
  const [row] = await first.db.execute<{ day: string }>(
    sql`select to_char((now() at time zone 'UTC') + interval '4 hours', 'YYYY-MM-DD') as day`,
  )
  return row!.day
}

async function started(again = false) {
  const id = randomUUID()
  const code = mint()
  const secret = mint()
  await requests.createLimited(id, code, secret, 'iPhone · Safari', again)
  return { id, code, secret }
}

/** Puts a request out of its five minutes, the way the clock would. */
async function runOut(id: string): Promise<void> {
  await first.db
    .update(loginRequests)
    .set({ expiresAt: sql`clock_timestamp()` })
    .where(eq(loginRequests.id, id))
}

describe('login_days: the funnel is counted where each step happens (MOL-68)', () => {
  it('counts a start, and a start the device says is a repeat both as started and as again', async () => {
    await started()
    await started(true)
    expect(await days()).toEqual({ [await today()]: { ...NOTHING, started: 2, again: 1 } })
  })

  it('counts the first «Войти» only: the same account again and another account add nothing', async () => {
    const request = await started()
    const person = telegramId()
    expect(await requests.confirm(request.code, person)).not.toBeNull()
    expect(await requests.confirm(request.code, person)).not.toBeNull()
    expect(await requests.confirm(request.code, telegramId())).toBeNull()
    expect((await days())[await today()]).toEqual({ ...NOTHING, started: 1, confirmed: 1 })
  })

  it('counts «Это не я» once, and not over a login already collected', async () => {
    const declined = await started()
    expect(await requests.decline(declined.code)).not.toBeNull()
    expect(await requests.decline(declined.code)).toBeNull()

    const collected = await started()
    await requests.confirm(collected.code, telegramId())
    await completeLogin(transact, collected.id, collected.secret)
    expect(await requests.decline(collected.code)).toBeNull()

    expect((await days())[await today()]).toEqual({
      ...NOTHING,
      started: 2,
      confirmed: 1,
      declined: 1,
      collected: 1,
    })
  })

  it('counts a collection once when two polls race for it', async () => {
    const request = await started()
    await requests.confirm(request.code, telegramId())
    const results = await Promise.allSettled([
      completeLogin(transact, request.id, request.secret),
      completeLogin(authTransactOn(second.db), request.id, request.secret),
    ])
    expect(results.filter((result) => result.status === 'fulfilled').length).toBeGreaterThan(0)
    expect(await first.db.select().from(sessions)).toHaveLength(1)
    expect((await days())[await today()]?.collected).toBe(1)
  })

  it('does not count a collection whose transaction rolled back', async () => {
    const request = await started()
    await requests.confirm(request.code, telegramId())
    await expect(
      first.db.transaction(async (tx) => {
        await completeLogin((work) => work(authRepositories(tx)), request.id, request.secret)
        throw new Error('the session was never written')
      }),
    ).rejects.toThrow('the session was never written')
    expect((await days())[await today()]?.collected).toBe(0)
  })

  it('splits what ran out into confirmed and not, and leaves what already had an outcome', async () => {
    const neverConfirmed = await started()
    const confirmedOnly = await started()
    await requests.confirm(confirmedOnly.code, telegramId())
    const declined = await started()
    await requests.decline(declined.code)
    const collected = await started()
    await requests.confirm(collected.code, telegramId())
    await completeLogin(transact, collected.id, collected.secret)
    for (const request of [neverConfirmed, confirmedOnly, declined, collected]) {
      await runOut(request.id)
    }

    await requests.removeExpired()
    await requests.removeExpired()

    expect(await first.db.select().from(loginRequests)).toHaveLength(0)
    expect((await days())[await today()]).toEqual({
      ...NOTHING,
      started: 4,
      confirmed: 2,
      declined: 1,
      collected: 1,
      expiredUnconfirmed: 1,
      expiredConfirmed: 1,
    })
  })

  it('counts what the start of a login cleans up, as the minute timer does', async () => {
    const request = await started()
    await runOut(request.id)
    await started()
    expect((await days())[await today()]).toEqual({
      ...NOTHING,
      started: 2,
      expiredUnconfirmed: 1,
    })
  })

  it('does not count a row the cleanup skipped because somebody held it', async () => {
    const request = await started()
    await runOut(request.id)
    await second.db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from login_requests where id = ${request.id} for update`)
      await requests.removeExpired()
      expect((await days())[await today()]?.expiredUnconfirmed).toBe(0)
    })
    await requests.removeExpired()
    expect((await days())[await today()]?.expiredUnconfirmed).toBe(1)
  })

  it('counts a start the quota turned away on the day of the refusal, and makes no request', async () => {
    for (let i = 0; i < LOGIN_WINDOW_LIMIT; i += 1) await started()
    await expect(started()).rejects.toMatchObject({ code: ERROR.LOGIN_RATE_LIMITED })
    await expect(started(true)).rejects.toMatchObject({ code: ERROR.LOGIN_RATE_LIMITED })
    expect(await first.db.select().from(loginRequests)).toHaveLength(LOGIN_WINDOW_LIMIT)
    expect((await days())[await today()]).toEqual({
      ...NOTHING,
      started: LOGIN_WINDOW_LIMIT,
      refused: 2,
    })
  })

  it('files every step under the day the login began in Yerevan, not the day of the step', async () => {
    const request = await started()
    // 23:59:59.999999 in Yerevan on the 20th, and a microsecond is enough to be the 21st.
    await first.db
      .update(loginRequests)
      .set({ createdAt: sql`'2026-09-20T19:59:59.999999Z'::timestamptz` })
      .where(eq(loginRequests.id, request.id))
    const late = await started()
    await first.db
      .update(loginRequests)
      .set({ createdAt: sql`'2026-09-20T20:00:00Z'::timestamptz` })
      .where(eq(loginRequests.id, late.id))

    await requests.confirm(request.code, telegramId())
    await completeLogin(transact, request.id, request.secret)
    await requests.decline(late.code)

    const counted = await days()
    expect(counted['2026-09-20']).toEqual({ ...NOTHING, confirmed: 1, collected: 1 })
    expect(counted['2026-09-21']).toEqual({ ...NOTHING, declined: 1 })
  })

  it('holds nothing that names a person, a device or a request', async () => {
    const request = await started()
    const person = telegramId()
    await requests.confirm(request.code, person)
    await completeLogin(transact, request.id, request.secret)
    const stored = JSON.stringify(await first.db.select().from(loginDays))
    for (const trace of [request.id, request.code, String(person), 'iPhone']) {
      expect(stored).not.toContain(trace)
    }
  })
})
