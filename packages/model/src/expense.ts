import { z } from 'zod'
import { moneyCodec, priceSchema } from './money'
import { quantityCodec, quantitySchema } from './units'

/**
 * The frequent half of the product. Place, currency and owner all come from the trip:
 * an expense carries none of them, so there is nowhere for them to disagree.
 *
 * There is no unit-price field and there will not be one — unitPrice() computes it. A
 * stored computed column drifts from what it was computed from, sooner or later.
 */
export const expenseSchema = z.object({
  id: z.uuid(),
  tripId: z.uuid(),
  /** The one thing that is required by meaning: everything else may be left empty. */
  itemId: z.uuid(),
  quantity: quantitySchema.nullable(),
  amount: priceSchema.nullable(),
  createdAt: z.date(),
})
export type Expense = z.infer<typeof expenseSchema>

export const newExpenseSchema = z.strictObject({
  tripId: z.uuid(),
  itemId: z.uuid(),
  quantity: quantityCodec.optional(),
  amount: moneyCodec.optional(),
})
export type NewExpense = z.infer<typeof newExpenseSchema>

/**
 * Nullable rather than merely optional: absent means "leave it alone", null means "I was
 * wrong, clear it". The sheet needs both — a price typed by mistake has to be removable.
 */
export const expensePatchSchema = z
  .strictObject({
    quantity: quantityCodec.nullable().optional(),
    amount: moneyCodec.nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    error: 'at least one field must be present',
  })
export type ExpensePatch = z.infer<typeof expensePatchSchema>
