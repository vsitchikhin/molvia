import { z } from 'zod'
import { convertSigned } from '#model/entities/money-account'
import type { MoneyMonth, Month } from '#model/entities/money-month'
import { categoryOrder } from '#model/entities/spending-category'
import type { SpendingCategory } from '#model/entities/spending-category'
import { convertAcross } from '#model/entities/trip'
import { divideRounded, INT8_MAX } from '#model/support/decimal'
import type { Money } from '#model/values/money'

/**
 * A plan is a whole percent of what came in (MOL-117, В-2): the owner's sheet plans «Продукты 10 %»,
 * «Накопления 25 %» — never a fraction of one.
 */
export const BUDGET_PERCENT_MAX = 100
export const budgetPercentSchema = z.int().min(0).max(BUDGET_PERCENT_MAX)

/**
 * What a category is planned at (MOL-117, В-2): a sum in the spending currency, or a share of
 * «Пришло» of the month — the salary moved as «Пришло» moves it, as the sheet's «месяц бюджета» does.
 */
export type BudgetPlanValue =
  | { readonly kind: 'amount'; readonly amount: Money }
  | { readonly kind: 'share'; readonly percent: number }

/**
 * One stored plan (MOL-117, В-1): it holds from its month on, until a later one of the same category
 * takes over — so a plan set once carries over, and a change in November leaves September as it was.
 * `plan` null is «no plan from this month». `categoryId` null is the savings target (В-4), which is
 * a share only: putting money aside is no spending, so it has no sum of a category to be held to.
 */
export interface BudgetPlan {
  readonly categoryId: string | null
  readonly from: Month
  readonly plan: BudgetPlanValue | null
}

/** The plan of one category — or of the savings, `null` — that holds in a month. */
export function planIn(
  plans: readonly BudgetPlan[],
  categoryId: string | null,
  month: Month,
): BudgetPlanValue | null {
  let found: BudgetPlan | undefined
  for (const plan of plans) {
    if (plan.categoryId !== categoryId || plan.from > month) continue
    if (found === undefined || plan.from > found.from) found = plan
  }
  return found?.plan ?? null
}

export interface BudgetRow {
  readonly categoryId: string
  readonly plan: BudgetPlanValue
  /**
   * The plan in the spending currency; null — nothing to count it by: a share with no rate, or a
   * share of a «Пришло» nothing has come into yet (`awaitingIncome`).
   */
  readonly planned: Money | null
  /**
   * A share of a «Пришло» still empty (review 1, adversarial В): the plan is not zero, it is not known
   * yet — the salary has not come — so the row is no «сверх плана» and no part of «осталось».
   */
  readonly awaitingIncome: boolean
  /** Converted from another currency by the month's rate: the screen prints «≈» (Р-4). */
  readonly estimated: boolean
  /** A share of a «Пришло» some of which no rate counted: the plan is short by it. */
  readonly plannedWhole: boolean
  readonly spent: Money
  /** Something of the category had no rate (`uncountedIn`): what was spent is short by it. */
  readonly spentWhole: boolean
  /**
   * The plan less what was spent, signed — below zero is «сверх плана» (Р-7). Null with no plan, and
   * where a plan known only in part is spent past (review 10): a share of a «Пришло» short of a rate
   * is a floor of the plan, and «over» against a floor is not known.
   */
  readonly left: Money | null
  /**
   * What was spent of the plan, in whole percent rounded as a person rounds — but «100 %» only once
   * the plan is spent: 248 800 of 250 000 is «99 %», never «100 %» beside 1 200 ֏ still left
   * (adversarial Г). Null where either side is not whole, or the plan is nothing.
   */
  readonly used: number | null
}

export interface BudgetUnplanned {
  readonly categoryId: string
  readonly spent: Money
  readonly spentWhole: boolean
}

