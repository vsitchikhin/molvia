import { z } from 'zod'
import { ISSUE } from './errors'
import { visibleLine } from './text'
import { baseUnitSchema, quantityCodec, quantitySchema } from './units'

export const itemKindSchema = z.enum(['product', 'dish'])
export type ItemKind = z.infer<typeof itemKindSchema>

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
  searchKey: z.string().min(1),
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
