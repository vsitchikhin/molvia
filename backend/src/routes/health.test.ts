import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { healthRoutes } from './health'
import { VERSION } from '@/env'

describe('GET /health', () => {
  const apps: FastifyInstance[] = []
  afterEach(async () => {
    await Promise.all(apps.splice(0).map(async (app) => app.close()))
  })

  async function answer(databaseIsReachable: boolean) {
    const app = Fastify()
    apps.push(app)
    healthRoutes(app, { databaseIsReachable: async () => Promise.resolve(databaseIsReachable) })
    return app.inject({ method: 'GET', url: '/health' })
  }

  it('is 200 and ok while the database answers', async () => {
    const response = await answer(true)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', version: VERSION, database: 'up' })
  })

  it('is 503 with the same body when the database does not answer (MOL-142)', async () => {
    const response = await answer(false)

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'degraded', version: VERSION, database: 'down' })
  })
})
