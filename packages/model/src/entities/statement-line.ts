import { z } from 'zod'
import { ERROR } from '#model/support/errors'
import { nameUuid } from '#model/support/md5'
import { priceSchema } from '#model/values/money'
import type { Money } from '#model/values/money'
import { isCalendarDay } from '#model/values/rates'

// A line of a bank's statement (MOL-429, epic MOL-427): the one shape every reader fills — a parser of
// a bank's file (MOL-430…432) or the model reading a screenshot (MOL-437) — and the duplicates rule
// (`statement-match.ts`) reads. The rule and its rounds are MOL-409's bench, `research/MOL-409/`.

const daySchema = z.string().refine(isCalendarDay)
const amountSchema = priceSchema.refine((value) => value.minor > 0n, {
  error: ERROR.INVALID_AMOUNT,
})

/** A bank's text beside a line — a payee, a category; long enough for any bank's line of a payee. */
export const STATEMENT_TEXT_MAX = 200

/**
 * Where the lines came from (Р-8): a closed list, each parser adding its own format. The domain knows
 * two things of a form: whether its key repeats (`formKeyIsStable`) and whether its day may move from
 * the phone's (`SHIFTED_FORMS`).
 */
export const statementFormSchema = z.enum(['screenshot', 'tbank-csv', 'ardshin-xlsx', 'ameria-csv'])
export type StatementForm = z.infer<typeof statementFormSchema>

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
  day: daySchema,
  /** The day it was posted, where the format prints one beside the operation's. */
  postedOn: daySchema.nullable(),
  /** The time as printed (a screenshot's), never brought to a clock here: `printedClock` does that. */
  time: z.string().max(32).nullable(),
  amount: amountSchema,
  /** What left the account in its own currency, where the operation's is another. */
  debited: amountSchema.nullable(),
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

/** One upload: its form, the person's account it is of (or none), the period its head prints (or none). */
export const statementSchema = z.object({
  form: statementFormSchema,
  accountId: z.uuid().nullable(),
  period: z.object({ from: daySchema, to: daySchema }).nullable(),
  lines: z.array(statementLineSchema),
})
export type Statement = z.infer<typeof statementSchema>

/**
 * What a spending, a trip or a transfer keeps of the line it was made from or matched (stored by
 * MOL-433): the key and day, so another line is told from it (Г2, Д2); `pending`, so its posting is let
 * in (Г2б); the form, so another form is the same operation and the same file is not (Е1, Е2); and the
 * amount, payee and time, so a relinked record writes that line as a spending of its own (Д1) and two
 * screenshots compare times (Ж2).
 */
export const statementLinkSchema = z.object({
  key: z.uuid(),
  day: daySchema,
  pending: z.boolean(),
  form: statementFormSchema,
  amount: amountSchema,
  payee: z.string().max(STATEMENT_TEXT_MAX),
  time: z.string().max(32).nullable(),
})
export type StatementLink = z.infer<typeof statementLinkSchema>

export function statementLinkOf(
  line: StatementLine,
  key: string,
  form: StatementForm,
): StatementLink {
  return {
    key,
    day: line.day,
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

/**
 * The key of each line, a spending's id when one is written from it (Р-2): the same line uploaded again
 * is the same id, so it is not written twice. The person is in it — two people's like lines of statements
 * with no account would be one id, and ids are one primary key for everyone; so are the account, the day,
 * the sign, the amount, the payee as printed with its spaces squeezed, and the turn among equal lines —
 * two rides of one price on one day are two. The form is not: the same text in a bank's CSV and its PDF
 * is the same line.
 */
export function statementLineKeys(
  actorId: string,
  statement: Pick<Statement, 'accountId' | 'lines'>,
): string[] {
  const seen = new Map<string, number>()
  return statement.lines.map((line) => {
    const parts = JSON.stringify([
      actorId,
      statement.accountId ?? '',
      line.day,
      line.sign ?? '',
      keyMoney(line.amount),
      line.payee.replace(/\s+/g, ' ').trim(),
    ])
    const turn = seen.get(parts) ?? 0
    seen.set(parts, turn + 1)
    return nameUuid(STATEMENT_LINE_NAMESPACE, `${parts}#${String(turn)}`)
  })
}
