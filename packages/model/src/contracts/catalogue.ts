import { z } from 'zod'
import { ISSUE } from '#model/support/errors'
import { barcodeWriteForm, hasRepeatedBarcode } from '#model/entities/barcode'
import { barcodeSchema, itemSchema, newItemSchema } from '#model/entities/item'
import { LOCALES } from '#model/support/locale'
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
 * `searchKey` and `createdAt` nobody reads; codes stay on the server — a code is looked up by
 * itself (MOL-99), and a strict entry read by the trip, «Что брать» and the copy is not widened.
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

/**
 * An object rather than a bare list, so a field can stand beside the items without reshaping
 * the answer. Strict all the same, as the entry is: a client that has not caught up refuses a field
 * it does not know rather than reading past it. So the two halves are kept from meeting across
 * versions from both ends (MOL-46, owner's decision): an installed PWA takes the new code the
 * moment it is put away (`pwaUpdate.ts`), and a field is added so the old server's answer still
 * reads — `near` missing is near, what every answer was before it existed.
 *
 * `near` says whether some row has every word close to what was typed (MOL-46): the budget of
 * two edits lets a word wrong from end to end through — `pelmeni` is two from `zeleni` of «Чай
 * зелёный», exactly as `malako` is from `moloko` — and no rule on the letters tells the two apart
 * without losing typos. So nothing is dropped; the screen is told the answer only grazes the
 * budget and says «не нашли» above it. Decided by the server, which alone has the distances.
 */
export const catalogueSearchResponseSchema = z.strictObject({
  items: z.array(catalogueEntryCodec),
  near: z.boolean().default(true),
})
export type CatalogueSearchResponse = z.infer<typeof catalogueSearchResponseSchema>

/**
 * The query string of `GET /catalogue/barcode` (MOL-99). The code travels in the query, not in
 * the path: the API logs a request as its path (MOL-58), and a code is what a person bought.
 * Strict, as the search's is. The code's shape is not checked here: a code of no barcode's shape
 * is answered as a code nobody holds, one answer for both.
 */
export const catalogueBarcodeQuerySchema = z.strictObject(
  { code: z.string({ error: ISSUE.QUERY_INVALID }) },
  { error: ISSUE.QUERY_INVALID },
)
export type CatalogueBarcodeQuery = z.infer<typeof catalogueBarcodeQuerySchema>

/**
 * The item holding a code, or `null` — nothing holding it is an ordinary outcome of the screen,
 * not an error: a `404` would read the same as one from a Wi-Fi portal. Strict, as the search's.
 */
export const catalogueBarcodeResponseSchema = z.strictObject({
  item: catalogueEntryCodec.nullable(),
})
export type CatalogueBarcodeResponse = z.infer<typeof catalogueBarcodeResponseSchema>

/**
 * The query string of `GET /catalogue/barcode/hint` (MOL-162): the code a lookup missed, in the
 * query for the same reason as the lookup's, and the language of the interface — the server does not
 * know it, and a name is picked in it.
 */
export const catalogueBarcodeHintQuerySchema = z.strictObject(
  {
    code: z.string({ error: ISSUE.QUERY_INVALID }),
    lang: z.enum(LOCALES, { error: ISSUE.QUERY_INVALID }),
  },
  { error: ISSUE.QUERY_INVALID },
)
export type CatalogueBarcodeHintQuery = z.infer<typeof catalogueBarcodeHintQuerySchema>

/**
 * What Open Food Facts says a package is (MOL-162): a name «Предложить товар» starts from, the size
 * of the package when it is a weight or a volume, and the product's page there — the attribution
 * its licence asks for. Only ever a suggestion: the person confirms or corrects it. The name passes
 * the same rule a proposed name does, so the sheet never starts from one it could not send.
 */
export const barcodeHintSchema = z.strictObject({
  name: itemSchema.shape.name,
  quantity: quantityCodec.nullable(),
  url: z.url({ protocol: /^https$/, hostname: /(^|\.)openfoodfacts\.org$/ }),
})
export type BarcodeHint = z.infer<typeof barcodeHintSchema>

/**
 * A hint or `null`: Open Food Facts not knowing the code, being out of reach, or the code being a
 * shop's own label are one answer — no hint — and none of them an error.
 */
export const catalogueBarcodeHintResponseSchema = z.strictObject({
  hint: barcodeHintSchema.nullable(),
})
export type CatalogueBarcodeHintResponse = z.infer<typeof catalogueBarcodeHintResponseSchema>

/**
 * The body of «Предложить товар»: products only, and the codes read from the package.
 *
 * Venues and dishes arrive with 0.3, and until then the search records every visit on the
 * product half of the gate — a dish added now would be counted as a product forever, in a
 * log nothing may correct. So a dish is refused rather than half-handled, and lifts with the
 * release that needs it.
 *
 * Codes arrived with the scanner in 0.2 (MOL-100): written with a new item. Beside a name the
 * catalogue already holds they are not written at all — the answer is that item, and the screen asks
 * whether the code is its, as it asks of any item found by name (owner's decision В-5). Two codes of one
 * package — one a twin of the other — are a repeat, as two equal codes are (Р-7). Whether each
 * checks is `writtenBarcode`'s, called by the server.
 */
/** A code as it would be written, or as it came when it would be refused — the refusal is the server's. */
function writtenForm(code: string): string {
  const form = barcodeWriteForm(code)
  return form.ok ? form.code : code
}

export const proposedItemSchema = newItemSchema
  .extend({ kind: z.literal('product') })
  // By the form each is written in: `04252614` is written as `0042100005264`, and the two sent
  // together are one package (review А).
  .refine((input) => !hasRepeatedBarcode(input.barcodes.map(writtenForm)), {
    error: ISSUE.BARCODE_DUPLICATED,
    path: ['barcodes'],
  })
export type ProposedItem = z.infer<typeof proposedItemSchema>

/**
 * The body of «привязать код к ней?» (MOL-100): the code in the body, never in the path — the API
 * logs a request as its path (MOL-58), and a code is what a person bought.
 */
export const attachBarcodeBodySchema = z.strictObject({ code: barcodeSchema })
export type AttachBarcodeBody = z.infer<typeof attachBarcodeBodySchema>

/**
 * «Этот код у „Молоко Ашхар 1 л“» (MOL-100, Р-3): another item holds the code, or one of its twins,
 * and nothing was written. Not an error of the request but an answer about the catalogue — it goes
 * with a `409`, and names the holder whole, so the screen can offer to take it: the person holds the
 * package, and the catalogue says this is what it is.
 */
export const barcodeTakenSchema = z.strictObject({ taken: catalogueEntryCodec })
export type BarcodeTaken = z.infer<typeof barcodeTakenSchema>

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
