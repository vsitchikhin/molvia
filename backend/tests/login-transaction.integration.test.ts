import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ERROR } from '@molvia/model'
import { authRepositories, authTransactOn } from '@/db/auth-unit-of-work'
import { actors, sessions } from '@/db/schema'
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
  return { id, secret, telegramUserId }
}

beforeEach(() => clearAll(first.db))
afterAll(async () => {
  await clearAll(first.db)
  await first.close()
  await second.close()
})

describe('atomic login', () => {
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
