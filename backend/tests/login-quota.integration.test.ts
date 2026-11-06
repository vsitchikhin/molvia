import { randomBytes, randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ERROR, LOGIN_ADDRESS_LIMIT, LOGIN_HEADER, LOGIN_WINDOW_LIMIT } from '@molvia/model'
import { createLoginRequestRepository } from '@/db/login-requests-repository'
import { loginDays, loginRequests } from '@/db/schema'
import { buildServer } from '@/server'
import { addressMinute } from '@/usecases/address-minute'
import { startLogin } from '@/usecases/start-login'
import { connectDrizzle } from './db'
import { clearAll, fillLoginWindow } from './fixtures'
import { onlyRow, sorted } from './rows'

// The tests here that come near half a second on CI carry a timeout of their own, at least twenty
// times their worst there, rounded up to 5 s (MOL-266): their work, past a tenth of vitest's 5 s. The
// time reporter names a test at ten times, and a busy runner sets a new worst up to twice the last.

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
    const { view, secret } = await startLogin(
      requests,
      {
        limit: addressMinute(LOGIN_ADDRESS_LIMIT, LOGIN_WINDOW_LIMIT),
        address: '198.51.100.1',
        now: Date.now(),
      },
      'molvia_bot',
      null,
    )
    const code = new URL(view.url).searchParams.get('start')
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(secret).not.toBe(code)
    const row = await requests.byIdAndSecret(view.id, secret)
    expect(row).not.toBeNull()
    expect(row!.expiresAt.getTime() - row!.createdAt.getTime()).toBe(300_000)
    const stored = await first.db.select().from(loginRequests)
    for (const text of sorted(stored.map((request) => JSON.stringify(request))))
      expect(text).not.toContain(secret)
  }, 10_000)

  it('serialises the Nth and N+1th start and remembers the quota across repository instances', async () => {
    await fillLoginWindow(first.db, LOGIN_WINDOW_LIMIT - 1)
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
  }, 15_000)

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

describe('the minute of an address (MOL-359)', () => {
  const lines: string[] = []
  // A server a test: an address's minute lives in the process's memory, and one test's must not be
  // the next one's.
  let app: FastifyInstance

  beforeEach(async () => {
    lines.length = 0
    app = buildServer({
      db: first.db,
      login: { username: 'molvia_bot', botSecret: mint() },
      logStream: { write: (line) => lines.push(line) },
    })
    await app.ready()
  })
  afterEach(() => app.close())

  /** A start behind Caddy: the peer is inside, and the address is the one Caddy names last. */
  function start(forwarded: string, remoteAddress?: string) {
    return app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { [LOGIN_HEADER]: '1', 'x-forwarded-for': forwarded },
      ...(remoteAddress === undefined ? {} : { remoteAddress }),
    })
  }

  async function refused(): Promise<number> {
    return (
      onlyRow(await first.db.select({ refused: loginDays.refused }).from(loginDays))?.refused ?? 0
    )
  }

  it('the sixth start of an address is refused, another address starts in the same minute', async () => {
    for (let i = 0; i < LOGIN_ADDRESS_LIMIT; i += 1) {
      expect((await start('203.0.113.5')).statusCode).toBe(201)
    }
    const sixth = await start('203.0.113.5')
    expect(sixth.statusCode).toBe(429)
    expect(sixth.json()).toEqual({ code: ERROR.LOGIN_RATE_LIMITED })
    expect(sixth.headers['set-cookie']).toBeUndefined()
    expect((await start('198.51.100.9')).statusCode).toBe(201)
    // The refusal made no request and was counted on its day.
    expect(await first.db.select().from(loginRequests)).toHaveLength(LOGIN_ADDRESS_LIMIT + 1)
    expect(await refused()).toBe(1)
  }, 10_000)

  it('a forwarded address from a peer outside is not believed: the peer counts', async () => {
    for (let i = 0; i < LOGIN_ADDRESS_LIMIT; i += 1) {
      // A forged header names another address each time; the peer is the same.
      expect((await start(`203.0.113.${String(20 + i)}`, '192.0.2.50')).statusCode).toBe(201)
    }
    expect((await start('203.0.113.99', '192.0.2.50')).statusCode).toBe(429)
    expect((await start('203.0.113.99', '192.0.2.51')).statusCode).toBe(201)
  }, 10_000)

  it('from inside, the address Caddy names last counts, whatever the client put before it', async () => {
    for (let i = 0; i < LOGIN_ADDRESS_LIMIT; i += 1) {
      expect((await start(`10.9.9.${String(i)}, 203.0.113.5`)).statusCode).toBe(201)
    }
    expect((await start('10.9.9.99, 203.0.113.5')).statusCode).toBe(429)
  }, 10_000)

  it('an IPv6 address counts by its /48', async () => {
    for (let i = 0; i < LOGIN_ADDRESS_LIMIT; i += 1) {
      expect((await start(`2001:db8:1:${String(100 + i)}::1`)).statusCode).toBe(201)
    }
    expect((await start('2001:db8:1:ffff::9')).statusCode).toBe(429)
    expect((await start('2001:db8:2:100::1')).statusCode).toBe(201)
  }, 10_000)

  it('the three hundredth start of everybody is let in, the next refused to a new address', async () => {
    await fillLoginWindow(first.db, LOGIN_WINDOW_LIMIT - 1)
    expect((await start('203.0.113.5')).statusCode).toBe(201)
    const next = await start('198.51.100.9')
    expect(next.statusCode).toBe(429)
    expect(next.json()).toEqual({ code: ERROR.LOGIN_RATE_LIMITED })
    expect(await first.db.select().from(loginRequests)).toHaveLength(LOGIN_WINDOW_LIMIT)
    expect(await refused()).toBe(1)
  }, 10_000)

  it('the address is written nowhere: not in a request, not in the day, not in the log', async () => {
    for (let i = 0; i <= LOGIN_ADDRESS_LIMIT; i += 1) await start('203.0.113.77')
    expect(await refused()).toBe(1)
    const requestsStored = await first.db.select().from(loginRequests)
    for (const text of sorted(requestsStored.map((row) => JSON.stringify(row)))) {
      expect(text).not.toContain('203.0.113.77')
    }
    const daysStored = await first.db.select().from(loginDays)
    for (const text of sorted(daysStored.map((row) => JSON.stringify(row)))) {
      expect(text).not.toContain('203.0.113.77')
    }
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.join('\n')).not.toContain('203.0.113.77')
  }, 10_000)
})
