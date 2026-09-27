import { DomainError, ERROR } from '@molvia/model'
import type { Actor, Currency, Money, MoneyAccount } from '@molvia/model'
import type { TripRepositories } from '@/db/unit-of-work'

/**
 * The accounts an operation may name: the owner's own, a removed and a marked one included — what
 * was written offline is not lost to an account taken away elsewhere meanwhile (Р-12, Р-17).
 */
export async function knownAccounts(
  repositories: Pick<TripRepositories, 'moneyAccounts'>,
  owner: Pick<Actor, 'id'>,
): Promise<ReadonlyMap<string, MoneyAccount>> {
  const accounts = await repositories.moneyAccounts.known(owner.id)
  return new Map(accounts.map((account) => [account.id, account]))
}

/**
 * An account the owner has not got is «без счёта», never a refusal (adversarial Д3, Р-28): an
 * operation queued offline onto an account deleted for good on another phone is written and lands
 * in «не попали» — refused, the queue would set it aside and the money would be lost. Someone
 * else's account is the same answer, so nothing tells the two apart.
 */
function ownOrNone(
  accounts: ReadonlyMap<string, MoneyAccount>,
  accountId: string | null,
): MoneyAccount | null {
  return accountId === null ? null : (accounts.get(accountId) ?? null)
}

/**
 * The account an income or a side of an exchange lands on or leaves, as it will be written: one of
 * the owner's, of the money's own currency — or it is not that account (MOL-115, п. 4).
 */
export function sideOf(
  accounts: ReadonlyMap<string, MoneyAccount>,
  accountId: string | null,
  currency: Currency,
): string | null {
  const account = ownOrNone(accounts, accountId)
  if (account === null) return null
  if (account.currency !== currency) throw new DomainError(ERROR.MONEY_ACCOUNT_CURRENCY)
  return account.id
}

/**
 * The account a spending or a trip was paid from, and «списано» as it will be written.
 *
 * Left out of the body — a screen older than accounts — the account is kept as it was (Р-26), and
 * so is «списано» while it still applies. Sent, «списано» is held to its rules: in the account's
 * currency, and only when some money of the operation — `currencies`: a spending's one, a trip's
 * own and every purchase's (adversarial Д2) — is in another (MOL-43 В-3).
 */
export function paymentOf(
  accounts: ReadonlyMap<string, MoneyAccount>,
  held: { readonly accountId: string | null; readonly debited: Money | null } | null,
  body: {
    readonly accountId?: string | null | undefined
    readonly debited?: Money | null | undefined
  },
  currencies: readonly Currency[],
): { accountId: string | null; debited: Money | null } {
  const account = ownOrNone(
    accounts,
    body.accountId === undefined ? (held?.accountId ?? null) : body.accountId,
  )
  const accountId = account?.id ?? null
  const applies = (debited: Money) =>
    debited.currency === account?.currency &&
    currencies.some((currency) => currency !== account.currency)
  if (body.debited === undefined) {
    const kept = held?.debited ?? null
    return {
      accountId,
      debited: kept !== null && held?.accountId === accountId && applies(kept) ? kept : null,
    }
  }
  // «Списано» from an account that is gone goes with it: nothing to have been taken from.
  if (body.debited === null || account === null) return { accountId, debited: null }
  if (!applies(body.debited)) throw new DomainError(ERROR.MONEY_ACCOUNT_CURRENCY)
  return { accountId, debited: body.debited }
}

/**
 * The account of an amended income or side of an exchange: the one sent, or — left out by a screen
 * older than accounts — the one it had, while that is still of the money's currency (Р-26). A kept
 * account the money no longer fits is dropped rather than refused: the person never saw it.
 */
export function keptSide(
  accounts: ReadonlyMap<string, MoneyAccount>,
  held: string | null,
  sent: string | null | undefined,
  currency: Currency,
): string | null {
  if (sent !== undefined) return sent
  if (held === null) return null
  return accounts.get(held)?.currency === currency ? held : null
}
