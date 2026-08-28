import type { FastifyInstance } from 'fastify'
import { getHealth } from '../usecases/get-health'
import { VERSION } from '../env'

// A route parses, calls a use case and answers. Nothing else belongs here.
export function healthRoutes(app: FastifyInstance): void {
  app.get('/health', () => getHealth(VERSION))
}
