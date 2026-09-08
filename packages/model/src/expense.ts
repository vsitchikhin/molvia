import { z } from 'zod'
import { moneyCodec, priceSchema } from './money'
import { PATCH_EMPTY, changesSomething } from './patch'
import { quantityCodec, quantitySchema } from './units'

/**
 * The currency is prefilled from the trip and may differ from it, so the amount carries
 * its own. No unit-price field: unitPrice() computes it, and a stored computed column drifts.
 */
export const expenseSchema = z.object({
  id: z.uuid(),
  tripId: z.uuid(),
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

export const expensePatchSchema = z
  .strictObject({
    quantity: quantityCodec.nullable().optional(),
    amount: moneyCodec.nullable().optional(),
  })
  .refine(changesSomething, PATCH_EMPTY)
export type ExpensePatch = z.infer<typeof expensePatchSchema>
