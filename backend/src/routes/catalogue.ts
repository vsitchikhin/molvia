import { z } from 'zod'
import {
  catalogueEntryOf,
  catalogueSearchQuerySchema,
  catalogueSearchResponseSchema,
} from '@molvia/model'
import type { Item } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { parseQuery } from '@/routes/body'

export interface CatalogueApi {
  /** The use case, already bound to its repositories by the composition point. */
  search(actorId: string, query: string): Promise<Item[]>
}

/**
 * The catalogue, registered inside the guarded scope: the owner is not a filter — the
 * catalogue is shared — but it chooses whose remembered picks take part in the order, and it
 * is taken from the hook, never from the request.
 */
export function catalogueRoutes(app: FastifyInstance, api: CatalogueApi): void {
  app.get('/catalogue/search', async (request, reply) => {
    const { q } = parseQuery(catalogueSearchQuerySchema, request.query)
    const items = await api.search(request.actorId, q)

    // `no-store`: the order is personal and the owner travels in a header, so a shared cache
    // would show one device what another one buys.
    return reply
      .header('cache-control', 'no-store')
      .send(z.encode(catalogueSearchResponseSchema, { items: items.map(catalogueEntryOf) }))
  })
}
