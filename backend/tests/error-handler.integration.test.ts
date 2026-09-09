/**
 * In the integration project because importing the server imports the db module, which
 * validates the environment at import time. Nothing here connects to a database.
 */
import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { ERROR, ISSUE, newExpenseSchema } from '@molvia/model'
import { parseBody } from '@/routes/body'
import { buildServer } from '@/server'

const UUID = '11111111-1111-4111-8111-111111111111'

async function post(payload: unknown): Promise<{ status: number; body: unknown }> {
  const app = buildServer()
  // A route in the shape the rules prescribe: parse, and let the central handler assign
  // the status, because a route never writes try/catch -> 400 itself.
  app.post('/probe', (request) => {
    parseBody(newExpenseSchema, request.body)
    return { ok: true }
  })
  await app.ready()
  const response = await app.inject({ method: 'POST', url: '/probe', payload: payload as object })
  await app.close()
  return { status: response.statusCode, body: JSON.parse(response.body) }
}

describe('a body that did not parse', () => {
  it('comes back 400 and names the field, not 500 «internal»', async () => {
    const res = await post({ tripId: 'nope', itemId: 'nope' })
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: ISSUE.BODY_INVALID, details: 'tripId' })
  })

  it('carries the registry code the codecs were rewritten to report', async () => {
    // Round one rewrote the codecs so safeParse returns an issue instead of throwing.
    // Until the handler learned about ZodError, that made this case worse, not better:
    // it used to be a DomainError and a 400, and became a 500.
    const res = await post({
      tripId: UUID,
      itemId: UUID,
      amount: { amount: 'ne chislo', currency: 'AMD' },
    })
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: ERROR.INVALID_AMOUNT })
  })

  it('refuses a field the server owns rather than ignoring it', async () => {
    const res = await post({ tripId: UUID, itemId: UUID, id: UUID })
    expect(res.status).toBe(400)
  })

  it('lets a well-formed body through', async () => {
    const res = await post({ tripId: UUID, itemId: UUID })
    expect(res.status).toBe(200)
  })

  it('does not dress the server’s own parse failure as the client’s mistake', async () => {
    // A row read from the database that no longer matches its schema — a half-applied
    // migration, a widened enum — used to come back as 400 naming a field the client
    // never sent, and stopped being logged at all.
    const app = buildServer()
    app.get('/stale', () => {
      throw new ZodError([
        { code: 'custom', path: ['defaultUnit'], message: 'error.invalid_amount', input: 'litre' },
      ])
    })
    await app.ready()
    const response = await app.inject({ method: 'GET', url: '/stale' })
    await app.close()

    expect(response.statusCode).toBe(500)
    expect(JSON.parse(response.body)).toEqual({ code: ERROR.INTERNAL })
  })
})
