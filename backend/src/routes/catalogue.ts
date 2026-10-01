import { z } from 'zod'
import {
  attachBarcodeBodySchema,
  barcodeTakenSchema,
  catalogueBarcodeHintQuerySchema,
  catalogueBarcodeHintResponseSchema,
  catalogueBarcodeQuerySchema,
  catalogueBarcodeResponseSchema,
  catalogueEntryCodec,
  catalogueEntryOf,
  catalogueSearchQuerySchema,
  catalogueSearchResponseSchema,
  proposedItemSchema,
} from '@molvia/model'
import type { AppLocale, BarcodeHint, Item, ProposedItem } from '@molvia/model'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { Attached } from '@/usecases/attach-barcode'
import type { Proposal } from '@/usecases/propose-item'
import { parseBody, parseQuery, resourceId } from '@/parse'

export interface CatalogueApi {
  /** The use case, already bound to its repositories by the composition point. */
  search(actorId: string, query: string): Promise<{ items: Item[]; near: boolean }>
  propose(actorId: string, input: ProposedItem): Promise<Proposal>
  byBarcode(code: string): Promise<Item | null>
  hint(actorId: string, code: string, locale: AppLocale): Promise<BarcodeHint | null>
  attachBarcode(actorId: string, itemId: string, code: string): Promise<Attached>
  detachBarcode(itemId: string, code: string): Promise<void>
}

/**
 * «Этот код у …» (MOL-100, Р-3): another item holds a code sent, and nothing was written. A `409`
 * — the request is well formed, the catalogue refuses it — carrying the holder, not a code from the
 * registry: the screen offers to take that item, and needs it whole.
 */
function taken(reply: FastifyReply, item: Item): FastifyReply {
  return reply
    .code(409)
    .header('cache-control', 'no-store')
    .send(z.encode(barcodeTakenSchema, { taken: catalogueEntryOf(item) }))
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
    const { items, near } = await api.search(request.actorId, q)

    // `no-store`: the order is personal and the owner travels in a header, so a shared cache
    // would show one device what another one buys.
    return reply
      .header('cache-control', 'no-store')
      .send(z.encode(catalogueSearchResponseSchema, { items: items.map(catalogueEntryOf), near }))
  })

  /**
   * The item a scanned or typed code belongs to (MOL-99). Behind the door like the search, though
   * nobody's picks take part: the catalogue is shared, and so is who holds a code.
   */
  // No HEAD twin, as every GET of the API: Fastify runs the whole handler for one, and the length
  // of a bodiless answer would still tell found from not (adversarial В).
  app.get('/catalogue/barcode', { exposeHeadRoute: false }, async (request, reply) => {
    const { code } = parseQuery(catalogueBarcodeQuerySchema, request.query)
    const item = await api.byBarcode(code)

    return reply.header('cache-control', 'no-store').send(
      z.encode(catalogueBarcodeResponseSchema, {
        item: item === null ? null : catalogueEntryOf(item),
      }),
    )
  })

  /**
   * What Open Food Facts says a package the catalogue missed is (MOL-162): a name for «Предложить
   * товар» to start from, or `null`. Asked by the phone right after a miss, beside it rather than
   * inside the lookup's answer — the miss waits for nobody, and the lookup's strict answer would
   * refuse a field an installed app does not know (MOL-46). The code in the query, as the lookup's.
   */
  app.get('/catalogue/barcode/hint', { exposeHeadRoute: false }, async (request, reply) => {
    const { code, lang } = parseQuery(catalogueBarcodeHintQuerySchema, request.query)
    const hint = await api.hint(request.actorId, code, lang)

    return reply
      .header('cache-control', 'no-store')
      .send(z.encode(catalogueBarcodeHintResponseSchema, { hint }))
  })

  /**
   * «Предложить товар». 201 for a new item, 200 for one the catalogue already held: the
   * request succeeded either way, and the status is how the screen tells «added» from «it was
   * already there». The answer is the same entry the search returns, so the screen opens the
   * sheet on it exactly as it would after picking a row.
   */
  app.post('/catalogue/items', async (request, reply) => {
    const input = parseBody(proposedItemSchema, request.body)
    const proposal = await api.propose(request.actorId, input)
    if ('taken' in proposal) return taken(reply, proposal.taken)

    return reply
      .code(proposal.created ? 201 : 200)
      .header('cache-control', 'no-store')
      .send(z.encode(catalogueEntryCodec, catalogueEntryOf(proposal.item)))
  })

  /**
   * «Привязать код к ней?» (MOL-100). The code in the body, never the path: the API logs a request
   * as its path (MOL-58). 201 when written, 200 when the item held it already — a repeat after a
   * lost answer — and 409 with the holder when another item has it.
   */
  app.post<{ Params: { itemId: string } }>(
    '/catalogue/items/:itemId/barcodes',
    async (request, reply) => {
      const itemId = resourceId(request.params.itemId)
      const { code } = parseBody(attachBarcodeBodySchema, request.body)
      const attached = await api.attachBarcode(request.actorId, itemId, code)
      if ('taken' in attached) return taken(reply, attached.taken)

      return reply
        .code(attached.added ? 201 : 200)
        .header('cache-control', 'no-store')
        .send(z.encode(catalogueEntryCodec, catalogueEntryOf(attached.item)))
    },
  )

  /**
   * «Код … — не этот товар?» (MOL-100, В-1): the code let go of by this item. The code in the query,
   * as the lookup has it (MOL-99): a `DELETE` with a body is one a proxy may drop, and the path is
   * logged. 204 whether the item held it or not — let go of is let go of.
   */
  app.delete<{ Params: { itemId: string } }>(
    '/catalogue/items/:itemId/barcodes',
    async (request, reply) => {
      const itemId = resourceId(request.params.itemId)
      const { code } = parseQuery(catalogueBarcodeQuerySchema, request.query)
      await api.detachBarcode(itemId, code)

      return reply.code(204).header('cache-control', 'no-store').send()
    },
  )
}
