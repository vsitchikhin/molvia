import { isIPv6 } from 'node:net'
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
  return networkOf(
    last !== undefined && last !== '' && INTERNAL.test(request.ip) ? last : request.ip,
  )
}

/**
 * An IPv6 address counts by its `/48` (review №2, adversarial Б4, В2): one home connection has 2^64
 * addresses in its `/64`, a flat's router is usually given a `/56`, and a free tunnel hands out a whole
 * `/48` — 256 networks `/56`, each its own minute and its own hour of notices otherwise. The price: a
 * provider that gives its customers `/56` out of one `/48` puts them in one minute, as an operator's
 * CGNAT does with IPv4. An IPv4 address, or anything else, counts as it is.
 */
export function networkOf(address: string): string {
  if (!isIPv6(address) || /^::ffff:[\d.]+$/i.test(address)) return address
  const [head = '', tail = ''] = address.split('::')
  const left = head === '' ? [] : head.split(':')
  const right = tail === '' ? [] : tail.split(':')
  const groups = address.includes('::')
    ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
    : left
  return `${groups
    .slice(0, 3)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(':')}::/48`
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
