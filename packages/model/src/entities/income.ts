import { z } from 'zod'
import {
  EXCHANGE_UNDO_MINUTES,
  exchangeDaySchema,
  exchangeNoteSchema,
} from '#model/entities/exchange'
import { INT8_MAX } from '#model/support/decimal'
import { ERROR, ISSUE } from '#model/support/errors'
import { priceSchema } from '#model/values/money'
import type { Currency, Money } from '#model/values/money'

/**
 * Where money came from — the owner's own list from the sheet the app replaces (MOL-66, В-3):
 * a closed list, so a month's sum can always tell a salary from the money brought on arrival. A
 * new source is a migration, as a new currency is.
 */
export const incomeSourceSchema = z.enum([
  'salary',
  'bonus',
  'freelance',
  'debt_return',
  'sale',
  'gift',
  'interest',
  'brought',
  'other',
])
export type IncomeSource = z.infer<typeof incomeSourceSchema>

/** The same ten minutes as an exchange (В-7): one rule for removing one's own money. */
export const INCOME_UNDO_MINUTES = EXCHANGE_UNDO_MINUTES

const positiveMoneySchema = priceSchema.refine((value) => value.minor > 0n, {
  error: ERROR.INVALID_AMOUNT,
})

/**
 * Money that came in with nothing given for it (MOL-66): the actual day, amount and currency, and
 * where it came from. Nothing expected is ever written — only what arrived.
 *
 * `heldBefore` is how much of that currency the person had just before it, as for an exchange: the
 * weight the old money keeps when the new is valued at the official rate of its day (В-1). Optional;
 * unknown, the income's own value stands alone.
 */
export const incomeSchema = z
  .object({
    id: z.uuid(),
    actorId: z.uuid(),
    amount: positiveMoneySchema,
    receivedOn: exchangeDaySchema,
    heldBefore: priceSchema.nullable(),
    source: incomeSourceSchema,
    note: exchangeNoteSchema.nullable(),
    revision: z.int().min(1),
    createdAt: z.date(),
    amendedAt: z.date().nullable(),
  })
  .refine(
    ({ heldBefore, amount }) => heldBefore === null || heldBefore.currency === amount.currency,
    { error: ISSUE.INCOME_HELD_NOT_RECEIVED },
  )
export type Income = z.infer<typeof incomeSchema>

/** A version an income had before it was amended, and when it stopped being the income. */
export interface IncomeRevision {
  readonly revision: number
  readonly amount: Money
  readonly receivedOn: string
  readonly heldBefore: Money | null
  readonly source: IncomeSource
  readonly note: string | null
  readonly replacedAt: Date
}

/** A calendar month of incomes: what came in per currency, and the incomes themselves. */
export interface IncomeMonth {
  /** `YYYY-MM` of the day the money came in on, in Yerevan. */
  readonly month: string
  /** What came in per currency, never converted (MOL-66, В-2), by currency code. */
  readonly sums: readonly Money[]
  readonly incomes: readonly Income[]
}

/**
 * The incomes by month, newest first, each newest first within — the list «Доходы» shows. A sum no
 * money can hold is left out rather than thrown: the screen would fail whole, and with it the one
 * way to remove the income that made it (the lesson of MOL-40, adversarial А1). The rows stay.
 */
export function incomeMonths(incomes: readonly Income[]): IncomeMonth[] {
  const newestFirst = [...incomes].sort((a, b) => {
    if (a.receivedOn !== b.receivedOn) return a.receivedOn < b.receivedOn ? 1 : -1
    const time = b.createdAt.getTime() - a.createdAt.getTime()
    return time !== 0 ? time : a.id < b.id ? 1 : -1
  })
  const months = new Map<string, Income[]>()
  for (const income of newestFirst) {
    const month = income.receivedOn.slice(0, 7)
    months.set(month, [...(months.get(month) ?? []), income])
  }
  return [...months].map(([month, list]) => {
    const byCurrency = new Map<Currency, bigint>()
    for (const { amount } of list) {
      byCurrency.set(amount.currency, (byCurrency.get(amount.currency) ?? 0n) + amount.minor)
    }
    const sums = [...byCurrency]
      .filter(([, minor]) => minor <= INT8_MAX)
      .map(([currency, minor]) => ({ minor, currency }))
      .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0))
    return { month, sums, incomes: list }
  })
}
