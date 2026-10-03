/**
 * The API's metrics through a real server (MOL-145): every label is a route's template, never what a
 * request named, and `/metrics` answers only on its own port.
 */
import { randomUUID } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { httpMetrics } from '@/metrics'
import type { HttpMetrics } from '@/metrics'
import { METRICS_CONTENT_TYPE, buildMetricsServer } from '@/metrics-server'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll } from './fixtures'

const { db, close } = connectDrizzle()

let metrics: HttpMetrics
let app: FastifyInstance
let recordings: Promise<void>[] = []

beforeEach(async () => {
  metrics = httpMetrics()
  recordings = []
  app = buildServer({
    db,
    owner: null,
    metrics,
    failureRecorded: (recording) => recordings.push(recording),
    logStream: { write: () => undefined },
  })
  // A route that fails as a defect does, for the class of 5xx.
  app.get('/probe/:id', () => {
    throw new Error('boom')
  })
  // A route stuck as a lock or the wallet's chain once held one, answering after its client gave up.
  app.get('/probe-slow/:outcome', async (request) => {
    await sleep(300)
    if ((request.params as { outcome: string }).outcome === 'fail') throw new Error('late boom')
    return { ok: true }
  })
  await app.ready()
})
afterEach(async () => {
  await Promise.allSettled(recordings)
  await app.close()
})
afterAll(async () => {
  await clearAll(db)
  await close()
})

/** The series of the request counter, as `{labels} count`. */
function requestSeries(): string[] {
  return metrics
    .render()
    .split('\n')
    .filter((line) => line.startsWith('molvia_http_requests_total{'))
    .map((line) => line.slice('molvia_http_requests_total'.length))
}

describe('the labels of an answer', () => {
  it('are the template of the route, never the uuid in the path', async () => {
    await app.inject({ method: 'GET', url: `/trips/${randomUUID()}` })
    await app.inject({ method: 'GET', url: `/trips/${randomUUID()}` })

    expect(requestSeries()).toEqual(['{method="GET",route="/trips/:tripId",status="4xx"} 2'])
  })

  it('never carry the query', async () => {
    await app.inject({ method: 'GET', url: '/catalogue/search?q=молоко' })
    await app.inject({
      method: 'GET',
      url: '/catalogue/search?q=%D0%BC%D0%BE%D0%BB%D0%BE%D0%BA%D0%BE',
    })

    const text = metrics.render()
    expect(text).not.toContain('молоко')
    expect(text).not.toContain('q=')
    expect(requestSeries()).toEqual(['{method="GET",route="/catalogue/search",status="4xx"} 2'])
  })

  it('make a hundred unknown paths one series', async () => {
    for (let index = 0; index < 100; index += 1) {
      await app.inject({
        method: index % 2 === 0 ? 'GET' : 'POST',
        url: `/nowhere/${randomUUID()}`,
      })
    }

    expect(requestSeries()).toEqual(['{method="*",route="unmatched",status="4xx"} 100'])
    expect(metrics.render()).not.toContain('nowhere')
  })

  it('count HEAD as the GET it is answered by', async () => {
    await app.inject({ method: 'HEAD', url: '/health' })
    await app.inject({ method: 'GET', url: '/health' })

    expect(requestSeries()).toEqual(['{method="GET",route="/health",status="2xx"} 2'])
  })

  it('put a failure in the class of 5xx', async () => {
    await app.inject({ method: 'GET', url: `/probe/${randomUUID()}` })

    expect(requestSeries()).toEqual(['{method="GET",route="/probe/:id",status="5xx"} 1'])
  })

  it('time every answer into the histogram of its route', async () => {
    await app.inject({ method: 'GET', url: '/health' })

    expect(metrics.render()).toMatch(
      /^molvia_http_request_duration_seconds_count\{method="GET",route="\/health"\} 1$/m,
    )
  })
})

describe('a request its client left before the answer (adversarial А1)', () => {
  /** A GET over a real socket, given up after `ms`, as the phone gives up after 15 s. */
  async function abandon(path: string, ms: number): Promise<void> {
    await app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = app.server.address() as AddressInfo
    await new Promise<void>((resolve) => {
      const request = http.get({ host: '127.0.0.1', port, path })
      request.on('error', () => {
        resolve()
      })
      setTimeout(() => {
        request.destroy()
      }, ms)
    })
    // The handler runs on into the closed socket.
    await sleep(400)
  }

  it('is counted once, as aborted, with the time it ran until the client left', async () => {
    await abandon('/probe-slow/ok', 100)

    expect(requestSeries()).toEqual([
      '{method="GET",route="/probe-slow/:outcome",status="aborted"} 1',
    ])
    expect(metrics.render()).toMatch(
      /^molvia_http_request_duration_seconds_count\{method="GET",route="\/probe-slow\/:outcome"\} 1$/m,
    )
  })

  it('a failure after the client left is aborted in the metrics and recorded as a failure', async () => {
    await abandon('/probe-slow/fail', 100)
    await Promise.allSettled(recordings)

    expect(requestSeries()).toEqual([
      '{method="GET",route="/probe-slow/:outcome",status="aborted"} 1',
    ])
    expect(recordings.length).toBeGreaterThan(0)
  })
})

describe('/metrics', () => {
  it('is no address of the API, so Caddy has nothing to reach', async () => {
    for (const url of ['/metrics', '/%6Detrics', '//metrics', '/metrics/', '/Metrics']) {
      const response = await app.inject({ method: 'GET', url })
      expect(response.statusCode, url).toBe(404)
    }
  })

  it('answers on its own server in the text format, and nothing else does', async () => {
    await app.inject({ method: 'GET', url: '/health' })
    const server = buildMetricsServer([metrics])
    try {
      const response = await server.inject({ method: 'GET', url: '/metrics' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe(METRICS_CONTENT_TYPE)
      expect(response.body).toContain('route="/health"')

      expect((await server.inject({ method: 'GET', url: '/health' })).statusCode).toBe(404)
    } finally {
      await server.close()
    }
  })
})
