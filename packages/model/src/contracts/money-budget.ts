import { z } from 'zod'
import { monthSchema } from './money'
import { spendingCategoryViewCodec, spendingCategoryViewOf } from './spending'
import { budgetPercentSchema } from '#model/entities/money-budget'
import type { MonthBudget } from '#model/entities/money-budget'
import { categoryOrder } from '#model/entities/spending-category'
import type { SpendingCategory } from '#model/entities/spending-category'
import { currencySchema, moneyCodec, signedMoneyCodec } from '#model/values/money'

/** A plan on the wire: a sum, or a whole percent of «Пришло» (MOL-117, В-2). */
export const budgetPlanValueCodec = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('amount'), amount: moneyCodec }),
  z.strictObject({ kind: z.literal('share'), percent: budgetPercentSchema }),
])

/**
 * `PUT /budget/plans` (MOL-117): a category's plan — or the savings target, `categoryId` null — from
 * the month `from` on; `plan` null takes it away from that month on (В-1, Р-9). The savings target
 * is a share only: putting aside is no spending, and has no sum of its own to be held to (В-4).
 */
export const budgetPlanBodySchema = z
  .strictObject({
    categoryId: z.uuid().nullable(),
    from: monthSchema,
    plan: budgetPlanValueCodec.nullable(),
  })
  .refine((body) => body.categoryId !== null || body.plan?.kind !== 'amount', {
    path: ['plan'],
  })
export type BudgetPlanBody = z.output<typeof budgetPlanBodySchema>

/**
 * `GET /money/months/:month/budget` (MOL-117): the month's budget counted by the server — the rows of
 * the categories with a plan in the order of the chips, what was spent with none, the total and the
 * savings. `categories` names every category the answer speaks of, as the month's does.
 */
export const moneyBudgetCodec = z.strictObject({
  month: monthSchema,
  spendCurrency: currencySchema,
  incomeCurrency: currencySchema,
  rows: z.array(
    z.strictObject({
      categoryId: z.uuid(),
      plan: budgetPlanValueCodec,
      planned: moneyCodec.nullable(),
      estimated: z.boolean(),
      plannedWhole: z.boolean(),
      spent: moneyCodec,
      spentWhole: z.boolean(),
      left: signedMoneyCodec.nullable(),
      used: z.int().min(0).nullable(),
    }),
  ),
  unplanned: z.array(
    z.strictObject({ categoryId: z.uuid(), spent: moneyCodec, spentWhole: z.boolean() }),
  ),
  total: z
    .strictObject({
      planned: moneyCodec,
      spent: moneyCodec,
      left: signedMoneyCodec,
      unplanned: moneyCodec,
      leftIncome: signedMoneyCodec.nullable(),
      whole: z.boolean(),
    })
    .nullable(),
  savings: z.strictObject({
    target: budgetPercentSchema.nullable(),
    income: moneyCodec,
    difference: signedMoneyCodec.nullable(),
    actual: z.int().nullable(),
  }),
  categories: z.array(spendingCategoryViewCodec),
})
export type MoneyBudgetView = z.output<typeof moneyBudgetCodec>

export function moneyBudgetViewOf(
  budget: MonthBudget,
  currencies: Pick<MoneyBudgetView, 'spendCurrency' | 'incomeCurrency'>,
  categories: readonly SpendingCategory[],
): MoneyBudgetView {
  return {
    month: budget.month,
    spendCurrency: currencies.spendCurrency,
    incomeCurrency: currencies.incomeCurrency,
    rows: budget.rows.map((row) => ({ ...row })),
    unplanned: budget.unplanned.map((row) => ({ ...row })),
    total: budget.total && { ...budget.total },
    savings: { ...budget.savings },
    categories: categoryOrder(categories).map(spendingCategoryViewOf),
  }
}
