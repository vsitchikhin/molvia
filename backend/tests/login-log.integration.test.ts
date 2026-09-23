import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { ERROR } from '@molvia/model'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { telegramId } from './fixtures'

// A connection closed before the first request: every query fails inside the driver, and the
// driver's message is the SQL with its parameters — for `confirm`, the Telegram id (selfreview З-1).
const { db, close } = connectDrizzle()
const lines: string[] = []
const botSecret = randomBytes(32).toString('base64url')
const app = buildServer({
  db,
  login: { username: 'molvia_bot', botSecret },
  logStream: { write: (line) => lines.push(line) },
})
beforeAll(async () => {
  await close()
  await app.ready()
})
afterAll(() => app.close())

it.each([
  '/internal/auth/login',
  // Adversarial Б2: the router decodes this to the same route, and it must log the same way.
  '/internal/%61uth/login',
])(
  'a failed login at %s logs the name and the driver code, never the query or its parameters',
  async (prefix) => {
    lines.length = 0
    const account = telegramId()
    const response = await app.inject({
      method: 'POST',
      url: `${prefix}/${randomBytes(32).toString('base64url')}/confirm`,
      headers: { authorization: `Bearer ${botSecret}` },
      payload: { telegramUserId: account },
    })
    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({ code: ERROR.INTERNAL })

    const log = lines.join('')
    expect(log).not.toContain(String(account))
    expect(log).not.toMatch(/Failed query|login_requests|params/i)
    const failure = lines
      .map((line) => JSON.parse(line) as { msg?: string; errorName?: string; code?: string })
      .find((entry) => entry.msg === 'authentication failed')
    expect(failure?.errorName).toBeTruthy()
    expect(failure?.code).toMatch(/^[\dA-Z_]+$/)
  },
)
