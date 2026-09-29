/**
 * In the integration project because importing the server imports the db module, which
 * validates the environment at import time. Nothing here connects to a database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { DomainError, ERROR, VERSION_HEADER } from '@molvia/model'
import { VERSION } from '@/env'
import { buildServer } from '@/server'

let app: FastifyInstance

beforeAll(async () => {
  app = buildServer()
  app.get('/probe/ok', () => ({ ok: true }))
  app.get('/probe/refused', () => {
    throw new DomainError(ERROR.NOT_FOUND)
  })
  app.get('/probe/broken', () => {
    throw new Error('a fault of the server')
  })
  app.post('/probe/body', () => ({ ok: true }))
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

// Every way an answer leaves the API: the build it names is how an open page learns the server
// was rolled out under it — and the answer it can no longer read is the one that matters most.
describe('the build every answer names (MOL-132)', () => {
  it.each([
    ['an answer', { method: 'GET', url: '/probe/ok' }, 200],
    ['a refusal of the domain', { method: 'GET', url: '/probe/refused' }, 404],
    ['a fault of the server', { method: 'GET', url: '/probe/broken' }, 500],
    ['an address no route has', { method: 'GET', url: '/nowhere' }, 404],
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
  ] as const)('is on %s', async (_name, request, status) => {
    const response = await app.inject(request)
    expect(response.statusCode).toBe(status)
    expect(response.headers[VERSION_HEADER.toLowerCase()]).toBe(VERSION)
  })
})
