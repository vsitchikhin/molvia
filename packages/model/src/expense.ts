import { z } from 'zod'
import { moneyCodec, priceSchema } from './money'
import { PATCH_EMPTY, changesSomething } from './patch'
import { quantityCodec, quantitySchema } from './units'

/**
 * The frequent half of the product. Place and owner come from the trip; the currency does
 * not. It is prefilled from the trip and may differ from it — paying for one thing by card
 * in another currency is an ordinary afternoon — so the amount carries its own, and the
 * trip total is read per currency rather than as one number.
 *
 * There is no unit-price field and there will not be one — unitPrice() computes it. A
 * stored computed column drifts from what it was computed from, sooner or later.
 */
export const expenseSchema = z.object({
  id: z.uuid(),
  tripId: z.uuid(),
  /** The one thing that is required by meaning: everything else may be left empty. */
  itemId: z.uuid(),
  // The currency the client prefills from the trip and may change on the spot.
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
  .refine(changesSomething, PATCH_EMPTY)
export type ExpensePatch = z.infer<typeof expensePatchSchema>
