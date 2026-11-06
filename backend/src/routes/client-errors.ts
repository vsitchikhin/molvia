import { z } from 'zod'
import { clientErrorsSchema } from '@molvia/model'
import type { ClientErrors } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { parseBody, parseQuery } from '@/parse'
import { addressOf } from './address'

/** The use case, already bound to the table's reporter and the limit. */
export type TakeClientErrors = (body: ClientErrors, address: string) => void

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
