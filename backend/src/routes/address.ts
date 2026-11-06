import { isIPv6 } from 'node:net'
import type { FastifyRequest } from 'fastify'

/** An address of the machine itself or of a private network — where Caddy talks to the API from. */
const INTERNAL =
  /^(?:::1|(?:::ffff:)?(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)[\d.]+|f[cd][\da-f:]+)$/i

/**
 * Whose minute a request counts in — a phone's report (MOL-144, Р-6), a login's start (MOL-359). The
 * API sees Caddy, so the address is the one Caddy names last in `X-Forwarded-For` — it writes what it
 * saw and drops what the client sent — and only when the request came from inside, never trusted from a
 * peer outside. Used as a limit's key and nowhere else: no log, no table.
 */
export function addressOf(request: FastifyRequest): string {
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
