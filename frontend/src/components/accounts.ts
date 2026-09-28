import { formatEstimate, parseMoney } from '@molvia/model'
import type { Currency, Money, MoneyAccountView } from '@molvia/model'
import { asTyped } from '@/components/spending'
import { calendarDay, timeOfDay } from '@/days'

/** The minus of a figure — U+2212, never the hyphen `Intl` prints (handoff 01, 08). */
const MINUS = '\u2212'

/**
 * An account's money as the handoff prints it: «190 132 ֏», «515,81 ₽», «−12 400 ₽». `plus` puts
 * «+» on money in — a journal row always carries its sign (handoff 04); `estimate` rounds to whole
 * units, for a figure the server counted by a rate.
 */
export function signedAmount(
  value: Money,
  locale: string,
  options: { plus?: boolean; estimate?: boolean } = {},
): string {
  const size = { ...value, minor: value.minor < 0n ? -value.minor : value.minor }
  const text = options.estimate ? formatEstimate(size, locale) : asTyped(size, locale)
  if (value.minor < 0n) return `${MINUS}${text}`
  return options.plus && value.minor > 0n ? `+${text}` : text
}

/**
 * A balance as typed, below zero for a card in debt: «−12 400», «-12400,50», «0». Null when it is
 * not money. The sign is the phone's to read; the number is the model's, as every amount typed.
 */
export function parseSigned(text: string, currency: Currency): Money | null {
  const trimmed = text.trim()
  const negative = trimmed.startsWith('-') || trimmed.startsWith(MINUS)
  try {
    const money = parseMoney(negative ? trimmed.slice(1) : trimmed, currency)
    return negative ? { ...money, minor: -money.minor } : money
  } catch {
    return null
  }
}

/** «16 сент.» — a day of an account, its start or its check. */
export function shortDay(day: string, locale: string): string {
  return calendarDay(day, locale, { day: 'numeric', month: 'short' })
}

/**
 * When the balances on screen were counted — «14:05» today, «25 сент., 14:05» before: offline the
 * age of the figures is said exactly (handoff 02, «на 14:05»).
 */
export function countedWhen(at: Date, locale: string, now = new Date()): string {
  const time = timeOfDay(at, locale)
  if (at.toDateString() === now.toDateString()) return time
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(at)
  return `${day}, ${time}`
}

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
