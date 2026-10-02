import { and, eq, gte, isNull, sql } from 'drizzle-orm'
import type { BudgetPlan, BudgetPlanValue } from '@molvia/model'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull } from './rows'
import { budgetPlans, spendingCategories } from './schema'

/**
 * The owner's plans of «Бюджет» (MOL-117): every row of every category, a handful at most, read
 * whole — which one holds in a month is the model's (`planIn`).
 */
export interface BudgetPlanRepository {
  list(actorId: string): Promise<readonly BudgetPlan[]>

  /**
   * A plan of a category — or the savings target, `categoryId` null — **from `from` on** (В-1,
   * Р-9): the rows of the same category from that month on are replaced by this one, so a change in
   * September takes back one made for November, and the months before stay as they were. False
   * when the category is not the owner's — someone else's and a missing one alike.
   */
  set(
    actorId: string,
    categoryId: string | null,
    from: string,
    plan: BudgetPlanValue | null,
  ): Promise<boolean>
}

type Row = typeof budgetPlans.$inferSelect

/** One owner's plans are written one at a time: the rows replaced and the one written are one step. */
function lockOwner(actorId: string) {
  return sql`select pg_advisory_xact_lock(hashtext('budget_plans'), hashtext(${actorId}))`
}

function toPlan(row: Row): BudgetPlan {
  const plan: BudgetPlanValue | null =
    row.amountMinor !== null && row.currency !== null
      ? { kind: 'amount', amount: { minor: row.amountMinor, currency: row.currency } }
      : row.percent !== null
        ? { kind: 'share', percent: row.percent }
        : null
  return { categoryId: row.categoryId, from: row.fromMonth, plan }
}

export function createBudgetPlanRepository(db: Conn): BudgetPlanRepository {
  return {
    async list(actorId) {
      const rows = await db.select().from(budgetPlans).where(eq(budgetPlans.actorId, actorId))
      return rows.map(toPlan)
    },

    async set(actorId, categoryId, from, plan) {
      const own = categoryId === null ? null : idOrNull(categoryId)
      if (categoryId !== null && own === null) return false
      return translateFailures(() =>
        db.transaction(async (tx) => {
          await tx.execute(lockOwner(actorId))
          if (own !== null) {
            const [category] = await tx
              .select({ id: spendingCategories.id })
              .from(spendingCategories)
              .where(and(eq(spendingCategories.id, own), eq(spendingCategories.actorId, actorId)))
            if (!category) return false
          }
          await tx
            .delete(budgetPlans)
            .where(
              and(
                eq(budgetPlans.actorId, actorId),
                own === null ? isNull(budgetPlans.categoryId) : eq(budgetPlans.categoryId, own),
                gte(budgetPlans.fromMonth, from),
              ),
            )
          await tx.insert(budgetPlans).values({
            actorId,
            categoryId: own,
            fromMonth: from,
            amountMinor: plan?.kind === 'amount' ? plan.amount.minor : null,
            currency: plan?.kind === 'amount' ? plan.amount.currency : null,
            percent: plan?.kind === 'share' ? plan.percent : null,
          })
          return true
        }),
      )
    },
  }
}
