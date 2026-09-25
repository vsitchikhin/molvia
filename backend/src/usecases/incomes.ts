import { DomainError, ERROR, incomeMonths, yerevanDate } from '@molvia/model'
import type {
  Actor,
  Income,
  IncomeAmendBody,
  IncomeBody,
  IncomeRevision,
  IncomeView,
  IncomesResponse,
} from '@molvia/model'
import { ownMoney } from './exchanges'
import type { TripRepositories } from '@/db/unit-of-work'

type Repositories = Pick<TripRepositories, 'exchanges' | 'incomes' | 'rates'>
type Owner = Pick<Actor, 'id' | 'incomeCurrency' | 'spendCurrency'>

function viewOf(income: Income, history: readonly IncomeRevision[]): IncomeView {
  return {
    id: income.id,
    receivedOn: income.receivedOn,
    amount: income.amount,
    heldBefore: income.heldBefore,
    source: income.source,
    note: income.note,
    revision: income.revision,
    amendedAt: income.amendedAt,
    history: history.map(({ amount, receivedOn, heldBefore, source, note, replacedAt }) => ({
      amount,
      receivedOn,
      heldBefore,
      source,
      note,
      replacedAt,
    })),
  }
}

/**
 * «Доходы» whole (MOL-66): the months with what came in per currency, every income with its
 * earlier versions, and what the sheet asks «сколько было до поступления» by — the same walk of
 * the person's money «Обмен денег» is built from, so the two screens cannot disagree about it.
 */
export async function incomesOverview(
  repositories: Repositories,
  owner: Owner,
  now: Date = new Date(),
): Promise<IncomesResponse> {
  const [money, history] = await Promise.all([
    ownMoney(repositories, owner, now),
    repositories.incomes.history(owner.id),
  ])
  return {
    base: money.base,
    baseSince: money.baseSince,
    months: incomeMonths(money.incomes).map(({ month, sums, incomes }) => ({
      month,
      sums: [...sums],
      incomes: incomes.map((income) => viewOf(income, history.get(income.id) ?? [])),
    })),
    receipts: [...money.receipts],
    heldEstimates: money.heldEstimates,
  }
}

/** The screen as it is on opening. A removed income is final from here (В-5). */
export async function readIncomes(
  repositories: Repositories,
  owner: Owner,
  now: Date = new Date(),
): Promise<IncomesResponse> {
  await repositories.incomes.purgeRemoved(owner.id)
  return incomesOverview(repositories, owner, now)
}

/**
 * «Записать доход». Not a day that has not come yet in Yerevan: money from tomorrow would enter
 * today's trips. 201 for a new income, and the screen whole either way.
 */
export async function recordIncome(
  repositories: Repositories,
  owner: Owner,
  body: IncomeBody,
  now: Date = new Date(),
): Promise<{ overview: IncomesResponse; created: boolean }> {
  if (body.receivedOn > yerevanDate(now)) throw new DomainError(ERROR.INCOME_IN_FUTURE)
  await repositories.incomes.purgeRemoved(owner.id)
  const { created } = await repositories.incomes.add(owner.id, body)
  return { overview: await incomesOverview(repositories, owner, now), created }
}

/**
 * «Сохранить правку»: the income as it should now be, the version before it kept. Trips already
 * started keep the rate they took; trips from now on count by the amended income.
 */
export async function amendIncome(
  repositories: Repositories,
  owner: Owner,
  id: string,
  body: IncomeAmendBody,
  now: Date = new Date(),
): Promise<IncomesResponse> {
  if (body.receivedOn > yerevanDate(now)) throw new DomainError(ERROR.INCOME_IN_FUTURE)
  await repositories.incomes.purgeRemoved(owner.id)
  await repositories.incomes.amend(owner.id, id, body)
  return incomesOverview(repositories, owner, now)
}

/**
 * «Удалить доход»: marked, offered back for ten minutes. The one removed before it is made final —
 * but never this one, when the removal is sent again after a lost answer.
 */
export async function removeIncome(
  repositories: Repositories,
  owner: Owner,
  id: string,
  now: Date = new Date(),
): Promise<IncomesResponse> {
  await repositories.incomes.purgeRemoved(owner.id, id)
  await repositories.incomes.remove(owner.id, id)
  return incomesOverview(repositories, owner, now)
}

/** «Вернуть»: the removed income as it was; nothing to bring back answers as a missing row does. */
export async function restoreIncome(
  repositories: Repositories,
  owner: Owner,
  id: string,
  now: Date = new Date(),
): Promise<IncomesResponse> {
  if (!(await repositories.incomes.restore(owner.id, id))) {
    throw new DomainError(ERROR.NOT_FOUND)
  }
  return incomesOverview(repositories, owner, now)
}
