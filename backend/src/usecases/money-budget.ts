import { DomainError, ERROR, monthBudget, monthOf, moneyBudgetViewOf } from '@molvia/model'
import type { Actor, BudgetPlanBody, MoneyBudgetView } from '@molvia/model'
import { countMonth, monthRate, monthRows, settleThaws } from './money-month'
import { dayRates } from './money-rates'
import type { TripRepositories } from '@/db/unit-of-work'
import { todayOf } from './today'
import type { Today } from './today'

type Repositories = Pick<
  TripRepositories,
  'spendings' | 'spendingCategories' | 'money' | 'exchanges' | 'incomes' | 'rates' | 'budgetPlans'
>
type Owner = Pick<Actor, 'id' | 'incomeCurrency' | 'spendCurrency'> & Today

/**
 * `GET /money/months/:month/budget` (MOL-117): the month counted as `GET /money/months/:month`
 * counts it — the same rows, the same rate of the month, frozen by this read as by opening it and
 * settled after — and the plans set against it. What was spent is never counted a second time (Р-2).
 */
export async function moneyBudgetOf(
  repositories: Repositories,
  owner: Owner,
  month: string,
  now: Date = new Date(),
): Promise<MoneyBudgetView> {
  const today = todayOf(owner, now)
  const [rates, categories, salaryShiftDay, rows, plans] = await Promise.all([
    dayRates(repositories, owner),
    repositories.spendingCategories.list(owner.id),
    repositories.money.salaryShift(owner.id),
    monthRows(repositories, owner, month, month),
    repositories.budgetPlans.list(owner.id),
  ])
  let frozen: Awaited<ReturnType<typeof monthRate>>
  try {
    frozen = await monthRate(repositories, owner, rates, month, today)
  } finally {
    // Only a closed month is frozen by a read, so only it is held against what landed meanwhile.
    if (month < monthOf(today)) await settleThaws(repositories, owner, rates.basis)
  }
  const counted = await countMonth(
    owner,
    rates,
    month,
    rows,
    categories,
    frozen.rate,
    frozen.kind,
    salaryShiftDay,
  )
  return moneyBudgetViewOf(monthBudget(counted, plans, categories), counted, categories)
}

/**
 * `PUT /budget/plans` (MOL-117): a plan from a month on (В-1, Р-9), answered with the budget of that
 * month — the screen shows it at once. A sum is in the spending currency (Р-1): one typed in another
 * is a phone that missed a move, and is refused rather than kept as a plan nobody chose. A category
 * that is not the owner's is the same `NOT_FOUND` as a missing one.
 */
export async function setBudgetPlan(
  repositories: Repositories,
  owner: Owner,
  body: BudgetPlanBody,
  now: Date = new Date(),
): Promise<MoneyBudgetView> {
  if (body.plan?.kind === 'amount' && body.plan.amount.currency !== owner.spendCurrency) {
    throw new DomainError(ERROR.CURRENCY_MISMATCH)
  }
  const written = await repositories.budgetPlans.set(
    owner.id,
    body.categoryId,
    body.from,
    body.plan,
  )
  if (!written) throw new DomainError(ERROR.NOT_FOUND)
  return moneyBudgetOf(repositories, owner, body.from, now)
}
