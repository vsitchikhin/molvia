import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'

/**
 * What a request leaves in the log (MOL-58): method and path. Not the address, not the port, not
 * the host — and not the query, because for the catalogue search the query is what a person was
 * looking for. The log lives up to fourteen days; what is not written does not need a term.
 */
const { db, close } = connectDrizzle()
const lines: string[] = []
const app = buildServer({ db, logStream: { write: (line) => lines.push(line) } })
beforeAll(() => app.ready())
afterAll(async () => {
  await app.close()
  await close()
})

it('logs a search as its path, without what was searched for or who asked', async () => {
  await app.inject({
    method: 'GET',
    url: '/catalogue/search?q=%D0%BC%D0%BE%D0%BB%D0%BE%D0%BA%D0%BE',
    remoteAddress: '203.0.113.7',
  })

  const entries = lines.map((line) => JSON.parse(line) as { msg?: string; req?: unknown })
  const incoming = entries.find((entry) => entry.msg === 'incoming request')
  expect(incoming?.req).toEqual({
    id: expect.any(String) as unknown,
    method: 'GET',
    path: '/catalogue/search',
  })
  const log = lines.join('')
  expect(log).not.toContain('203.0.113.7')
  expect(log).not.toMatch(/молоко|%D0%BC|q=/i)
  expect(log).not.toMatch(/remoteAddress|remotePort|hostname"?:"?localhost/)
})

// Selfreview 4: Fastify's own 404 wrote `Route GET:/path?q=… not found` past the serializer.
it('an unknown address is not logged with its query, nor echoed back', async () => {
  lines.length = 0
  const response = await app.inject({
    method: 'GET',
    url: '/catalogue/serch?q=%D0%BC%D0%BE%D0%BB%D0%BE%D0%BA%D0%BE',
  })

  expect(response.statusCode).toBe(404)
  expect(response.body).not.toMatch(/serch|q=|%D0/)
  expect(lines.join('')).not.toMatch(/q=|%D0|молоко/)
})
