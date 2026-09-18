import { z } from 'zod'
import {
  catalogueEntryCodec,
  catalogueEntryOf,
  catalogueSearchQuerySchema,
  catalogueSearchResponseSchema,
  proposedItemSchema,
} from '@molvia/model'
import type { Item, ProposedItem } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { parseBody, parseQuery } from '@/routes/body'

export interface CatalogueApi {
  /** The use case, already bound to its repositories by the composition point. */
  search(actorId: string, query: string): Promise<Item[]>
  propose(actorId: string, input: ProposedItem): Promise<{ item: Item; created: boolean }>
}

/**
 * The catalogue, registered inside the guarded scope: the owner is not a filter — the
 * catalogue is shared — but it chooses whose remembered picks take part in the order, and it
 * is taken from the hook, never from the request.
 */
export function catalogueRoutes(app: FastifyInstance, api: CatalogueApi): void {
  // No HEAD twin: Fastify adds one to every GET by default and runs the whole handler for it,
  // so a HEAD would search and be recorded as a visit to the catalogue.
  app.get('/catalogue/search', { exposeHeadRoute: false }, async (request, reply) => {
    const { q } = parseQuery(catalogueSearchQuerySchema, request.query)
    const items = await api.search(request.actorId, q)

    // `no-store`: the order is personal and the owner travels in a header, so a shared cache
    // would show one device what another one buys.
    return reply
      .header('cache-control', 'no-store')
      .send(z.encode(catalogueSearchResponseSchema, { items: items.map(catalogueEntryOf) }))
  })

  /**
   * «Предложить товар». 201 for a new item, 200 for one the catalogue already held: the
   * request succeeded either way, and the status is how the screen tells «added» from «it was
   * already there». The answer is the same entry the search returns, so the screen opens the
   * sheet on it exactly as it would after picking a row.
   */
  app.post('/catalogue/items', async (request, reply) => {
    const input = parseBody(proposedItemSchema, request.body)
    const { item, created } = await api.propose(request.actorId, input)

    return reply
      .code(created ? 201 : 200)
      .header('cache-control', 'no-store')
      .send(z.encode(catalogueEntryCodec, catalogueEntryOf(item)))
  })
}