export interface BudgetTotal {
  /**
   * The plans of the rows counted, and what is left of them, signed — null while no row is counted:
   * every share waiting for «Пришло» is no «Осталось 0 ֏» (review 9). `left` is null too where the
   * plans are known only in part and spent past them (review 10).
   */
  readonly planned: Money | null
  /**
   * What was spent in every category with a plan — a share still waiting for «Пришло» too: its
   * category is planned, and its spending is no «вне плана» (adversarial З of round 2).
   */
  readonly spent: Money
  readonly left: Money | null
  /**
   * Some row with a plan is in no figure of «План» — a share waiting for «Пришло», one with no rate,
   * one past what money holds — while its spending is in «Потрачено»: the screen says «и ещё» beside
   * the plan, so the three figures are not read as one sum (review 12, adversarial Л of round 3).
   */
  readonly planShort: boolean
  /** What was spent in categories with no plan, apart (Р-6): it is no part of «осталось». */
  readonly unplanned: Money
  /**
   * `left` in the income currency by the month's rate; null with no rate, and null when the two
   * currencies are one — the same figure again under «≈» says nothing (review 4, adversarial Е).
   */
  readonly leftIncome: Money | null
  /**
   * Every row's plan and spending counted whole — else «осталось» is not said as a figure. A row
   * whose plan would carry the sum past what money holds is left out of it, as a spending is from
   * «Потрачено» (adversarial А): an answer that fails to encode would be a 500 for good.
   */
  readonly whole: boolean
}

/**
 * «Отложить N % пришедшего» against what was put aside (MOL-117, В-4): «Разница» of the month — what
 * came in less what went out — of what came in. Only for whole sums, as every comparison of
 * «Деньги»: a month with anything «не посчитано» says no percent rather than a wrong one.
 */
export interface BudgetSavings {
  readonly target: number | null
  readonly income: Money
  readonly difference: Money | null
  readonly actual: number | null
}

export interface MonthBudget {
  readonly month: Month
  readonly rows: readonly BudgetRow[]
  readonly unplanned: readonly BudgetUnplanned[]
  /** Null while no category of the month has a plan; the savings target alone has none. */
  readonly total: BudgetTotal | null
  readonly savings: BudgetSavings
}

/** A plan into the spending currency of the month: a sum as it is or by the month's rate, a share of «Пришло». */
function plannedOf(
  plan: BudgetPlanValue,
  month: MoneyMonth,
): { planned: Money | null; estimated: boolean; whole: boolean; awaitingIncome: boolean } {
  const spend = month.spendCurrency
  if (plan.kind === 'amount') {
    if (plan.amount.currency === spend)
      return { planned: plan.amount, estimated: false, whole: true, awaitingIncome: false }
    const converted = month.rate === null ? null : convertAcross(plan.amount, month.rate)
    const planned = converted?.currency === spend ? converted : null
    // Nothing to convert it by is a plan no rate counted — «не всё посчитано», as a share's with no
    // rate is (review 14, adversarial Н of round 5): marked whole, it was said by no footnote at all.
    return { planned, estimated: true, whole: planned !== null, awaitingIncome: false }
  }
  // Nothing has come in yet, and none of it short of a rate: the share waits for the income.
  if (month.income.minor === 0n && month.incomeUncounted.length === 0) {
    return { planned: null, estimated: false, whole: true, awaitingIncome: true }
  }
  const income =
    month.income.currency === spend
      ? month.income
      : month.rate === null
        ? null
        : convertAcross(month.income, month.rate)
  if (income?.currency !== spend) {
    return { planned: null, estimated: true, whole: false, awaitingIncome: false }
  }
  return {
    planned: { minor: divideRounded(income.minor * BigInt(plan.percent), 100n), currency: spend },
    estimated: month.income.currency !== spend,
    whole: month.incomeUncounted.length === 0,
    awaitingIncome: false,
  }
}

/**
 * The budget of a month (MOL-117), counted from the month «Деньги» count — never a second count of
 * what was spent (Р-2): a category's spending is its `byCategory`, the trips in «Продукты» with it.
 * The rows are the categories with a plan in the order of the chips, as the sheet lists them —
 * never by alarm, so a row does not move under the finger. **A removed category keeps its plan**
 * (Р-5): it has a row in a month something was spent in it, and none in a month it is only removed.
 */
