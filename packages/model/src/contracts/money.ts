import { z } from 'zod'
import { spendingCategoryViewCodec, spendingCategoryViewOf, spendingViewCodec } from './spending'
import { exchangeDaySchema } from '#model/entities/exchange'
import { journalKeyOf, journalOrder, lastDayOf } from '#model/entities/money-month'
import type { JournalKey, MoneyMonth, MonthEntry } from '#model/entities/money-month'
import type { Spending } from '#model/entities/spending'
import { categoryOrder } from '#model/entities/spending-category'
import type { SpendingCategory } from '#model/entities/spending-category'
import { currencySchema, moneyCodec, signedMoneyCodec } from '#model/values/money'
import { isRateDay, rateCodec } from '#model/values/rates'

/**
 * A calendar month as `YYYY-MM`, of the days a rate may be dated by: nothing of one's money is
 * older, and `0000-01` reached Postgres, which has no year zero, as a 500 (adversarial Д4).
 */
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .refine((month) => isRateDay(lastDayOf(month)))

/** How many rows of the journal one answer carries (handoff 01, «Догрузка»). */
export const MONEY_JOURNAL_PAGE = 40

/**
 * The cursor of the next page: the key of the last row shown — day, moment, name — never an offset,
 * which moved under the page whenever something was written above it (adversarial Д3).
 */
const JOURNAL_CURSOR = /^(\d{4}-\d{2}-\d{2})~(\d{1,16})~([\da-f-]{36}(?::[A-Z]{3})?)$/

export const journalCursorCodec = z.codec(
  z.string().regex(JOURNAL_CURSOR),
  z.custom<JournalKey>(),
  {
    decode: (text) => {
      const [, day = '', moment = '', id = ''] = JOURNAL_CURSOR.exec(text) ?? []
      return { day, moment: Number(moment), id }
    },
    encode: (key) => `${key.day}~${String(key.moment)}~${key.id}`,
  },
)

export const moneyMonthQuerySchema = z.strictObject({ cursor: journalCursorCodec.optional() })

const entryCodec = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('manual'),
    spending: spendingViewCodec,
    counted: moneyCodec.nullable(),
  }),
  z.strictObject({
    kind: z.literal('trip'),
    tripId: z.uuid(),
    placeName: z.string(),
    items: z.int().min(0),
    finishedOn: exchangeDaySchema,
    amount: moneyCodec,
    counted: moneyCodec.nullable(),
  }),
])

/**
 * `GET /money/months/:month` (MOL-73, handoff 06): the month of «Деньги» counted by the server — the
 * screen adds nothing up. The journal comes a page at a time, but every day's total is the whole
 * day's even when the page ends in its middle. `categories` names every category the month speaks
 * of — the removed ones too, since their spendings keep them.
 */
export const moneyMonthCodec = z.strictObject({
  month: monthSchema,
  spendCurrency: currencySchema,
  incomeCurrency: currencySchema,
  spent: moneyCodec,
  uncounted: z.array(moneyCodec),
  foreign: z.array(z.strictObject({ amount: moneyCodec, counted: moneyCodec })),
  spentIncome: moneyCodec.nullable(),
  income: moneyCodec,
  incomeUncounted: z.array(moneyCodec),
  rest: signedMoneyCodec.nullable(),
  rate: rateCodec.nullable(),
  rateKind: z.enum(['live', 'frozen']),
  previousSpent: moneyCodec.nullable(),
  byCategory: z.array(z.strictObject({ categoryId: z.uuid(), amount: moneyCodec })),
  categories: z.array(spendingCategoryViewCodec),
  days: z.array(
    z.strictObject({
      day: exchangeDaySchema,
      total: moneyCodec,
      estimated: z.boolean(),
      entries: z.array(entryCodec),
    }),
  ),
  /** The cursor of the next page, or null when the journal is whole. */
  cursor: journalCursorCodec.nullable(),
  /** Rows not yet sent, for «И ещё N трат» — and the days they span. */
  remaining: z.int().min(0),
  remainingFrom: exchangeDaySchema.nullable(),
  remainingTo: exchangeDaySchema.nullable(),
})
export type MoneyMonthView = z.output<typeof moneyMonthCodec>

function spendingViewOf(spending: Spending) {
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

function entryViewOf(entry: MonthEntry) {
  return entry.kind === 'manual'
    ? { kind: 'manual' as const, spending: spendingViewOf(entry.spending), counted: entry.counted }
    : {
        kind: 'trip' as const,
        tripId: entry.trip.tripId,
        placeName: entry.trip.placeName,
        items: entry.trip.items,
        finishedOn: entry.trip.finishedOn,
        amount: entry.trip.amount,
        counted: entry.counted,
      }
}

/** The month as it goes on the wire: one page of the journal after `after`, and everything else whole. */
export function moneyMonthViewOf(
  month: MoneyMonth,
  previousSpent: MoneyMonth['spent'] | null,
  categories: readonly SpendingCategory[],
  after?: JournalKey,
): MoneyMonthView {
  const rows = month.days
    .flatMap((day) => day.entries.map((entry) => ({ day, entry, key: journalKeyOf(entry) })))
    .filter(({ key }) => after === undefined || journalOrder(after, key) < 0)
  const page = rows.slice(0, MONEY_JOURNAL_PAGE)
  const rest = rows.slice(MONEY_JOURNAL_PAGE)

  const days: MoneyMonthView['days'] = []
  for (const { day, entry } of page) {
    const last = days.at(-1)
    if (last?.day === day.day) last.entries.push(entryViewOf(entry))
    else days.push({ ...day, entries: [entryViewOf(entry)] })
  }

  return {
    month: month.month,
    spendCurrency: month.spendCurrency,
    incomeCurrency: month.incomeCurrency,
    spent: month.spent,
    spentIncome: month.spentIncome,
    income: month.income,
    rest: month.rest,
    rate: month.rate,
    rateKind: month.rateKind,
    uncounted: [...month.uncounted],
    foreign: [...month.foreign],
    incomeUncounted: [...month.incomeUncounted],
    byCategory: [...month.byCategory],
    previousSpent,
    categories: categoryOrder(categories).map(spendingCategoryViewOf),
    days,
    cursor: rest.length > 0 ? (page.at(-1)?.key ?? null) : null,
    remaining: rest.length,
    remainingFrom: rest.at(-1)?.day.day ?? null,
    remainingTo: rest[0]?.day.day ?? null,
  }
}
