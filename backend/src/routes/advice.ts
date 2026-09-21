import { z } from 'zod'
import { adviceResponseSchema } from '@molvia/model'
import type { AdviceResponse } from '@molvia/model'
import type { FastifyInstance } from 'fastify'

export interface AdviceApi {
  /** The use case, already bound to its repositories by the composition point. */
  advice(actorId: string): Promise<AdviceResponse>
}

/**
 * «Что брать» (MOL-31). One route, the whole screen, and no parameters at all: whose figures
 * the answer carries follows from the person's access and never from the request.
 */
export function adviceRoutes(app: FastifyInstance, api: AdviceApi): void {
  app.get('/advice', { exposeHeadRoute: false }, async (request, reply) => {
    const answer = await api.advice(request.actorId)

    // Personal, and the owner travels in a header: nothing about this answer is cacheable.
    return reply.header('cache-control', 'no-store').send(z.encode(adviceResponseSchema, answer))
  })
}
