import { z } from 'zod'
import {
  adviceResponseSchema,
  adviceSearchResponseSchema,
  catalogueSearchQuerySchema,
  ownPricesQuerySchema,
  ownPricesResponseSchema,
} from '@molvia/model'
import type {
  AdviceResponse,
  AdviceSearchResponse,
  OwnPricesQuery,
  OwnPricesResponse,
} from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { parseQuery } from '@/parse'

export interface AdviceApi {
  /** The use case, already bound to its repositories by the composition point. */
  advice(actorId: string): Promise<AdviceResponse>
  search(actorId: string, query: string): Promise<AdviceSearchResponse>
  /** «Тут дешевле» (MOL-92); the zone is the phone's, for the day of a record from an old queue. */
  prices(
    owner: { readonly actorId: string; readonly zone?: string },
    query: OwnPricesQuery,
  ): Promise<OwnPricesResponse>
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

  /**
   * «Тут дешевле» on the sheet of a purchase (MOL-92): the person's own last prices of an item in
   * the record's city, and the alternatives of its kind. The item in the query, as every lookup
   * here is. It writes nothing.
   */
  app.get('/advice/prices', { exposeHeadRoute: false }, async (request, reply) => {
    const query = parseQuery(ownPricesQuerySchema, request.query)
    const owner = { actorId: request.actorId, ...(request.zone ? { zone: request.zone } : {}) }
    const answer = await api.prices(owner, query)

    return reply.header('cache-control', 'no-store').send(z.encode(ownPricesResponseSchema, answer))
  })
}