export function monthBudget(
  month: MoneyMonth,
  plans: readonly BudgetPlan[],
  categories: readonly SpendingCategory[],
): MonthBudget {
  const spend = month.spendCurrency
  const spentOf = new Map(month.byCategory.map((entry) => [entry.categoryId, entry.amount]))
  const short = new Set(month.uncountedIn)
  const nothing: Money = { minor: 0n, currency: spend }

  const rows: BudgetRow[] = []
  const unplanned: BudgetUnplanned[] = []
  for (const category of categoryOrder(categories)) {
    const spent = spentOf.get(category.id) ?? nothing
    const spentWhole = !short.has(category.id)
    const touched = spent.minor > 0n || !spentWhole
    const plan = planIn(plans, category.id, month.month)
    if (plan === null) {
      if (touched) unplanned.push({ categoryId: category.id, spent, spentWhole })
      continue
    }
    if (category.archivedAt !== null && !touched) continue
    const { planned, estimated, whole, awaitingIncome } = plannedOf(plan, month)
    const remaining = planned === null ? null : planned.minor - spent.minor
    const left =
      remaining === null || (!whole && remaining < 0n)
        ? null
        : { minor: remaining, currency: spend }
    rows.push({
      categoryId: category.id,
      plan,
      planned,
      awaitingIncome,
      estimated,
      plannedWhole: whole,
      spent,
      spentWhole,
      left,
      used: planned === null || !whole || !spentWhole ? null : usedOf(spent, planned),
    })
  }

  return {
    month: month.month,
    rows,
    unplanned,
    total: rows.length === 0 ? null : totalOf(rows, unplanned, month),
    savings: savingsOf(month, planIn(plans, null, month.month)),
  }
}

/**
 * A percent the wire can carry, or none: past a safe integer it says nothing a person reads, and an
 * answer that cannot encode is a 500 for good (adversarial А2 of round 2) — a plan of 0,01 ֏ beside a
 * large spending, a «Пришло» of a kopeck.
 */
function safePercent(value: bigint): number | null {
  return value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)
    ? null
    : Number(value)
}

function usedOf(spent: Money, planned: Money): number | null {
  if (planned.minor <= 0n) return null
  const rounded = safePercent(divideRounded(spent.minor * 100n, planned.minor))
  if (rounded === null) return null
  return spent.minor < planned.minor ? Math.min(rounded, 99) : rounded
}

function totalOf(
  rows: readonly BudgetRow[],
  unplanned: readonly BudgetUnplanned[],
  month: MoneyMonth,
): BudgetTotal {
  const spend = month.spendCurrency
  // A row whose plan would carry the sum past what money holds is left out, as a spending is from
  // «Потрачено» (adversarial А); what was spent is at most the month's, which money holds.
  let planned = 0n
  let spentCounted = 0n
  let counted = 0
  // A plan counted and known only in part is a floor: spent past it, «over» is not known (review 10).
  // A spending short of a rate is a floor of what was spent, so over it is over (review 13, К).
  let floor = false
  for (const row of rows) {
    if (row.planned === null || planned + row.planned.minor > INT8_MAX) continue
    planned += row.planned.minor
    spentCounted += row.spent.minor
    counted += 1
    if (!row.plannedWhole) floor = true
  }
  const whole = counted === rows.length && rows.every((row) => row.plannedWhole && row.spentWhole)
  const remaining = planned - spentCounted
  const left: Money | null =
    counted === 0 || (floor && remaining < 0n) ? null : { minor: remaining, currency: spend }
  const leftIncome =
    left === null || month.incomeCurrency === spend || month.rate === null
      ? null
      : convertSigned(left, month.rate)
  return {
    planned: counted === 0 ? null : { minor: planned, currency: spend },
    // Every row's spending is of the month's, which money holds.
    spent: { minor: rows.reduce((sum, row) => sum + row.spent.minor, 0n), currency: spend },
    left,
    planShort: counted < rows.length,
    unplanned: {
      minor: unplanned.reduce((sum, row) => sum + row.spent.minor, 0n),
      currency: spend,
    },
    leftIncome,
    whole,
  }
}

function savingsOf(month: MoneyMonth, plan: BudgetPlanValue | null): BudgetSavings {
  const target = plan?.kind === 'share' ? plan.percent : null
  const spent = month.spentIncome
  if (
    spent === null ||
    month.uncounted.length > 0 ||
    month.incomeUncounted.length > 0 ||
    month.income.minor <= 0n
  ) {
    return { target, income: month.income, difference: null, actual: null }
  }
  const difference = month.income.minor - spent.minor
  return {
    target,
    income: month.income,
    difference: { minor: difference, currency: month.income.currency },
    actual: safePercent(divideRounded(difference * 100n, month.income.minor)),
  }
}

/**
 * The one figure of «Бюджет» among the ways out of «Деньги» (MOL-117, В-3): whether the month has a
 * plan at all, and what is left — none when the sum is not whole, as any figure of «Деньги» is.
 */
export function budgetFigure(budget: MonthBudget): { planned: boolean; left: Money | null } {
  return {
    // The savings target is a plan too (adversarial Д): set alone, the month is no «не задан».
    planned: budget.total !== null || budget.savings.target !== null,
    left: budget.total?.whole ? (budget.total.left ?? null) : null,
  }
}
