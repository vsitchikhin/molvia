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

/**
 * «Зарплата с … числа — в следующий месяц» (MOL-134, В-3): from which day of its month a salary
 * counts in «Пришло» of the next one; null — off, as every account starts. The person's own number,
 * 1–31: in a month without that day nothing moves (Н-7). The body and the answer of
 * `/actors/me/salary-shift`, saved on the tap (В-5).
 */
export const SALARY_SHIFT_DAY_MAX = 31
export const salaryShiftSchema = z.strictObject({
  day: z.int().min(1).max(SALARY_SHIFT_DAY_MAX).nullable(),
})
export type SalaryShift = z.infer<typeof salaryShiftSchema>

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
  /** Salaries of the month before counted in this one, and this month's counted in the next (MOL-134). */
  shiftedIn: z.array(exchangeDaySchema),
  shiftedOut: z.array(exchangeDaySchema),
  /**
   * «Остаток» (MOL-134): the accounts at the end of the month in the income currency, everything and
   * without the savings, and what nothing converts — by account, in its own currency — and how many
   * operations no rate counted, for each figure; null before any account had started.
   * `accountsFrom` — the earliest start of a live account, null when there is none.
   *
   * **The first page only.** A page after `cursor` carries no rest: `rest` and `accountsFrom` are
   * null and `accountsRemoved` false there whatever the accounts are — the figures of the month are
   * the first page's, never «no accounts» (adversarial Ж, self-review 10).
   */
  rest: z
    .strictObject({
      total: signedMoneyCodec,
      spendable: signedMoneyCodec,
      uncounted: z.strictObject({
        total: z.array(z.strictObject({ name: z.string(), balance: signedMoneyCodec })),
        spendable: z.array(z.strictObject({ name: z.string(), balance: signedMoneyCodec })),
      }),
      operationsUncounted: z.strictObject({
        total: z.int().min(0),
        spendable: z.int().min(0),
      }),
    })
    .nullable(),
  accountsFrom: exchangeDaySchema.nullable(),
  /** Every account there is was removed: the way to one is «Вернуть», not «Завести счёт». */
  accountsRemoved: z.boolean(),
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
    accountId: spending.accountId,
    debited: spending.debited,
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
    rest: month.rest && {
      ...month.rest,
      uncounted: {
        total: [...month.rest.uncounted.total],
        spendable: [...month.rest.uncounted.spendable],
      },
      operationsUncounted: { ...month.rest.operationsUncounted },
    },
    accountsFrom: month.accountsFrom,
    accountsRemoved: month.accountsRemoved,
    rate: month.rate,
    rateKind: month.rateKind,
    uncounted: [...month.uncounted],
    foreign: [...month.foreign],
    incomeUncounted: [...month.incomeUncounted],
    shiftedIn: [...month.shiftedIn],
    shiftedOut: [...month.shiftedOut],
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
