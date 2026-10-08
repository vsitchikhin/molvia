import { DomainError, ERROR, latestDay, transferViewOf } from '@molvia/model'
import type {
  Actor,
  TransferAmendBody,
  TransferBody,
  TransferResponse,
  TransferView,
  MoneyAccountsResponse,
} from '@molvia/model'
import { moneyAccountsOf } from './money-accounts'
import { rateOfDay } from './spendings'
import type { FeeSpending } from '@/db/transfers-repository'
import type { TripRepositories } from '@/db/unit-of-work'
import type { Today } from './today'

type Repositories = Pick<
  TripRepositories,
  'transfers' | 'moneyAccounts' | 'spendingCategories' | 'exchanges' | 'incomes' | 'rates'
>
type Owner = Pick<Actor, 'id' | 'incomeCurrency' | 'spendCurrency'> & Today

/**
 * What the fee is written as (MOL-253, Р-1): the owner's «Прочее» — a preset every person is given —
 * and the rate of the transfer's day into the spending currency, the snapshot every spending keeps.
 * None when the transfer has no fee.
 */
async function feeOf(
  repositories: Repositories,
  owner: Owner,
  body: Pick<TransferBody, 'fee' | 'transferredOn'>,
): Promise<FeeSpending | null> {
  if (body.fee === undefined) return null
  const categories = await repositories.spendingCategories.list(owner.id)
  const other = categories.find((category) => category.preset === 'other')
  // Every person is given the presets before the list answers; one missing is a defect, not a case.
  if (!other) throw new Error('the owner has no «Прочее» to write a transfer’s fee in')
  const rate = await rateOfDay(repositories, owner, {
    spentOn: body.transferredOn,
    amount: body.fee,
  })
  return { categoryId: other.id, rate }
}

/** Not a day that has not come yet anywhere (`latestDay`, MOL-121): the phone's may be ahead. */
function notAhead(body: Pick<TransferBody, 'transferredOn'>, now: Date): void {
  if (body.transferredOn > latestDay(now)) throw new DomainError(ERROR.TRANSFER_IN_FUTURE)
}

/**
 * «Перевести» (MOL-253): money moved between two of one's own accounts of one currency, its fee an
 * ordinary spending of the source. 201 for a new transfer, 200 for the same one sent again after a
 * lost answer; the transfer and «Счета» whole either way — the two balances are the server's.
 */
export async function recordTransfer(
  repositories: Repositories,
  owner: Owner,
  body: TransferBody,
  now: Date = new Date(),
): Promise<{ response: TransferResponse; created: boolean }> {
  notAhead(body, now)
  const fee = await feeOf(repositories, owner, body)
  // One removal is offered back at a time, as an exchange's is.
  await repositories.transfers.purgeRemoved(owner.id)
  const { transfer, created } = await repositories.transfers.add(owner.id, body, fee)
  return {
    response: {
      transfer: transferViewOf(transfer),
      accounts: await moneyAccountsOf(repositories, owner, now),
    },
    created,
  }
}

/** «Сохранить» an amended transfer, its fee with it; the version before it kept. */
export async function amendTransfer(
  repositories: Repositories,
  owner: Owner,
  id: string,
  body: TransferAmendBody,
  now: Date = new Date(),
): Promise<TransferResponse> {
  notAhead(body, now)
  const fee = await feeOf(repositories, owner, body)
  await repositories.transfers.purgeRemoved(owner.id)
  const { transfer } = await repositories.transfers.amend(owner.id, id, body, fee)
  return {
    transfer: transferViewOf(transfer),
    accounts: await moneyAccountsOf(repositories, owner, now),
  }
}

/** One transfer of the owner's, as its sheet opens it; missing, removed and someone else's are one. */
export async function transferOfOwner(
  repositories: Pick<Repositories, 'transfers'>,
  owner: Pick<Owner, 'id'>,
  id: string,
): Promise<TransferView> {
  const transfer = await repositories.transfers.byId(owner.id, id)
  if (!transfer) throw new DomainError(ERROR.NOT_FOUND)
  return transferViewOf(transfer)
}

/**
 * «Удалить перевод»: marked with its fee and offered back for ten minutes. The one removed before it
 * is made final — but never this one, when the removal is sent again after a lost answer. «Счета»
 * whole; a transfer that is not the owner's moves nothing and answers the same.
 */
export async function removeTransfer(
  repositories: Repositories,
  owner: Owner,
  id: string,
  now: Date = new Date(),
): Promise<MoneyAccountsResponse> {
  await repositories.transfers.purgeRemoved(owner.id, id)
  await repositories.transfers.remove(owner.id, id)
  return moneyAccountsOf(repositories, owner, now)
}

/** «Вернуть»: the transfer and its fee as they were; 404 once it is final or never was the owner's. */
export async function restoreTransfer(
  repositories: Repositories,
  owner: Owner,
  id: string,
  now: Date = new Date(),
): Promise<TransferResponse> {
  if (!(await repositories.transfers.restore(owner.id, id))) throw new DomainError(ERROR.NOT_FOUND)
  return {
    transfer: await transferOfOwner(repositories, owner, id),
    accounts: await moneyAccountsOf(repositories, owner, now),
  }
}
