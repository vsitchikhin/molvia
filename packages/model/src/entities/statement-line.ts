import { z } from 'zod'
import { exchangeDaySchema } from '#model/entities/exchange'
import { positiveMoneySchema } from '#model/entities/spending'
import { nameUuid } from '#model/support/md5'
import type { Money } from '#model/values/money'

// A line of a bank's statement (MOL-429, epic MOL-427): the one shape every reader fills — a parser of
// a bank's file (MOL-430…432) or the model reading a screenshot (MOL-437) — and the duplicates rule
// (`statement-match.ts`) reads. The rule and its rounds are MOL-409's bench, `research/MOL-409/`.
// The day and the amount are a spending's own (`spentOn`, `amount`): a line becomes one.

/** A bank's text beside a line — a payee, a category; long enough for any bank's line of a payee. */
export const STATEMENT_TEXT_MAX = 200

/** A time as printed, «14:35», «2:35 PM», with room for a format's seconds and zone. */
export const STATEMENT_TIME_MAX = 32

const timeSchema = z.string().max(STATEMENT_TIME_MAX)

/**
 * Where the lines came from (Р-8): a closed list, each parser adding its own format. The domain knows
 * three things of a form: whether it is a bank's file (`isBankFile`), whether its key repeats
 * (`formKeyIsStable`) and whether its day may move from the phone's (`SHIFTED_FORMS`).
 */
export const statementFormSchema = z.enum(['screenshot', 'tbank-csv', 'ardshin-xlsx', 'ameria-csv'])
export type StatementForm = z.infer<typeof statementFormSchema>

/**
 * A bank's file: every line of the account in its period, each dated by its operation (Д2) and posted
 * as its own day beside it where the format prints one. A screenshot is what the person chose to show,
 * dated by the day the screen shows — the posting's (MOL-428).
 */
export function isBankFile(form: StatementForm): boolean {
  return form !== 'screenshot'
}

/**
 * A file parsed by code gives the same line byte for byte, and so the same key. A screenshot does not:
 * the model rewrites the payee, and the same line on a second screenshot is another key (Е1).
 */
export function formKeyIsStable(form: StatementForm): boolean {
  return form !== 'screenshot'
}

/**
 * What the line is, by the reader (Р-5): the parser by its format's columns and words, the model by the
 * screen. `own_transfer`, `cash` and `exchange` are not spendings by themselves; `transfer` is money to
 * somebody, which may be one (В-2); `fee` is the bank's, a spending of «Прочее».
 */
export const statementLineKindSchema = z.enum([
  'purchase',
  'transfer',
  'own_transfer',
  'cash',
  'exchange',
  'fee',
  'unknown',
])
export type StatementLineKind = z.infer<typeof statementLineKindSchema>

export const statementLineSchema = z.object({
  /** The day of the operation for a file (Д2), the day the screen shows for a screenshot. */
  day: exchangeDaySchema,
  /** The day it was posted, where the format prints one beside the operation's. */
  postedOn: exchangeDaySchema.nullable(),
  /** The time as printed (a screenshot's), never brought to a clock here: `printedClock` does that. */
  time: timeSchema.nullable(),
  amount: positiveMoneySchema,
  /** What left the account in its own currency, where the operation's is another. */
  debited: positiveMoneySchema.nullable(),
  /** `-` out, `+` in, none where the reader could not tell (А9). */
  sign: z.enum(['-', '+']).nullable(),
  payee: z.string().max(STATEMENT_TEXT_MAX),
  mcc: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  bankCategory: z.string().max(STATEMENT_TEXT_MAX).nullable(),
  /** `pending` is a hold, a spending all the same; `declined` — refused or cancelled — is none (В1). */
  status: z.enum(['posted', 'pending', 'declined']),
  kind: statementLineKindSchema,
})
export type StatementLine = z.infer<typeof statementLineSchema>

/** An account's or a card's number as a bank's head prints it, masked or whole. */
export const STATEMENT_ACCOUNT_NUMBER_MAX = 64

/**
 * The lines of one upload at most (А13): the rule runs in the API's process. The owner's samples hold 30–50
 * lines a month an account, some 600 a year; five such years is the ceiling, and its time is held by a test.
 */
export const STATEMENT_LINES_MAX = 3000

/**
 * One upload: its form; the person's account in Molvia it is of (or none); the number of the account or
 * card the bank's head prints, as printed — `accountNumberKey` reads it — or none (a screenshot, a format
 * that prints none); the period its head prints (or none).
 */
export const statementSchema = z.object({
  form: statementFormSchema,
  accountId: z.uuid().nullable(),
  accountNumber: z.string().max(STATEMENT_ACCOUNT_NUMBER_MAX).nullable(),
  period: z.object({ from: exchangeDaySchema, to: exchangeDaySchema }).nullable(),
  lines: z.array(statementLineSchema).max(STATEMENT_LINES_MAX),
})
export type Statement = z.infer<typeof statementSchema>

