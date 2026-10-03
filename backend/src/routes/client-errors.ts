import { z } from 'zod'
import { clientErrorsSchema } from '@molvia/model'
import type { ClientErrors } from '@molvia/model'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { parseBody, parseQuery } from '@/parse'

/** The use case, already bound to the table's reporter and the limit. */
export type TakeClientErrors = (body: ClientErrors, address: string) => void

/** An address of the machine itself or of a private network — where Caddy talks to the API from. */
const INTERNAL =
  /^(?:::1|(?:::ffff:)?(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)[\d.]+|f[cd][\da-f:]+)$/i

/**
 * Whose minute a report counts in (MOL-144, Р-6). The API sees Caddy, so the address is the one Caddy
 * names last in `X-Forwarded-For` — it writes what it saw and drops what the client sent — and only
 * when the request came from inside, never trusted from a peer outside. Used as the limit's key and
 * nowhere else: no log, no table.
 */
function addressOf(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for']
  const last = typeof forwarded === 'string' ? forwarded.split(',').at(-1)?.trim() : undefined
  return last !== undefined && last !== '' && INTERNAL.test(request.ip) ? last : request.ip
}

/**
 * «Сбой телефона» (MOL-144): outside the guarded scope — the login screen breaks before there is a
 * session (Р-8 of MOL-149) — and a cookie that came is never read: a failure belongs to nobody. The
 * answer does not wait for the table; past the limit, 429 from the central handler.
 */
export function clientErrorsRoute(app: FastifyInstance, take: TakeClientErrors): void {
  app.post('/client-errors', async (request, reply) => {
    parseQuery(z.strictObject({}), request.query)
    take(parseBody(clientErrorsSchema, request.body), addressOf(request))
    return reply.code(204).header('cache-control', 'no-store').send()
  })
}
