import type { FastifyInstance } from 'fastify'
import { getHealth } from '@/usecases/get-health'
import type { HealthProbe } from '@/usecases/get-health'
import { VERSION } from '@/env'

// A route parses, calls a use case and answers. It never reaches the database itself —
// the probe is handed to it by the composition point in server.ts.
export function healthRoutes(app: FastifyInstance, probe: HealthProbe): void {
  app.get('/health', () => getHealth(VERSION, probe))
}