/** The digits of a printed account's or card's number a key reads: never fewer. */
const ACCOUNT_NUMBER_DIGITS = 4

/**
 * What a key reads of the number the bank's head prints (review №22): its last four digits. One card's
 * number comes whole, masked or cut by the format and by the format's next version — «8888 8888 8888
 * 8888», «888888******8888», «*8888» — and is one number to the key, as the same line in a bank's CSV and
 * its PDF is one line. A number with fewer digits is none. **The price, named:** two cards or accounts
 * of one person in one bank that end in the same four digits are one number.
 */
export function accountNumberKey(printed: string | null): string | null {
  const digits = (printed ?? '').replace(/\D/g, '')
  return digits.length < ACCOUNT_NUMBER_DIGITS ? null : digits.slice(-ACCOUNT_NUMBER_DIGITS)
}

/**
 * What a spending, a trip or a transfer keeps of the line it was made from or matched (stored by
 * MOL-433): the key, and the account in Molvia and the bank's number of the upload it was keyed under —
 * its own line is known again under another account's statement of the same account in Molvia, its
 * card's or its account's, a card reissued (adversarial А4, А18); the day and the posting day, so the
 * same operation in another form is told (Г2, Д2: a file's day is the operation's, a screenshot's the
 * posting's — adversarial А1); `pending`, so its posting is let in (Г2б); the form, so another form is
 * the same operation and the same file is not (Е1, Е2); and the amount, payee and time, so a relinked
 * record writes that line as a spending of its own (Д1) and two screenshots compare times (Ж2).
 */
export const statementLinkSchema = z.object({
  key: z.uuid(),
  accountId: z.uuid().nullable(),
  accountNumber: z.string().max(STATEMENT_ACCOUNT_NUMBER_MAX).nullable(),
  day: exchangeDaySchema,
  postedOn: exchangeDaySchema.nullable(),
  pending: z.boolean(),
  form: statementFormSchema,
  amount: positiveMoneySchema,
  payee: z.string().max(STATEMENT_TEXT_MAX),
  time: timeSchema.nullable(),
})
export type StatementLink = z.infer<typeof statementLinkSchema>

export function statementLinkOf(
  line: StatementLine,
  key: string,
  { form, accountId, accountNumber }: Pick<Statement, 'form' | 'accountId' | 'accountNumber'>,
): StatementLink {
  return {
    key,
    accountId,
    accountNumber,
    day: line.day,
    postedOn: line.postedOn,
    pending: line.status === 'pending',
    form,
    amount: line.amount,
    payee: line.payee,
    time: line.time,
  }
}

/** The namespace of a line's key: ours, so no other name-based id of the product can meet it. */
const STATEMENT_LINE_NAMESPACE = '4f2c8e1a-7b3d-4a69-9e05-c1d8b2f6a374'

const keyMoney = ({ minor, currency }: Money) => `${minor.toString()} ${currency}`

/** What a line's key reads of its statement. */
type KeyedStatement = Pick<Statement, 'accountId' | 'accountNumber' | 'lines'>

/**
 * Each line with its key, a spending's id when one is written from it (Р-2): the same line uploaded
 * again is the same id, so it is not written twice. The person is in it — two people's like lines of
 * statements with no account would be one id, and ids are one primary key for everyone; so are the
 * account — the bank's number where its head prints one (`accountNumberKey`), else the person's account
 * in Molvia: two cards of one bank uploaded «без счёта» are two keys, and a file uploaded again with an
 * account chosen since is the same (adversarial А4, А8, А14) — the day, the sign, the amount, the payee
 * as printed with its spaces squeezed, and the turn among equal lines: two rides of one price on one day
 * are two. The form is not: the same text in a bank's CSV and its PDF is the same line. A line is keyed
 * and turned among the lines of its status: a later export may leave out a refusal or a hold the bank
 * dropped, and a payment made again beside either keeps its key (adversarial А5, А9). So a hold's
 * posting is another key — the link lets it in.
 */
export function statementKeyedLines(
  actorId: string,
  statement: KeyedStatement,
): { readonly line: StatementLine; readonly key: string }[] {
  const seen = new Map<string, number>()
  const number = accountNumberKey(statement.accountNumber)
  const account = number === null ? (statement.accountId ?? '') : `#${number}`
  return statement.lines.map((line) => {
    const parts = JSON.stringify([
      actorId,
      account,
      line.day,
      line.sign ?? '',
      keyMoney(line.amount),
      line.payee.replace(/\s+/g, ' ').trim(),
    ])
    const name = line.status === 'posted' ? parts : `${parts}#${line.status}`
    const turn = seen.get(name) ?? 0
    seen.set(name, turn + 1)
    return { line, key: nameUuid(STATEMENT_LINE_NAMESPACE, `${name}#${String(turn)}`) }
  })
}

export function statementLineKeys(actorId: string, statement: KeyedStatement): string[] {
  return statementKeyedLines(actorId, statement).map(({ key }) => key)
}
