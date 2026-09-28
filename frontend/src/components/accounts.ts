import type { Currency, MoneyAccountView } from '@molvia/model'

/**
 * The live accounts in the order of the page «Счета» (handoff 02): for spending first, then the
 * savings, each group in the order the accounts were added — the order the server answers in. A
 * removed account is on no list of choice (MOL-115, Р-22).
 */
export function pageOrder(accounts: readonly MoneyAccountView[]): MoneyAccountView[] {
  const live = accounts.filter((account) => account.archivedAt === null)
  return [
    ...live.filter((account) => !account.savings),
    ...live.filter((account) => account.savings),
  ]
}

/** The removed ones, for «Убранные (N)» — in the order they were added, as everything else. */
export function removedOf(accounts: readonly MoneyAccountView[]): MoneyAccountView[] {
  return accounts.filter((account) => account.archivedAt !== null)
}

/**
 * The account a new operation starts on (handoff 06, Р-9): the first live one in the operation's
 * currency, in the order of the page, else none. The screen puts it in; the server never guesses.
 */
export function defaultAccount(
  accounts: readonly MoneyAccountView[],
  currency: Currency,
): MoneyAccountView | null {
  return pageOrder(accounts).find((account) => account.currency === currency) ?? null
}

/**
 * What a picker offers (handoff 06): the accounts in the operation's currency, and — for a spending
 * and a trip, whose other currency «списано» covers — the rest. An income and an exchange take only
 * their own currency: money lands on an account in its currency or it is not that account.
 */
export function pickerGroups(
  accounts: readonly MoneyAccountView[],
  currency: Currency,
  strict: boolean,
): { readonly own: MoneyAccountView[]; readonly other: MoneyAccountView[] } {
  const live = pageOrder(accounts)
  return {
    own: live.filter((account) => account.currency === currency),
    other: strict ? [] : live.filter((account) => account.currency !== currency),
  }
}
