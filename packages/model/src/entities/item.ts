import { z } from 'zod'
import { ISSUE } from '#model/support/errors'
import { visibleLine } from '#model/support/text'
import { baseUnitSchema, quantityCodec, quantitySchema } from '#model/values/units'

// 'dish' is here in 0.1, before any restaurant is: the 0.3 gate measures return
// separately for products and venues, and without the column there is nothing to split on.
export const itemKindSchema = z.enum(['product', 'dish'])
export type ItemKind = z.infer<typeof itemKindSchema>

// The four lengths a GTIN has — EAN-8, UPC-A, EAN-13, GTIN-14. A range of 8..14 looks
// equivalent and quietly accepts a mistyped nine digits.
export const barcodeSchema = z.string().regex(/^(\d{8}|\d{12,14})$/)

const nameSchema = visibleLine(200)
const noteSchema = visibleLine(300)

const barcodesSchema = z
  .array(barcodeSchema)
  .max(20)
  .refine((codes) => new Set(codes).size === codes.length, { error: ISSUE.BARCODE_DUPLICATED })
  .readonly()

export const itemSchema = z.object({
  id: z.uuid(),
  kind: itemKindSchema,
  name: nameSchema,
  /** Latin, filled by MOL-5 — which is why no input carries it. */
  // 800, not 200: transliteration grows a name — «щ» becomes «shch» — so a valid name
  // would otherwise produce a key this same schema refuses.
  searchKey: visibleLine(800),
  /** Several per item: one product comes in different packaging, and loose goods have none. */
  barcodes: barcodesSchema,
  note: noteSchema.nullable(),
  defaultUnit: baseUnitSchema,
  typicalQuantity: quantitySchema.nullable(),
  createdBy: z.uuid().nullable(),
  createdAt: z.date(),
})
export type Item = z.infer<typeof itemSchema>

export const newItemSchema = z.strictObject({
  kind: itemKindSchema,
  name: nameSchema,
  barcodes: barcodesSchema.default([]),
  note: noteSchema.optional(),
  defaultUnit: baseUnitSchema,
  typicalQuantity: quantityCodec.optional(),
})
export type NewItem = z.infer<typeof newItemSchema>
