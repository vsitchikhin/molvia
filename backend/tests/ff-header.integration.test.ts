/**
 * In the integration project because importing the server imports the db module, which
 * validates the environment at import time. Nothing here connects to a database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance, InjectOptions } from 'fastify'
import { FF_HEADER, type FfName } from '@molvia/model'
import { buildServer } from '@/server'

const FF = FF_HEADER.toLowerCase()

/**
 * A server whose фф are `ff`, with a feature's route registered the way a feature registers its own:
 * only while its фф is on (MOL-382, requirement 5).
 */
async function serverWith(ff: ReadonlySet<FfName>): Promise<FastifyInstance> {
  const app = buildServer({ ff })
  if (ff.has('venues')) app.get('/probe/venues', () => ({ venues: [] }))
  app.get('/probe/ok', () => ({ ok: true }))
  app.post('/probe/body', () => ({ ok: true }))
  await app.ready()
  return app
}

let none: FastifyInstance
let venues: FastifyInstance
let both: FastifyInstance

beforeAll(async () => {
  ;[none, venues, both] = await Promise.all([
    serverWith(new Set()),
    serverWith(new Set(['venues'])),
    serverWith(new Set(['payments', 'venues'])),
  ])
})

afterAll(async () => {
  await Promise.all([none.close(), venues.close(), both.close()])
})

// Every way an answer leaves the API, as the build's header (MOL-132): the phone hears the фф from
// whatever it asked, before the login too.
describe('the фф every answer names (MOL-382)', () => {
  const ways: [string, InjectOptions, number][] = [
    ['an answer', { method: 'GET', url: '/probe/ok' }, 200],
    ['an address no route has', { method: 'GET', url: '/nowhere' }, 404],
    ['a guarded route with no session', { method: 'GET', url: '/actors/me' }, 401],
    ['a path that does not decode', { method: 'GET', url: '/nowhere/%E0' }, 400],
    [
      'a body that is not JSON',
      {
        method: 'POST',
        url: '/probe/body',
        payload: '{',
        headers: { 'content-type': 'application/json' },
      },
      400,
    ],
  ]

  it.each(ways)('is on %s', async (_name, request, status) => {
    const [off, one, two] = await Promise.all([
      none.inject(request),
      venues.inject(request),
      both.inject(request),
    ])
    for (const response of [off, one, two]) expect(response.statusCode).toBe(status)
    expect(off.headers[FF]).toBe('')
    expect(one.headers[FF]).toBe('venues')
    // in the list's order, whatever order they were turned on in
    expect(two.headers[FF]).toBe('venues,payments')
  })
})

// Off, a feature's route is not there at all: what answers is the API's «no such address», word for
// word — never a refusal that would say the feature exists, nor a 401 that puts the cookie out.
describe('a feature whose фф is off', () => {
  const asked: [string, Record<string, string>][] = [
    ['by the app with no session', { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' }],
    ['with a session', { cookie: `__Host-molvia_session=${'a'.repeat(43)}` }],
    ['from another site', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' }],
    ['by a navigation', { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' }],
  ]

  it.each(asked)('answers %s as an address the API does not have', async (_name, headers) => {
    const [feature, nowhere] = await Promise.all([
      none.inject({ method: 'GET', url: '/probe/venues', headers }),
      none.inject({ method: 'GET', url: '/nowhere', headers }),
    ])
    expect(feature.statusCode).toBe(404)
    expect(feature.body).toBe(nowhere.body)
    // every header but the moment it was sent
    expect({ ...feature.headers, date: undefined }).toEqual({ ...nowhere.headers, date: undefined })
  })

  it('answers once it is on', async () => {
    const response = await venues.inject({ method: 'GET', url: '/probe/venues' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ venues: [] })
  })
})
