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
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { parseQuery } from '@/parse'

export interface AdviceApi {
  /**
   * The use case, already bound to its repositories by the composition point. The zone is the
   * phone's, for the day of a record from an old queue — the one «Тут дешевле» reads (MOL-166).
   */
  advice(owner: { readonly actorId: string; readonly zone?: string }): Promise<AdviceResponse>
  search(
    owner: { readonly actorId: string; readonly zone?: string },
    query: string,
  ): Promise<AdviceSearchResponse>
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
  const ownerOf = (request: FastifyRequest) => ({
    actorId: request.actorId,
    ...(request.zone ? { zone: request.zone } : {}),
  })

  app.get('/advice', { exposeHeadRoute: false }, async (request, reply) => {
    const answer = await api.advice(ownerOf(request))

    // Personal, and the owner travels in a header: nothing about this answer is cacheable.
    return reply.header('cache-control', 'no-store').send(z.encode(adviceResponseSchema, answer))
  })

  /**
   * The search on «Что брать» (MOL-128): the query string of the catalogue search, and the same
   * refusal of anything beside `q`. No HEAD twin: Fastify would run the whole search for it.
   */
  app.get('/advice/search', { exposeHeadRoute: false }, async (request, reply) => {
    const { q } = parseQuery(catalogueSearchQuerySchema, request.query)
    const answer = await api.search(ownerOf(request), q)

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
    const answer = await api.prices(ownerOf(request), query)

    return reply.header('cache-control', 'no-store').send(z.encode(ownPricesResponseSchema, answer))
  })
}
