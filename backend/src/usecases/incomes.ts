import { DomainError, ERROR, incomeMonths, resourceIdOf, yerevanDate } from '@molvia/model'
import type {
  Actor,
  Income,
  IncomeAmendBody,
  IncomeBody,
  IncomeRevision,
  IncomeView,
  IncomesResponse,
} from '@molvia/model'
import { earlier, ownMoney } from './exchanges'
import type { TripRepositories } from '@/db/unit-of-work'

type Repositories = Pick<TripRepositories, 'exchanges' | 'incomes' | 'rates'>
/** A write also lets go of the months frozen without it (MOL-73, В-6). */
type Writing = Repositories & Pick<TripRepositories, 'money'>
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

/** The day of the owner's live income, or null — what a write lets the frozen months go from. */
async function dayOfIncome(
  repositories: Pick<Repositories, 'incomes'>,
  owner: Pick<Owner, 'id'>,
  id: string,
): Promise<string | null> {
  const own = resourceIdOf(id)
  const incomes = await repositories.incomes.list(owner.id)
  return incomes.find((income) => income.id === own)?.receivedOn ?? null
}

/**
 * «Записать доход». Not a day that has not come yet in Yerevan: money from tomorrow would enter
 * today's trips. 201 for a new income, and the screen whole either way.
 */
export async function recordIncome(
  repositories: Writing,
  owner: Owner,
  body: IncomeBody,
  now: Date = new Date(),
): Promise<{ overview: IncomesResponse; created: boolean }> {
  if (body.receivedOn > yerevanDate(now)) throw new DomainError(ERROR.INCOME_IN_FUTURE)
  await repositories.incomes.purgeRemoved(owner.id)
  const { created } = await repositories.incomes.add(owner.id, body)
  await repositories.money.thaw(owner.id, body.receivedOn)
  return { overview: await incomesOverview(repositories, owner, now), created }
}

/**
 * «Сохранить правку»: the income as it should now be, the version before it kept. Trips already
 * started keep the rate they took; trips from now on count by the amended income.
 */
export async function amendIncome(
  repositories: Writing,
  owner: Owner,
  id: string,
  body: IncomeAmendBody,
  now: Date = new Date(),
): Promise<IncomesResponse> {
  if (body.receivedOn > yerevanDate(now)) throw new DomainError(ERROR.INCOME_IN_FUTURE)
  await repositories.incomes.purgeRemoved(owner.id)
  const before = await dayOfIncome(repositories, owner, id)
  await repositories.incomes.amend(owner.id, id, body)
  await repositories.money.thaw(owner.id, earlier(before, body.receivedOn))
  return incomesOverview(repositories, owner, now)
}

/**
 * «Удалить доход»: marked, offered back for ten minutes. The one removed before it is made final —
 * but never this one, when the removal is sent again after a lost answer.
 */
export async function removeIncome(
  repositories: Writing,
  owner: Owner,
  id: string,
  now: Date = new Date(),
): Promise<IncomesResponse> {
  await repositories.incomes.purgeRemoved(owner.id, id)
  const day = await dayOfIncome(repositories, owner, id)
  await repositories.incomes.remove(owner.id, id)
  if (day !== null) await repositories.money.thaw(owner.id, day)
  return incomesOverview(repositories, owner, now)
}

/** «Вернуть»: the removed income as it was; nothing to bring back answers as a missing row does. */
export async function restoreIncome(
  repositories: Writing,
  owner: Owner,
  id: string,
  now: Date = new Date(),
): Promise<IncomesResponse> {
  if (!(await repositories.incomes.restore(owner.id, id))) {
    throw new DomainError(ERROR.NOT_FOUND)
  }
  const day = await dayOfIncome(repositories, owner, id)
  if (day !== null) await repositories.money.thaw(owner.id, day)
  return incomesOverview(repositories, owner, now)
}
