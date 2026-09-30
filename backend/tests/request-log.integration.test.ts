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

// MOL-99: the code rides in the query for exactly this — a code is what a person bought.
it('logs a lookup by code as its path, without the code', async () => {
  lines.length = 0
  await app.inject({ method: 'GET', url: '/catalogue/barcode?code=4850000000007' })

  const entries = lines.map((line) => JSON.parse(line) as { msg?: string; req?: unknown })
  const incoming = entries.find((entry) => entry.msg === 'incoming request')
  expect(incoming?.req).toEqual({
    id: expect.any(String) as unknown,
    method: 'GET',
    path: '/catalogue/barcode',
  })
  expect(lines.join('')).not.toMatch(/4850000000007|code=/)
})

// MOL-100: a code written or let go of is logged no more than a code looked up.
it('logs a write of a code and its letting go as their paths, without the code', async () => {
  lines.length = 0
  const item = '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c'
  await app.inject({
    method: 'POST',
    url: `/catalogue/items/${item}/barcodes`,
    payload: { code: '4850001234562' },
  })
  await app.inject({
    method: 'DELETE',
    url: `/catalogue/items/${item}/barcodes?code=4850001234562`,
  })

  const paths = lines
    .map((line) => JSON.parse(line) as { msg?: string; req?: { path?: string } })
    .filter((entry) => entry.msg === 'incoming request')
    .map((entry) => entry.req?.path)
  expect(paths).toEqual([`/catalogue/items/${item}/barcodes`, `/catalogue/items/${item}/barcodes`])
  expect(lines.join('')).not.toMatch(/4850001234562|code=/)
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
