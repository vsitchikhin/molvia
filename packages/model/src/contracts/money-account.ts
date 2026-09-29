import { z } from 'zod'
import { positiveMoneyCodec } from './exchange'
import { journalCursorCodec } from './money'
import { deviceIdSchema, isoDate } from './trip'
import { exchangeDaySchema } from '#model/entities/exchange'
import { incomeSourceSchema } from '#model/entities/income'
import {
  ACCOUNT_OPERATION_KINDS,
  CHECK_REASONS,
  moneyAccountNameSchema,
} from '#model/entities/money-account'
import type { AccountOperation, Movement } from '#model/entities/money-account'
import { ISSUE } from '#model/support/errors'
import { currencySchema, moneyCodec, signedMoneyCodec } from '#model/values/money'
import type { Currency, Money } from '#model/values/money'
import { rateCodec } from '#model/values/rates'

/** What an account says, as the screen sends it — the same whether it is added or amended. */
const moneyAccountFields = {
  name: moneyAccountNameSchema,
  currency: currencySchema,
  savings: z.boolean(),
  // What it held at the end of `startOn` — below zero for a card in debt.
  start: signedMoneyCodec,
  startOn: exchangeDaySchema,
}

function withStartInCurrency<Schema extends z.ZodType<{ currency: Currency; start: Money }>>(
  schema: Schema,
) {
  return schema.refine(({ currency, start }) => start.currency === currency, {
    error: ISSUE.ACCOUNT_START_NOT_OF_CURRENCY,
    path: ['start'],
  })
}

/**
 * «Добавить счёт» (MOL-115). Named by the device, as every write of one's money is: the same one
 * again is a repeat, anything else under that name a conflict. «Not after today» is the use case's.
 */
export const moneyAccountBodySchema = withStartInCurrency(
  z.strictObject({ id: deviceIdSchema, ...moneyAccountFields }),
)
export type MoneyAccountBody = z.infer<typeof moneyAccountBodySchema>

/**
 * «Сохранить» an amended account: whole, over the version it was amended from — one amended on
 * another phone meanwhile is a conflict rather than lost. The currency moves only while nothing was
 * counted in it.
 */
export const moneyAccountAmendBodySchema = withStartInCurrency(
  z.strictObject({ revision: z.int().min(1), ...moneyAccountFields }),
)
export type MoneyAccountAmendBody = z.infer<typeof moneyAccountAmendBodySchema>

/**
 * One account as the card, the page and the picker show it. The balance and everything about it is
 * the server's: the phone adds nothing up (CLAUDE.md, «No business logic on the frontend»).
 */
export const moneyAccountViewCodec = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  currency: currencySchema,
  savings: z.boolean(),
  start: signedMoneyCodec,
  startOn: exchangeDaySchema,
  balance: signedMoneyCodec,
  /** Something in the balance was counted by a rate of its day, or could not be counted at all. */
  approximate: z.boolean(),
  /** Operations on it no rate could count — in no balance, named by every check. */
  uncounted: z.int().min(0),
  /**
   * The balance in the spending currency today, by the rule of «Деньги» — the person's own rate,
   * else a fresh official one — and that rate. Null for an account in the spending currency, and
   * when nothing converts it today.
   */
  inSpend: signedMoneyCodec.nullable(),
  rate: rateCodec.nullable(),
  lastCheckedOn: exchangeDaySchema.nullable(),
  /** Decided by the server: «Удалить» erases an account without them, «Убрать» keeps one with them. */
  hasOperations: z.boolean(),
  archivedAt: isoDate.nullable(),
  revision: z.int().min(1),
})
export type MoneyAccountView = z.output<typeof moneyAccountViewCodec>

/**
 * «Счета» whole (handoff 01, 02): the live accounts and the removed ones, in the order they were
 * added; the totals of the live ones in the spending currency — always «≈», since the sum is the
 * server's and not what is in hand — and how many operations with no account could still explain a
 * difference. `countedAt` is when this was counted: offline, the card says «на 14:05».
 */
export const moneyAccountsCodec = z.strictObject({
  spendCurrency: currencySchema,
  accounts: z.array(moneyAccountViewCodec),
  totals: z.strictObject({
    total: signedMoneyCodec,
    spendable: signedMoneyCodec,
    savings: signedMoneyCodec,
    /** Live accounts nothing converted today: left out of the totals rather than counted as zero. */
    uncounted: z.int().min(0),
  }),
  unassigned: z.int().min(0),
  countedAt: isoDate,
})
export type MoneyAccountsResponse = z.output<typeof moneyAccountsCodec>

/**
 * One operation as an account's journal, «не попали» and a check list it (MOL-115, Р-23). The words
 * are the operation's own kind's: a spending's category and lines, an income's source, the other
 * half of an exchange, a trip's shop and purchases.
 */
