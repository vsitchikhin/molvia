/**
 * In the integration project because importing the server imports the db module, which
 * validates the environment at import time. Nothing here connects to a database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance, InjectOptions } from 'fastify'
import { FF_HEADER, FF_NAMES, type FfName } from '@molvia/model'
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
/** The server as production composes it with every фф on, and nothing a test adds. */
let all: FastifyInstance
let bare: FastifyInstance

beforeAll(async () => {
  all = buildServer({ ff: new Set(FF_NAMES) })
  bare = buildServer({ ff: new Set() })
  ;[none, venues, both] = await Promise.all([
    serverWith(new Set()),
    serverWith(new Set(['venues'])),
    serverWith(new Set(['payments', 'venues'])),
    all.ready(),
    bare.ready(),
  ])
})

afterAll(async () => {
  await Promise.all([none.close(), venues.close(), both.close(), all.close(), bare.close()])
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

/** Every route a server has, as `GET /trips/:tripId`, read off the tree Fastify prints. */
function routesOf(app: FastifyInstance): Set<string> {
  const routes = new Set<string>()
  const path: string[] = []
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const at = line.search(/[├└]── /)
    if (at < 0) continue
    const [, segment = '', methods] = /── (.*?)(?: \(([^)]*)\))?$/.exec(line.slice(at)) ?? []
    path.length = at / 4
    path.push(segment)
    for (const method of methods?.split(', ') ?? []) {
      if (method !== 'HEAD') routes.add(`${method} ${path.join('')}`)
    }
  }
  return routes
}

/** What `on` has and `off` has not: the routes its фф add. */
function featureRoutes(on: FastifyInstance, off: FastifyInstance): string[] {
  const kept = routesOf(off)
  return [...routesOf(on)].filter((route) => !kept.has(route))
}

/**
 * Each of `routes` asked of `off`, its parameters filled, that does not answer as an address the API has
 * not got — with no session, since a session would be looked up in a database here.
 */
async function answeredOtherwise(off: FastifyInstance, routes: string[]): Promise<string[]> {
  const ways = [
    { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' },
    { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' },
    { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' },
  ]
  const otherwise: string[] = []
  for (const route of routes) {
    const [method = 'GET', template = '/'] = route.split(' ')
    const url = template
      .replaceAll(/:[^/]+/g, '0f1e2d3c-4b5a-4987-a6b5-c4d3e2f1a0b9')
      .replaceAll('*', 'x')
    for (const headers of ways) {
      const as = { method: method as NonNullable<InjectOptions['method']>, headers }
      const [feature, nowhere] = await Promise.all([
        off.inject({ ...as, url }),
        off.inject({ ...as, url: '/nowhere' }),
      ])
      if (feature.statusCode !== nowhere.statusCode || feature.body !== nowhere.body) {
        otherwise.push(`${route} → ${String(feature.statusCode)}`)
      }
    }
  }
  return otherwise
}

// The probe above proves the mechanism at the root, where no other route matches. A feature's path
// beside a route that stays — `/trips/venues` beside `/trips/:tripId` — is that route's while the фф is
// off: its 401, the fetch guard's 404 (adversarial А1). So every route an фф adds is asked here.
describe('every route an фф adds, while it is off', () => {
  it('answers as an address the API has not got', async () => {
    // the reading of the tree, on what is surely there
    expect(routesOf(bare)).toContain('GET /trips/:tripId')
    expect(featureRoutes(venues, none)).toEqual(['GET /probe/venues'])
    expect(await answeredOtherwise(none, featureRoutes(venues, none))).toEqual([])
    expect(await answeredOtherwise(bare, featureRoutes(all, bare))).toEqual([])
  })

  it('is caught where a route that stays takes its path', async () => {
    const beside = buildServer({ ff: new Set(['venues']) })
    beside.get('/trips/venues', () => ({ venues: [] }))
    await beside.ready()
    try {
      expect(featureRoutes(beside, bare)).toEqual(['GET /trips/venues'])
      expect(await answeredOtherwise(bare, featureRoutes(beside, bare))).not.toEqual([])
    } finally {
      await beside.close()
    }
  })
})
