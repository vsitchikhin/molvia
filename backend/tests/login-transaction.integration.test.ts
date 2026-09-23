import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { ERROR } from '@molvia/model'
import { authRepositories, authTransactOn } from '@/db/auth-unit-of-work'
import { actors, loginRequests, sessions } from '@/db/schema'
import { completeLogin } from '@/usecases/complete-login'
import { connectDrizzle } from './db'
import { anHourFromNow, clearAll, telegramId } from './fixtures'

const first = connectDrizzle()
const second = connectDrizzle()
const repositories = authRepositories(first.db)
const transact = authTransactOn(first.db)

async function confirmed(telegramUserId = telegramId()) {
  const id = randomUUID()
  const code = randomBytes(32).toString('base64url')
  const secret = randomBytes(32).toString('base64url')
  await repositories.requests.create(id, code, secret, 'iPhone · Safari', anHourFromNow())
  await repositories.requests.confirm(code, telegramUserId)
  return { id, code, secret, telegramUserId }
}

beforeEach(() => clearAll(first.db))
afterAll(async () => {
  await clearAll(first.db)
  await first.close()
  await second.close()
})

describe('atomic login', () => {
  it('checks expiry after taking the row lock, even in an older transaction', async () => {
    const request = await confirmed()
    await first.db.transaction(async (tx) => {
      await tx
        .update(loginRequests)
        .set({
          createdAt: sql`now() - interval '5 minutes'`,
          expiresAt: sql`now()`,
        })
        .where(eq(loginRequests.id, request.id))
      await expect(
        completeLogin((work) => work(authRepositories(tx)), request.id, request.secret),
      ).rejects.toMatchObject({ code: ERROR.LOGIN_UNAVAILABLE })
    })
    expect(await first.db.select().from(sessions)).toHaveLength(0)
  })

  it('confirm and decline racing cannot leave an available login', async () => {
    const request = await confirmed()
    await first.db
      .update(loginRequests)
      .set({ telegramUserId: null })
      .where(eq(loginRequests.id, request.id))
    const other = authRepositories(second.db).requests
    await Promise.all([
      repositories.requests.confirm(request.code, request.telegramUserId),
      other.decline(request.code),
    ])
    expect(await repositories.requests.byIdAndSecret(request.id, request.secret)).toBeNull()
    await expect(completeLogin(transact, request.id, request.secret)).rejects.toMatchObject({
      code: ERROR.LOGIN_UNAVAILABLE,
    })
    expect(await first.db.select().from(sessions)).toHaveLength(0)
  })

  it('competing confirmations cannot replace the winning account', async () => {
    const request = await confirmed()
    await first.db
      .update(loginRequests)
      .set({ telegramUserId: null })
      .where(eq(loginRequests.id, request.id))
    const otherId = telegramId()
    const results = await Promise.all([
      repositories.requests.confirm(request.code, request.telegramUserId),
      authRepositories(second.db).requests.confirm(request.code, otherId),
    ])
    const winners = results.filter((value) => value !== null)
    expect(winners).toHaveLength(1)
    expect(
      (await repositories.requests.byIdAndSecret(request.id, request.secret))?.telegramUserId,
    ).toBe(winners[0]?.telegramUserId)
  })

  it('collection and decline are ordered: either a session or a successful refusal', async () => {
    const request = await confirmed()
    const results = await Promise.allSettled([
      completeLogin(transact, request.id, request.secret),
      authRepositories(second.db).requests.decline(request.code),
    ])
    const written = await first.db.select().from(sessions)
    if (results[0].status === 'fulfilled') {
      expect(written).toHaveLength(1)
      expect(results[1]).toMatchObject({ status: 'fulfilled', value: null })
    } else {
      expect(written).toHaveLength(0)
      expect(results[1]).toMatchObject({ status: 'fulfilled', value: { id: request.id } })
    }
    expect(await repositories.requests.byIdAndSecret(request.id, request.secret)).toBeNull()
  })

  it('two simultaneous polls issue exactly one session', async () => {
    const request = await confirmed()
    const results = await Promise.allSettled([
      completeLogin(transact, request.id, request.secret),
      completeLogin(authTransactOn(second.db), request.id, request.secret),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await first.db.select().from(sessions)).toHaveLength(1)
    expect(await repositories.requests.byIdAndSecret(request.id, request.secret)).toBeNull()
  })

  it('two first logins share one owner, without aborting either transaction', async () => {
    const telegramUserId = telegramId()
    const a = await confirmed(telegramUserId)
    const b = await confirmed(telegramUserId)
    const results = await Promise.all([
      completeLogin(transact, a.id, a.secret),
      completeLogin(authTransactOn(second.db), b.id, b.secret),
    ])
    expect(results.map((result) => result.status)).toEqual(['authenticated', 'authenticated'])
    expect(await first.db.select().from(actors)).toHaveLength(1)
    const written = await first.db.select().from(sessions)
    expect(written).toHaveLength(2)
    expect(written[0]?.actorId).toBe(written[1]?.actorId)
    expect(written.map((row) => row.deviceName)).toEqual(['iPhone · Safari', 'iPhone · Safari'])
  })

  it('a session failure rolls back consumption and a newly created owner', async () => {
    const request = await confirmed()
    await expect(
      completeLogin(
        (work) =>
          first.db.transaction((tx) => {
            const data = authRepositories(tx)
            return work({
              ...data,
              sessions: {
                ...data.sessions,
                create: () => Promise.reject(new Error('disk failure')),
              },
            })
          }),
        request.id,
        request.secret,
      ),
    ).rejects.toThrow('disk failure')
    expect(await first.db.select().from(actors)).toHaveLength(0)
    expect(await first.db.select().from(sessions)).toHaveLength(0)
    expect(await repositories.requests.byIdAndSecret(request.id, request.secret)).not.toBeNull()
    expect((await completeLogin(transact, request.id, request.secret)).status).toBe('authenticated')
  })

  it('a missing or foreign secret cannot consume the request', async () => {
    const request = await confirmed()
    for (const secret of ['', randomBytes(32).toString('base64url')]) {
      await expect(completeLogin(transact, request.id, secret)).rejects.toMatchObject({
        code: ERROR.LOGIN_UNAVAILABLE,
      })
    }
    expect(await first.db.select().from(sessions)).toHaveLength(0)
    expect(await repositories.requests.byIdAndSecret(request.id, request.secret)).not.toBeNull()
  })
})
