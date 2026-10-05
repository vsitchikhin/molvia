import { markRaw } from 'vue'
import IconCashPlus from '~icons/mdi/cash-plus'
import IconSwap from '~icons/mdi/swap-horizontal'
import { formatEstimate, parseMoney } from '@molvia/model'
import type {
  AccountOperationView,
  Currency,
  Money,
  MoneyAccountView,
  SpendingCategoryView,
} from '@molvia/model'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { asTyped, spendingLook, tripIcon, tripTint, unbroken } from '@/components/spending'
import type { OperationRowProps, Translate } from '@/components/spending'
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

/**
 * The note «Записать разницу» writes, in every language the app speaks: written on a Russian screen
 * and read on an English one it is still «Прочее · сверка» (review 29).
 */
const RECONCILE_NOTES = new Set([ru.accounts.reconcile.note, en.accounts.reconcile.note])

/** A size of money with no sign — the words around it say which way it went. */
function unsigned(value: Money, locale: string): string {
  return asTyped({ ...value, minor: value.minor < 0n ? -value.minor : value.minor }, locale)
}

/**
 * One operation as an account's journal, «не попали» and a check list it (MOL-123, handoff 04, 05):
 * a spending, a trip, an income or one side of an exchange, each in its own words. `inAccount`, the
 * amount is what it did to that account — «≈» when a rate of its day counted it — and under it the
 * operation's own money when that was another currency. Out of any account, it is the operation's own
 * amount. Always with its sign, and never in a colour: only a balance below zero is «плохо» (handoff
 * 04, 116 v2 2d).
 */
export function operationRowProps(
  operation: AccountOperationView,
  context: {
    readonly t: Translate
    readonly locale: string
    readonly categories: readonly SpendingCategoryView[]
    readonly nameOf: (category: SpendingCategoryView) => string
    /** The name of an account by its id — the other half of an exchange. */
    readonly accountName: (id: string) => string | null
    readonly inAccount?: boolean
  },
): OperationRowProps {
  const { t } = context
  const { kind } = operation
  const groceries = context.categories.find((one) => one.preset === 'groceries') ?? null
  const category =
    kind === 'trip'
      ? groceries
      : (context.categories.find((one) => one.id === operation.categoryId) ?? null)
  const categoryName = category ? context.nameOf(category) : t('spending.category.other', {})
  // «Прочее · сверка»: what «Записать разницу» wrote (handoff 05) — its note and «Прочее».
  const reconciled =
    operation.note !== null &&
    RECONCILE_NOTES.has(operation.note) &&
    (kind === 'income' ? operation.source === 'other' : category?.preset === 'other')

  let look: { readonly icon: OperationRowProps['icon']; readonly tint: string }
  if (kind === 'trip') look = { icon: tripIcon, tint: tripTint(groceries) }
  else if (kind === 'income') look = { icon: markRaw(IconCashPlus), tint: 'muted' }
  else if (kind === 'exchange') look = { icon: markRaw(IconSwap), tint: 'muted' }
  else look = spendingLook(category)

  return {
    ...look,
    verb: t('accounts.account.row_open', {}),
    title: titleOf(operation, reconciled, categoryName, t),
    meta: metaOf(operation, reconciled, categoryName, context),
    amount: amountOf(operation, context),
    sub: subOf(operation, context),
    tag: null,
  }
}

function titleOf(
  operation: AccountOperationView,
  reconciled: boolean,
  categoryName: string,
  t: Translate,
): string {
  if (reconciled) return t('accounts.account.reconcile_row', {})
  switch (operation.kind) {
    case 'trip':
      return t('spending.trip_row_title', { place: operation.place ?? '' })
    case 'income':
      return t(`income.source.${operation.source ?? 'other'}`, {})
    case 'exchange':
      return t('accounts.account.exchange', {})
    default:
      return operation.note ?? categoryName
  }
}

function metaOf(
  operation: AccountOperationView,
  reconciled: boolean,
  categoryName: string,
  context: Parameters<typeof operationRowProps>[1],
): string {
  const { t, locale } = context
  if (reconciled)
    return t(
      operation.kind === 'income'
        ? 'accounts.account.reconcile_in'
        : 'accounts.account.reconcile_out',
      {},
    )
  switch (operation.kind) {
    case 'trip': {
      const items = operation.items ?? 0
      const line = t('spending.trip_row_meta', { category: categoryName, n: items }, items)
      return operation.unpriced > 0
        ? `${line}, ${String(operation.unpriced)} ${t('accounts.trip_unpriced', {})}`
        : line
    }
    case 'income':
      return [t('income.fab', {}), operation.note].filter(Boolean).join(' · ')
    case 'exchange': {
      const other = operation.counterpart
      if (!other) return ''
      const amount = unsigned(other.amount, locale)
      const name = other.accountId ? context.accountName(other.accountId) : null
      if (!name) return amount
      return t(
        operation.side === 'received'
          ? 'accounts.account.exchange_from'
          : 'accounts.account.exchange_to',
        { name, amount },
      )
    }
    default: {
      const { note, place } = operation
      if (note === null) return place ?? ''
      return place ? `${categoryName} · ${place}` : categoryName
    }
  }
}

function amountOf(
  operation: AccountOperationView,
  context: Parameters<typeof operationRowProps>[1],
): string | null {
  const { t, locale } = context
  if (!context.inAccount) {
    const [own] = operation.amounts
    return own ? signedAmount(own, locale, { plus: true }) : null
  }
  if (!operation.moved) return t('spending.uncounted_row', {})
  const text = signedAmount(operation.moved, locale, {
    plus: true,
    estimate: operation.approximate,
  })
  return operation.approximate ? `≈ ${text}` : text
}

/** «9 891 ֏ · списано», «24,99 € · без «списано»» — only where it was another currency. */
function subOf(
  operation: AccountOperationView,
  context: Parameters<typeof operationRowProps>[1],
): string | null {
  const moved = operation.moved
  if (!context.inAccount || !moved) return null
  const other = operation.amounts.filter((one) => one.currency !== moved.currency)
  if (other.length === 0) return null
  const amount = other.map((one) => unsigned(one, context.locale)).join(', ')
  return unbroken(
    context.t(
      operation.debited ? 'accounts.account.charged_sub' : 'accounts.account.no_charged_sub',
      { amount },
    ),
  )
}
