import { z } from 'zod'
import { ISSUE } from '#model/support/errors'
import { itemSchema, newItemSchema } from '#model/entities/item'
import type { Item } from '#model/entities/item'
import { quantityCodec } from '#model/values/units'

/**
 * The longest query the search accepts: no name is longer (`visibleLine(200)`), so nothing
 * worth finding is lost. The cost of a search grows with its query — 42 KB held a connection
 * for three seconds in MOL-10 — and a bound named in the contract is more honest than one
 * hidden in SQL.
 */
export const CATALOGUE_QUERY_MAX = 200

/**
 * The query string of `GET /catalogue/search`. Strict: a parameter dropped in silence reads as
 * understood, and `?actorId=` in particular must be refused rather than ignored — the owner
 * comes from the header only. A repeated `q` arrives as an array and fails the string.
 *
 * Not trimmed or folded here: the key is taken by `searchQueryKey`, the same function a name
 * goes through on write, and a second normalisation would be a second place that decides.
 */
export const catalogueSearchQuerySchema = z.strictObject(
  {
    q: z
      .string({ error: ISSUE.QUERY_INVALID })
      .max(CATALOGUE_QUERY_MAX, { error: ISSUE.QUERY_INVALID }),
  },
  { error: ISSUE.QUERY_INVALID },
)
export type CatalogueSearchQuery = z.infer<typeof catalogueSearchQuerySchema>

/**
 * What the catalogue shows of an item: what a row of results and the sheet after it need.
 *
 * An allowlist, and the reason is `createdBy`. In 0.1 the device identifier *is* the proof of
 * identity (MOL-8) — whoever reads it is the owner — and `created_by` holds exactly that. An
 * `Item` sent whole would hand every searcher the identity of everyone who added an item.
 * `searchKey` and `createdAt` nobody reads; barcodes belong to 0.2.
 */
export const catalogueEntrySchema = itemSchema.pick({
  id: true,
  kind: true,
  name: true,
  note: true,
  defaultUnit: true,
  typicalQuantity: true,
})
export type CatalogueEntry = z.infer<typeof catalogueEntrySchema>

/**
 * Strict on purpose, on the client's side as much as the server's: a reply that grew a field
 * fails to parse rather than carrying it past a client that simply never reads it — which is
 * how a leak would otherwise go unnoticed.
 */
export const catalogueEntryCodec = z.strictObject({
  ...catalogueEntrySchema.shape,
  typicalQuantity: quantityCodec.nullable(),
})

/** An object rather than a bare list, so a field beside the items does not break a client. */
export const catalogueSearchResponseSchema = z.strictObject({
  items: z.array(catalogueEntryCodec),
})
export type CatalogueSearchResponse = z.infer<typeof catalogueSearchResponseSchema>

/**
 * The body of «Предложить товар» in 0.1: products only, and no barcodes.
 *
 * Venues and dishes arrive with 0.3, and until then the search records every visit on the
 * product half of the gate — a dish added now would be counted as a product forever, in a
 * log nothing may correct. Barcodes arrive with the scanner in 0.2; until then a barcode sent
 * beside a name the catalogue already holds would be dropped in silence, or turn a 409 into a
 * 200. Both are refused rather than half-handled, and both lift with the release that needs them.
 */
export const proposedItemSchema = newItemSchema.omit({ barcodes: true }).extend({
  kind: z.literal('product'),
})
export type ProposedItem = z.infer<typeof proposedItemSchema>

/** The one way an item becomes a catalogue entry — by naming what goes, not what stays. */
export function catalogueEntryOf(item: Item): CatalogueEntry {
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    note: item.note,
    defaultUnit: item.defaultUnit,
    typicalQuantity: item.typicalQuantity,
  }
}
