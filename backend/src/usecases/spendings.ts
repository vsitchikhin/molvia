import {
  DomainError,
  ERROR,
  categoryOrder,
  spendingCategoryViewOf,
  yerevanDate,
} from '@molvia/model'
import type {
  Actor,
  ExchangeRate,
  Spending,
  SpendingAmendBody,
  SpendingBody,
  SpendingCategoriesResponse,
  SpendingCategoryBody,
  SpendingView,
} from '@molvia/model'
import { dayRates } from './money-rates'
import type { TripRepositories } from '@/db/unit-of-work'

type Repositories = Pick<
  TripRepositories,
  'spendings' | 'spendingCategories' | 'exchanges' | 'incomes' | 'rates'
>
type Owner = Pick<Actor, 'id' | 'incomeCurrency' | 'spendCurrency'>

export function spendingViewOf(spending: Spending): SpendingView {
  return {
    id: spending.id,
    spentOn: spending.spentOn,
    amount: spending.amount,
    categoryId: spending.categoryId,
    note: spending.note,
    place: spending.place,
    rate: spending.rate,
    revision: spending.revision,
    amendedAt: spending.amendedAt,
  }
}

/**
 * The rules every write of a spending is held to before it is written: not after today in Yerevan,
 * and a category of the owner's own — a removed one included, because a spending queued offline
 * must not be lost to a category taken out of the choice on another phone meanwhile.
 */
async function checked(
  repositories: Pick<Repositories, 'spendingCategories'>,
  owner: Owner,
  body: Pick<SpendingBody, 'spentOn' | 'categoryId'>,
  now: Date,
): Promise<void> {
  if (body.spentOn > yerevanDate(now)) throw new DomainError(ERROR.SPENDING_IN_FUTURE)
  const categories = await repositories.spendingCategories.list(owner.id)
  if (!categories.some((category) => category.id === body.categoryId)) {
    throw new DomainError(ERROR.SPENDING_CATEGORY_UNKNOWN)
  }
}

/**
 * The rate a spending in another currency is counted by: the spending currency's, on the
 * spending's own day, by the rule a trip started that day uses — the person's own, else the central
 * bank's. Taken when it is written and never again (CLAUDE.md, «The rate is stored with the
 * transaction»).
 */
async function rateOfDay(
  repositories: Repositories,
  owner: Owner,
  body: Pick<SpendingBody, 'spentOn' | 'amount'>,
): Promise<ExchangeRate | null> {
  if (body.amount.currency === owner.spendCurrency) return null
  const rates = await dayRates(repositories, owner)
  return rates.on(body.amount.currency, owner.spendCurrency, body.spentOn)
}

/** «Сохранить» a new spending: 201, or 200 for the same one sent again from the queue. */
export async function recordSpending(
  repositories: Repositories,
  owner: Owner,
  body: SpendingBody,
  now: Date = new Date(),
): Promise<{ spending: SpendingView; created: boolean }> {
  await checked(repositories, owner, body, now)
  // Any earlier removal is final from here: offered back only until the next write (В-4).
  await repositories.spendings.purgeRemoved(owner.id)
  const rate = await rateOfDay(repositories, owner, body)
  const { spending, created } = await repositories.spendings.add(owner.id, body, rate)
  return { spending: spendingViewOf(spending), created }
}

/**
 * «Сохранить» an amendment. The rate is taken anew only when the day or the currency changed —
 * those make it another fact; a corrected note keeps the rate the spending was written with.
 */
export async function amendSpending(
  repositories: Repositories,
  owner: Owner,
  id: string,
  body: SpendingAmendBody,
  now: Date = new Date(),
): Promise<SpendingView> {
  // Found first: someone else's spending is one answer whatever the body says about it.
  const held = await repositories.spendings.byId(owner.id, id)
  if (!held) throw new DomainError(ERROR.NOT_FOUND)
  await checked(repositories, owner, body, now)
  await repositories.spendings.purgeRemoved(owner.id)
  const same = held.spentOn === body.spentOn && held.amount.currency === body.amount.currency
  const rate = same ? held.rate : await rateOfDay(repositories, owner, body)
  const { spending } = await repositories.spendings.amend(owner.id, id, body, rate)
  return spendingViewOf(spending)
}

/** «Удалить трату»: marked and gone from every reader, offered back for ten minutes (В-4). */
export async function removeSpending(
  repositories: Pick<Repositories, 'spendings'>,
  owner: Owner,
  id: string,
): Promise<void> {
  await repositories.spendings.purgeRemoved(owner.id, id)
  await repositories.spendings.remove(owner.id, id)
}

/** «Вернуть»: the same spending, the same identifier; 404 once it is final or never was the owner's. */
export async function restoreSpending(
  repositories: Pick<Repositories, 'spendings'>,
  owner: Owner,
  id: string,
): Promise<SpendingView> {
  if (!(await repositories.spendings.restore(owner.id, id))) throw new DomainError(ERROR.NOT_FOUND)
  const spending = await repositories.spendings.byId(owner.id, id)
  if (!spending) throw new DomainError(ERROR.NOT_FOUND)
  return spendingViewOf(spending)
}

/** The owner's categories in the order of the chips, the removed ones marked (В-3). */
export async function spendingCategoriesOf(
  repositories: Pick<Repositories, 'spendingCategories'>,
  owner: Pick<Owner, 'id'>,
): Promise<SpendingCategoriesResponse> {
  const categories = await repositories.spendingCategories.list(owner.id)
  return { categories: categoryOrder(categories).map(spendingCategoryViewOf) }
}

/** «Добавить категорию»: the list whole, and whether this one is new. */
export async function addSpendingCategory(
  repositories: Pick<Repositories, 'spendingCategories'>,
  owner: Pick<Owner, 'id'>,
  body: SpendingCategoryBody,
): Promise<{ list: SpendingCategoriesResponse; created: boolean }> {
  const { created } = await repositories.spendingCategories.add(owner.id, body)
  return { list: await spendingCategoriesOf(repositories, owner), created }
}

/** «Убрать из выбора» / «Вернуть»: the list whole; 404 for a category that is not the owner's. */
export async function archiveSpendingCategory(
  repositories: Pick<Repositories, 'spendingCategories'>,
  owner: Pick<Owner, 'id'>,
  id: string,
  archived: boolean,
): Promise<SpendingCategoriesResponse> {
  const done = archived
    ? await repositories.spendingCategories.archive(owner.id, id)
    : await repositories.spendingCategories.restore(owner.id, id)
  if (!done) throw new DomainError(ERROR.NOT_FOUND)
  return spendingCategoriesOf(repositories, owner)
}