export const accountOperationViewCodec = z.strictObject({
  kind: z.enum(ACCOUNT_OPERATION_KINDS),
  id: z.uuid(),
  side: z.enum(['given', 'received']).nullable(),
  day: exchangeDaySchema,
  at: isoDate,
  accountId: z.uuid().nullable(),
  /** In the operation's own currencies, signed: out is below zero. */
  amounts: z.array(signedMoneyCodec),
  /**
   * What it did to the account this list is about, in the account's currency — null where there is
   * no such account («не попали»), and when no rate counts it.
   */
  moved: signedMoneyCodec.nullable(),
  approximate: z.boolean(),
  debited: moneyCodec.nullable(),
  /** Dated after the account's start: an earlier one is history, and in the balance it is not. */
  inBalance: z.boolean(),
  unpriced: z.int().min(0),
  /** What «Сохранить» in the operation's own sheet amends over; null for a trip. */
  revision: z.int().min(1).nullable(),
  items: z.int().min(0).nullable(),
  categoryId: z.uuid().nullable(),
  note: z.string().nullable(),
  place: z.string().nullable(),
  source: incomeSourceSchema.nullable(),
  counterpart: z
    .strictObject({ accountId: z.uuid().nullable(), amount: signedMoneyCodec })
    .nullable(),
})
export type AccountOperationView = z.output<typeof accountOperationViewCodec>

export function accountOperationViewOf(
  operation: AccountOperation,
  movement: Movement | null,
  inBalance: boolean,
): AccountOperationView {
  return {
    kind: operation.kind,
    id: operation.id,
    side: operation.side,
    day: operation.day,
    at: operation.at,
    accountId: operation.accountId,
    amounts: [...operation.amounts],
    moved: movement?.amount ?? null,
    approximate: movement?.approximate ?? false,
    debited: operation.debited,
    inBalance,
    unpriced: operation.unpriced,
    revision: operation.revision,
    items: operation.details.items,
    categoryId: operation.details.categoryId,
    note: operation.details.note,
    place: operation.details.place,
    source: operation.details.source,
    counterpart: operation.details.counterpart,
  }
}

/** How many rows of an account's journal one answer carries — the month's page (handoff 04). */
export const ACCOUNT_JOURNAL_PAGE = 40

export const accountJournalQuerySchema = z.strictObject({ cursor: journalCursorCodec.optional() })

/** The account and a page of its journal, newest first; the cursor of the next, or null at the end. */
export const accountJournalCodec = z.strictObject({
  account: moneyAccountViewCodec,
  rows: z.array(accountOperationViewCodec),
  cursor: journalCursorCodec.nullable(),
})
export type AccountJournalResponse = z.output<typeof accountJournalCodec>

/** «Не попали в остатки» (handoff 01): the rows whole — there are few, and each wants an account. */
export const unassignedOperationsCodec = z.strictObject({
  rows: z.array(accountOperationViewCodec),
})
export type UnassignedOperationsResponse = z.output<typeof unassignedOperationsCodec>

/**
 * «Сверить» (MOL-115, Р-19): the fact the person counted, under a name the device gives. The same
 * name and fact again count once more — after a reason was put right — and another fact is another
 * check, under another name.
 */
export const accountCheckBodySchema = z.strictObject({
  id: deviceIdSchema,
  fact: signedMoneyCodec,
})
export type AccountCheckBody = z.infer<typeof accountCheckBodySchema>

/**
 * What a check found (handoff 05): the balance as the server counted it, the difference — the fact
 * less that, neutral either way — and what could have made it since `since`. The sum «Прочее ·
 * сверка» writes is `difference`, never one the phone worked out.
 */
export const accountCheckCodec = z.strictObject({
  id: z.uuid(),
  checkedOn: exchangeDaySchema,
  fact: signedMoneyCodec,
  counted: signedMoneyCodec,
  difference: signedMoneyCodec,
  approximate: z.boolean(),
  since: exchangeDaySchema,
  reasons: z.array(
    z.strictObject({ kind: z.enum(CHECK_REASONS), operation: accountOperationViewCodec }),
  ),
})
export type AccountCheckResponse = z.output<typeof accountCheckCodec>

/**
 * The hint of «сколько было до обмена» from the accounts (MOL-115, Р-20): the currency and the day
 * the sheet has chosen, and the exchange or income being amended, left out of what it counts.
 */
export const accountsHeldQuerySchema = z.strictObject({
  currency: currencySchema,
  day: exchangeDaySchema,
  except: z
    .uuid()
    .overwrite((id) => id.toLowerCase())
    .optional(),
})
export type AccountsHeldQuery = z.infer<typeof accountsHeldQuerySchema>

/** Null when the accounts cannot say: none in the currency, or one started on that day or after. */
export const accountsHeldCodec = z.strictObject({
  held: signedMoneyCodec.nullable(),
  approximate: z.boolean(),
})
export type AccountsHeldResponse = z.output<typeof accountsHeldCodec>

/**
 * The account of a trip and what left it (MOL-115, п. 6, Р-18): written from the summary at once,
 * through the queue, so a repeat is the same answer. `accountId: null` takes the trip off accounts.
 */
export const tripPaymentBodySchema = z
  .strictObject({
    accountId: z
      .uuid()
      .overwrite((id) => id.toLowerCase())
      .nullable(),
    debited: positiveMoneyCodec.nullable().optional(),
  })
  .refine(({ accountId, debited }) => debited == null || accountId !== null, {
    error: ISSUE.DEBITED_WITHOUT_ACCOUNT,
    path: ['debited'],
  })
export type TripPaymentBody = z.infer<typeof tripPaymentBodySchema>
