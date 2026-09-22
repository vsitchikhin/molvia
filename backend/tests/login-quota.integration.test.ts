import { randomBytes, randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ERROR, LOGIN_WINDOW_LIMIT } from '@molvia/model'
import { createLoginRequestRepository } from '@/db/login-requests-repository'
import { loginRequests } from '@/db/schema'
import { startLogin } from '@/usecases/start-login'
import { connectDrizzle } from './db'
import { clearAll } from './fixtures'

const first = connectDrizzle()
const second = connectDrizzle()
const requests = createLoginRequestRepository(first.db)
const mint = (): string => randomBytes(32).toString('base64url')

beforeEach(() => clearAll(first.db))
afterAll(async () => {
  await clearAll(first.db)
  await first.close()
  await second.close()
})

describe('login quota and lifetime', () => {
  it('starts with independent secrets and five minutes, without calling Telegram', async () => {
    const { view, secret } = await startLogin(requests, 'molvia_bot', null)
    const code = new URL(view.url).searchParams.get('start')
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(secret).not.toBe(code)
    const row = await requests.byIdAndSecret(view.id, secret)
    expect(row).not.toBeNull()
    expect(row!.expiresAt.getTime() - row!.createdAt.getTime()).toBe(300_000)
    expect(JSON.stringify(await first.db.select().from(loginRequests))).not.toContain(secret)
  })

  it('serialises the Nth and N+1th start and remembers the quota across repository instances', async () => {
    for (let i = 0; i < LOGIN_WINDOW_LIMIT - 1; i += 1) {
      await requests.createLimited(randomUUID(), mint(), mint(), null)
    }
    const other = createLoginRequestRepository(second.db)
    const results = await Promise.allSettled([
      requests.createLimited(randomUUID(), mint(), mint(), null),
      other.createLimited(randomUUID(), mint(), mint(), null),
    ])
    expect(results.filter((value) => value.status === 'fulfilled')).toHaveLength(1)
    expect(await first.db.select().from(loginRequests)).toHaveLength(LOGIN_WINDOW_LIMIT)
    await expect(other.createLimited(randomUUID(), mint(), mint(), null)).rejects.toMatchObject({
      code: ERROR.LOGIN_RATE_LIMITED,
    })

    // Consuming/declining does not free a place in the rate window.
    await first.db.update(loginRequests).set({ consumedAt: sql`now()` })
    await expect(requests.createLimited(randomUUID(), mint(), mint(), null)).rejects.toMatchObject({
      code: ERROR.LOGIN_RATE_LIMITED,
    })
    await first.db.update(loginRequests).set({ createdAt: sql`now() - interval '60 seconds'` })
    await expect(requests.createLimited(randomUUID(), mint(), mint(), null)).resolves.toBeTruthy()
  })

  it('deletes expired rows, including consumed ones, and retains live requests', async () => {
    await requests.createLimited(randomUUID(), mint(), mint(), null)
    await first.db.update(loginRequests).set({
      createdAt: sql`now() - interval '5 minutes'`,
      expiresAt: sql`now()`,
      consumedAt: sql`now()`,
    })
    const live = await requests.createLimited(randomUUID(), mint(), mint(), null)
    expect(await first.db.select().from(loginRequests)).toHaveLength(1)
    await requests.removeExpired()
    expect((await first.db.select().from(loginRequests)).map((row) => row.id)).toEqual([live.id])
  })
})
