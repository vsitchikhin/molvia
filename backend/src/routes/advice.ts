import { z } from 'zod'
import {
  adviceResponseSchema,
  adviceSearchResponseSchema,
  catalogueSearchQuerySchema,
} from '@molvia/model'
import type { AdviceResponse, AdviceSearchResponse } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { parseQuery } from '@/parse'

export interface AdviceApi {
  /** The use case, already bound to its repositories by the composition point. */
  advice(actorId: string): Promise<AdviceResponse>
  search(actorId: string, query: string): Promise<AdviceSearchResponse>
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

  /**
   * The search on «Что брать» (MOL-128): the query string of the catalogue search, and the same
   * refusal of anything beside `q`. No HEAD twin: Fastify would run the whole search for it.
   */
  app.get('/advice/search', { exposeHeadRoute: false }, async (request, reply) => {
    const { q } = parseQuery(catalogueSearchQuerySchema, request.query)
    const answer = await api.search(request.actorId, q)

    return reply
      .header('cache-control', 'no-store')
      .send(z.encode(adviceSearchResponseSchema, answer))
  })
}
