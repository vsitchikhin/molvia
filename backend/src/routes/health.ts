import type { FastifyInstance } from 'fastify'
import { getHealth } from '@/usecases/get-health'
import type { HealthProbe } from '@/usecases/get-health'
import { VERSION } from '@/env'

// A route parses, calls a use case and answers. It never reaches the database itself —
// the probe is handed to it by the composition point in server.ts.
export function healthRoutes(app: FastifyInstance, probe: HealthProbe): void {
  app.get('/health', async (_request, reply) => {
    const health = await getHealth(VERSION, probe)
    // Anything but ok is 503 with the same body (MOL-142): the watch outside reads the status
    // alone, and a 200 saying «degraded» is a database down that nobody hears about.
    return reply.code(health.status === 'ok' ? 200 : 503).send(health)
  })
}
