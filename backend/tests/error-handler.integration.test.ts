/**
 * In the integration project because importing the server imports the db module, which
 * validates the environment at import time. Nothing here connects to a database.
 */
import { describe, expect, it } from 'vitest'
import { ERROR, ISSUE, newExpenseSchema } from '@molvia/model'
import { buildServer } from '@/server'

const UUID = '11111111-1111-4111-8111-111111111111'

async function post(payload: unknown): Promise<{ status: number; body: unknown }> {
  const app = buildServer()
  // A route in the shape the rules prescribe: parse, and let the central handler assign
  // the status, because a route never writes try/catch -> 400 itself.
  app.post('/probe', (request) => {
    const parsed = newExpenseSchema.safeParse(request.body)
    if (!parsed.success) throw parsed.error
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
})
