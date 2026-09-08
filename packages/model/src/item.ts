import { z } from 'zod'
import { baseUnitSchema, quantityCodec, quantitySchema } from './units'

/**
 * 'dish' is here in 0.1, long before restaurants are: the 0.3 gate measures return
 * separately for products and venues, and without this column there is nothing to split
 * the query on.
 */
export const itemKindSchema = z.enum(['product', 'dish'])
export type ItemKind = z.infer<typeof itemKindSchema>

/**
 * EAN-8, UPC-A, EAN-13 and the GTIN-14 a case carries — the only four lengths a GTIN has.
 * A range of 8 to 14 would look equivalent and would quietly accept a mistyped 9 digits.
 */
export const barcodeSchema = z.string().regex(/^(\d{8}|\d{12,14})$/)

const nameSchema = z.string().trim().min(1).max(200)
const noteSchema = z.string().trim().min(1).max(300)

export const itemSchema = z.object({
  id: z.uuid(),
  kind: itemKindSchema,
  /** The brand lives inside the name — «Молоко „Ашхар“» — because that is how a shelf reads. */
  name: nameSchema,
  /** The name normalised to Latin. Filled by MOL-5, which is why no input carries it. */
  searchKey: z.string(),
  /**
   * Several per item on purpose: one product comes in different packaging, and a loose
   * good has none at all — which is exactly where the price spread is widest.
   */
  barcodes: z.array(barcodeSchema).readonly(),
  /** «пастеризованное, 3,2%», «на развес» — the second line of a search result. */
  note: noteSchema.nullable(),
  defaultUnit: baseUnitSchema,
  typicalQuantity: quantitySchema.nullable(),
  /** null for seeded items: they have no author. */
  createdBy: z.uuid().nullable(),
  createdAt: z.date(),
})
export type Item = z.infer<typeof itemSchema>

/**
 * Inputs decode the wire representation, so one parse turns a request body into domain
 * values. Strict, so an id or a searchKey cannot be smuggled past the server that owns them.
 */
export const newItemSchema = z.strictObject({
  kind: itemKindSchema,
  name: nameSchema,
  barcodes: z.array(barcodeSchema).readonly().default([]),
  note: noteSchema.optional(),
  defaultUnit: baseUnitSchema,
  typicalQuantity: quantityCodec.optional(),
})
export type NewItem = z.infer<typeof newItemSchema>
