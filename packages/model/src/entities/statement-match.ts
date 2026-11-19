import type { Exchange } from '#model/entities/exchange'
import type { Expense } from '#model/entities/expense'
import type { Spending } from '#model/entities/spending'
import type { SpendingPreset } from '#model/entities/spending-category'
import {
  formKeyIsStable,
  isBankFile,
  statementKeyedLines,
  statementLineKeys,
} from '#model/entities/statement-line'
import type {
  Statement,
  StatementForm,
  StatementLine,
  StatementLink,
} from '#model/entities/statement-line'
import type { Transfer } from '#model/entities/transfer'
import { tripMoney } from '#model/entities/trip'
import { payeeWords, sameSeller, sellerWords, wordsShare } from '#model/support/payee-name'
import { printedTimesSay } from '#model/support/printed-time'
import type { Money } from '#model/values/money'
import { yerevanDate } from '#model/values/rates'

// The duplicates rule (MOL-429): which lines of a statement are already in Molvia — a spending, a trip,
// a transfer, an exchange — which are new spendings, and which are no spendings at all. The rule is the
// bench's of MOL-409 (`research/MOL-409/bench/match.mjs`, rounds А…Н, each named where it acts), with
// the two findings of MOL-428's measurement: an exchange is a candidate, and a record on another account
// is a doubt (owner's В-1 «а»). The windows and the exact sum are measured there; the tip's fifth, the
// hold's half and the days of a hold, a late posting and a refund are not — named prices.

/** A file's line meets a record within two days of it (MOL-428). */
export const STATEMENT_FILE_WINDOW_DAYS = 2

/** A screenshot shows the posting day: from two days before the record to four after (MOL-428). */
export const STATEMENT_SCREENSHOT_DAYS_BEFORE = 2
export const STATEMENT_SCREENSHOT_DAYS_AFTER = 4

/**
 * A line up to a fifth over the record — a tip, a service — is a doubt, never a match (А2). Not
 * measured — MOL-409 had one tip, +5 %: a named price.
 */
const TIP_PERMILLE = 200n

/** A posting under its hold, down to half of it, with the same name, is a doubt (В4). Not measured. */
const HOLD_FLOOR_PERMILLE = 500n

/** A hold's posting comes within these days (Г2б). Not measured — a named price. */
export const STATEMENT_HOLD_POST_DAYS = 7

/** A hold's posting later than `STATEMENT_HOLD_POST_DAYS`, within these, by the same name, is a doubt (Е3). Not measured. */
export const STATEMENT_LATE_POST_DAYS = 30

/** A refund looks for its recorded spending within these days after it (Г4). Not measured. */
export const STATEMENT_REFUND_DAYS = 60

/** Forms whose day may move from the phone's (Д2): T-Bank's CSV prints Moscow's time. Not measured. */
const SHIFTED_FORMS: ReadonlySet<StatementForm> = new Set(['tbank-csv'])

/** The cash withdrawal's MCCs, read where the reader set no kind (Р-5). */
const CASH_MCC: ReadonlySet<string> = new Set(['6010', '6011'])

/** A transfer between one's own accounts settles only a line that calls itself one (В2б). */
const TRANSFER_WORDS = /transfer|перевод|փոխանց|card to card|c2c/i

/** An exchange settles only a line that calls itself a transfer or an exchange (Р-6, MOL-428). */
const EXCHANGE_WORDS = /обмен|конверс|купля|продажа валют|exchange|conversion|փոխարկ/i

export type StatementCandidateKind = 'spending' | 'trip' | 'transfer' | 'exchange'

/**
 * What the rule reads of a record: `days` — a trip's start and finish; `account` — the one its money
 * left, a transfer's source and an exchange's given side too, or none (Б1а).
 */
export interface StatementCandidate {
  readonly id: string
  readonly what: StatementCandidateKind
  readonly days: readonly string[]
  readonly money: readonly Money[]
  readonly debited: Money | null
  readonly account: string | null
  readonly name: string
  readonly removed: boolean
  readonly link: StatementLink | null
}

interface RecordState {
  /** Removed and still within «Вернуть»: a match with it is a doubt (А5). */
  readonly removed: boolean
  readonly link: StatementLink | null
}

export function spendingCandidate(
  spending: Pick<
    Spending,
    'id' | 'spentOn' | 'amount' | 'debited' | 'accountId' | 'place' | 'note'
  >,
  { removed, link }: RecordState,
): StatementCandidate {
  return {
    id: spending.id,
    what: 'spending',
    days: [spending.spentOn],
    money: [spending.amount],
    debited: spending.debited,
    account: spending.accountId,
    name: spending.place ?? spending.note ?? '',
    removed,
    link,
  }
}

/** What the rule reads of a trip: its money by `tripMoney`, its days — the phone's, else Yerevan's (А7). */
export interface StatementTrip {
  readonly id: string
  readonly startedAt: Date
  readonly startedOn: string | null
  readonly finishedAt: Date | null
  readonly finishedOn: string | null
  readonly accountId: string | null
  readonly debited: Money | null
  readonly receipt: Money | null
  readonly expenses: readonly Pick<Expense, 'amount'>[]
  readonly placeName: string
}

/** A trip, once finished and with money; null otherwise — an open trip is no candidate. */
export function tripCandidate(
  trip: StatementTrip,
  { removed, link }: RecordState,
): StatementCandidate | null {
  if (trip.finishedAt === null) return null
  const money = tripMoney(trip.receipt, trip.expenses)
  if (money.length === 0) return null
  const started = trip.startedOn ?? yerevanDate(trip.startedAt)
  const finished = trip.finishedOn ?? yerevanDate(trip.finishedAt)
  return {
    id: trip.id,
    what: 'trip',
    days: started === finished ? [started] : [started, finished],
    money,
    debited: trip.debited,
    account: trip.accountId,
    name: trip.placeName,
    removed,
    link,
  }
}

export function transferCandidate(
  transfer: Pick<Transfer, 'id' | 'fromAccountId' | 'amount' | 'transferredOn' | 'note'>,
  { removed, link }: RecordState,
): StatementCandidate {
  return {
    id: transfer.id,
    what: 'transfer',
    days: [transfer.transferredOn],
    money: [transfer.amount],
    debited: null,
    account: transfer.fromAccountId,
    name: transfer.note ?? '',
    removed,
    link,
  }
}

/** An exchange is the given side's line: the money that left the account given from (Р-6). */
export function exchangeCandidate(
  exchange: Pick<Exchange, 'id' | 'given' | 'exchangedOn' | 'givenAccountId' | 'note'>,
  { removed, link }: RecordState,
): StatementCandidate {
  return {
    id: exchange.id,
    what: 'exchange',
    days: [exchange.exchangedOn],
    money: [exchange.given],
    debited: null,
    account: exchange.givenAccountId,
    name: exchange.note ?? '',
    removed,
    link,
  }
}

export interface StatementRecordRef {
  readonly id: string
  readonly what: StatementCandidateKind
}

/**
 * Why a line that looks recorded is not taken for it without the person: `tip` (А2), `hold` (В4),
 * `late_post` (Е3), `relink` (Д1), `same_screenshot` (Е1, З1), `removed` (А5), `other_name` (Б4),
 * `other_account` (В-1 «а»), `transfer` and `exchange` — another day, no account, a line that does
 * not call itself so (Б1б, Г1, Р-6).
 */
export type StatementDoubt =
  | 'tip'
  | 'hold'
  | 'late_post'
  | 'relink'
  | 'same_screenshot'
  | 'removed'
  | 'other_name'
  | 'other_account'
  | 'transfer'
  | 'exchange'

/**
 * Why a line is no spending: `income` — money in; `refund` — a refund, of a record when there is one
 * (Г4) or of a purchase in the same file (В3); `own_transfer`, `cash`, `exchange` — by the reader's kind
 * or a record that settles it; `declined` (В1); `unsigned` (А9).
 */
export type StatementNotSpending =
  'income' | 'refund' | 'own_transfer' | 'cash' | 'exchange' | 'declined' | 'unsigned'

/**
 * The answer for one line (Р-9). `new` is ticked unless it is a transfer to somebody (В-2 «б») or a
 * purchase refunded in the same file (В3); a bank's fee comes with the hint «Прочее». `recorded` with
 * no doubt is ticked off silently; with one, it is shown and not ticked.
 */
export type StatementLineDecision =
  | {
      readonly group: 'new'
      readonly ticked: boolean
      readonly note: 'transfer' | 'refunded' | null
      readonly categoryHint: Extract<SpendingPreset, 'other'> | null
    }
  | {
      readonly group: 'recorded'
      readonly record: StatementRecordRef
      readonly doubt: StatementDoubt | null
    }
  | {
      readonly group: 'not_spending'
      readonly reason: StatementNotSpending
      readonly record: StatementRecordRef | null
    }

/**
 * A record made from a hold the statement shows no posting of (Д3, Е4): `settled` — the statement runs
 * `STATEMENT_HOLD_POST_DAYS` past it, so «убрать трату?»; else «проводки пока нет». Ticked only for a bank's file
 * with a period in its head — complete by construction; a screenshot is what the person chose to show (Ж1).
 */
export interface StatementUnposted {
  readonly record: StatementRecordRef
  readonly settled: boolean
  readonly ticked: boolean
}

export interface StatementMatch {
  readonly lines: readonly { readonly key: string; readonly decision: StatementLineDecision }[]
  readonly unposted: readonly StatementUnposted[]
}

type Fit = 'exact' | 'unsure' | 'elsewhere' | 'tip' | 'hold' | 'late' | 'relink'

/** The fits in the order the matching takes them: what met first, the doubts only for what is left. */
const FIT_ORDER: readonly Fit[] = ['exact', 'unsure', 'elsewhere', 'tip', 'hold', 'late', 'relink']

/** A line as the rule reads it, each once: its key, its day as a number, its amounts, its payee folded. */
interface Row {
  readonly index: number
  readonly line: StatementLine
  readonly key: string
  readonly day: number
  readonly amounts: readonly Money[]
  readonly words: readonly string[]
}

/** A record as the rule reads it, each once: its days as numbers, its amounts, its seller's words. */
interface Known {
  readonly c: StatementCandidate
  readonly days: readonly number[]
  readonly amounts: readonly Money[]
  readonly seller: readonly string[]
}

interface Pair {
  readonly row: number
  readonly c: StatementCandidate
  readonly fit: Fit
  /** The record's link names this very line by its key: the line it was made from goes first. */
  readonly own: boolean
  readonly named: number
  readonly nameless: boolean
  readonly distance: number
}

const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00.000Z`) / 86_400_000)

const amountsOfLine = (line: StatementLine): Money[] =>
  line.debited ? [line.amount, line.debited] : [line.amount]
const amountsOfRecord = (c: StatementCandidate): Money[] =>
  c.debited ? [...c.money, c.debited] : [...c.money]

/**
 * Each amount the line shows against each the record has — its money and its «списано» (А1): `exact`
 * when one meets, `tip` a line up to a fifth over, `hold` a line under, down to half; else null.
 */
function amountFit(
  ofLine: readonly Money[],
  ofRecord: readonly Money[],
): 'exact' | 'tip' | 'hold' | null {
  let near: 'tip' | 'hold' | null = null
  for (const a of ofLine)
    for (const r of ofRecord) {
      if (a.currency !== r.currency) continue
      if (a.minor === r.minor) return 'exact'
      if (a.minor > r.minor && (a.minor - r.minor) * 1000n <= r.minor * TIP_PERMILLE) near = 'tip'
      else if (a.minor < r.minor && a.minor * 1000n >= r.minor * HOLD_FLOOR_PERMILLE)
        near ??= 'hold'
    }
  return near
}

const sameAmount = (ofLine: readonly Money[], ofRecord: readonly Money[]) =>
  ofLine.some((a) => ofRecord.some((r) => r.currency === a.currency && r.minor === a.minor))

function inWindow(form: StatementForm, lineDay: number, recordDay: number): boolean {
  const after = lineDay - recordDay
  return form === 'screenshot'
    ? after >= -STATEMENT_SCREENSHOT_DAYS_BEFORE && after <= STATEMENT_SCREENSHOT_DAYS_AFTER
    : Math.abs(after) <= STATEMENT_FILE_WINDOW_DAYS
}

const daySlack = (a: StatementForm, b: StatementForm) =>
  SHIFTED_FORMS.has(a) || SHIFTED_FORMS.has(b) ? 1 : 0

/**
 * Whether a line of another form is the link's operation by its days (Д2, Е2): one day, ± 1 for a form
 * whose day moves. A file dates a line by its operation and prints its posting day beside it where its
 * format has one; a screenshot shows the posting day (MOL-428). So a screenshot meets a file's line on
 * its posting day too (adversarial А1) — with none printed, on one day only; two files, by the
 * operation's alone.
 */
function sameOperationDay(link: StatementLink, line: StatementLine, form: StatementForm): boolean {
  const slack = daySlack(link.form, form)
  const meet = (a: string, b: string) => Math.abs(dayNumber(a) - dayNumber(b)) <= slack
  if (meet(link.day, line.day)) return true
  if (link.form === 'screenshot' && isBankFile(form))
    return line.postedOn !== null && meet(link.day, line.postedOn)
  if (form === 'screenshot' && isBankFile(link.form))
    return link.postedOn !== null && meet(link.postedOn, line.day)
  return false
}

/**
 * The posting of a hold the record was made from (Г2б). A file dates it by its operation — the hold's
 * own day (Д2), so on that day only: a line of a file days after it is another operation (adversarial
 * А2, А3). A screenshot shows the posting day: within `STATEMENT_HOLD_POST_DAYS` after the hold, past the
 * window too, which is the measure of a record typed by hand, not of a bank's posting.
 */
function holdPosting(link: StatementLink, line: StatementLine, form: StatementForm): boolean {
  if (!link.pending || line.status === 'pending') return false
  const after = dayNumber(line.day) - dayNumber(link.day)
  return isBankFile(form)
    ? Math.abs(after) <= daySlack(link.form, form)
    : after >= 0 && after <= STATEMENT_HOLD_POST_DAYS
}

/**
 * Whether a record's link lets this line in (Г2, Д2, Е1, Е2): its own line — by its key, or by the key
 * it had under the account the link was keyed under, the same file uploaded again with an account chosen
 * since (adversarial А4); a line of another form — or a screenshot against a screenshot — of the link's
 * operation by its days; never another key of the same file, which would have given the same key; a
 * hold's posting. A screenshot against a screenshot on one day is told by the time, else is a doubt (Ж2,
 * З1, И1, И2).
 */
function linkLets(
  link: StatementLink,
  row: Row,
  form: StatementForm,
  keyUnder: (account: string | null, index: number) => string | undefined,
): boolean | 'unsure' {
  if (link.key === row.key || link.key === keyUnder(link.accountId, row.index)) return true
  const { line } = row
  if (link.form === 'screenshot' && form === 'screenshot' && link.day === line.day) {
    const said = printedTimesSay(link.time, line.time)
    return said === 'same' ? true : said === 'apart' ? false : 'unsure'
  }
  const sameFile = formKeyIsStable(form) && link.form === form
  if (!sameFile && sameOperationDay(link, line, form)) return true
  return holdPosting(link, line, form)
}

/**
 * Relink (Д1): a line met exactly and nearer the record than the line of its link is a doubt. Kept as
 * recorded, it moves the link to itself and writes the link's line as a spending of its own. Neither a
 * hold nor a transfer or an exchange: they have paths of their own.
 */
function relinks(c: StatementCandidate, days: readonly number[], distance: number): boolean {
  const link = c.link
  if (link === null || link.pending || c.what === 'transfer' || c.what === 'exchange') return false
  const linkDay = dayNumber(link.day)
  return distance < Math.min(...days.map((d) => Math.abs(linkDay - d)))
}

/**
 * A hold's late posting (Е3): past `STATEMENT_HOLD_POST_DAYS`, within `STATEMENT_LATE_POST_DAYS` — on a
 * screenshot, which shows the posting day; a file's posting is on the hold's day (Д2). Its name is
 * asked by the caller.
 */
function lateFit(
  c: StatementCandidate,
  line: StatementLine,
  form: StatementForm,
  amount: 'exact' | 'tip' | 'hold',
): 'late' | null {
  const link = c.link
  if (link === null || !link.pending || line.status === 'pending' || isBankFile(form)) return null
  if (amount === 'tip') return null
  const after = dayNumber(line.day) - dayNumber(link.day)
  return after > STATEMENT_HOLD_POST_DAYS && after <= STATEMENT_LATE_POST_DAYS ? 'late' : null
}

/**
 * A record on the statement's account, or either of them with none. For a transfer or an exchange the
 * account is the one its money left (Б1а).
 */
const onAccount = (c: StatementCandidate, account: string | null) =>
  account === null || c.account === null || c.account === account

const saysTransfer = (line: StatementLine) =>
  line.kind === 'transfer' || TRANSFER_WORDS.test(line.payee)
const saysExchange = (line: StatementLine) => saysTransfer(line) || EXCHANGE_WORDS.test(line.payee)

/** The doubt of a pair, or null when it is the record silently. */
function doubtOf(
  p: Pair,
  line: StatementLine,
  account: string | null,
): StatementDoubt | 'settled' | null {
  if (p.c.removed) return 'removed'
  if (p.fit === 'elsewhere') return 'other_account'
  if (p.fit === 'relink') return 'relink'
  if (p.fit === 'unsure') return 'same_screenshot'
  if (p.fit === 'late') return 'late_post'
  if (p.fit === 'hold') return 'hold'
  if (p.fit === 'tip') return 'tip'
  if (p.c.what === 'transfer' || p.c.what === 'exchange') {
    const says = p.c.what === 'transfer' ? saysTransfer(line) : saysExchange(line)
    const sure = account !== null && p.c.account === account && says && p.distance === 0
    return sure ? 'settled' : p.c.what
  }
  return !p.nameless && p.named === 0 ? 'other_name' : null
}

/** What the reader's kind or the bank's sign says before any record is looked at (В1, А9, Р-5). */
function notSpendingByLine(line: StatementLine): StatementNotSpending | null {
  if (line.status === 'declined') return 'declined'
  if (line.sign === null) return 'unsigned'
  if (line.kind === 'own_transfer') return 'own_transfer'
  if (
    line.kind === 'cash' ||
    (line.kind === 'unknown' && line.mcc !== null && CASH_MCC.has(line.mcc))
  )
    return 'cash'
  if (line.kind === 'exchange') return 'exchange'
  return null
}

/**
 * One to one by the greatest matching (А3, Б2): lines in the order of their best pair, each with its
 * candidates by preference; a taken record is taken over only when its line finds another (Kuhn's path).
 * The fits go in `FIT_ORDER`: a doubt takes only a record left free.
 */
function matchPairs(pairs: readonly Pair[]): Map<number, Pair> {
  const owner = new Map<string, number>()
  const choice = new Map<number, Pair>()
  for (const fit of FIT_ORDER) {
    const options = new Map<number, Pair[]>()
    for (const p of pairs) {
      if (p.fit !== fit) continue
      const held = options.get(p.row)
      if (held) held.push(p)
      else options.set(p.row, [p])
    }
    const claim = (row: number, seen: Set<string>): boolean => {
      for (const p of options.get(row) ?? []) {
        if (seen.has(p.c.id)) continue
        seen.add(p.c.id)
        const holder = owner.get(p.c.id)
        if (holder === undefined || (choice.get(holder)?.fit === fit && claim(holder, seen))) {
          owner.set(p.c.id, row)
          choice.set(row, p)
          return true
        }
      }
      return false
    }
    for (const row of options.keys()) if (!choice.has(row)) claim(row, new Set())
  }
  return choice
}

/**
 * The rule over one statement: a decision for every line, with its key, and the holds it shows no
 * posting of. The candidates are the person's spendings (removed ones still within «Вернуть»), finished
 * trips, transfers and exchanges, built by the functions above. Every line is weighed against every
 * record, the sum first; a name is folded once a line and once a record — a month of 300 lines against
 * a year of 3 000 records is some 0.1 s (review №1), in the API's process.
 */
export function matchStatement(
  actorId: string,
  statement: Statement,
  candidates: readonly StatementCandidate[],
): StatementMatch {
  const { form, lines } = statement
  const account = statement.accountId
  const rows: Row[] = statementKeyedLines(actorId, statement).map(({ line, key }, index) => ({
    index,
    line,
    key,
    day: dayNumber(line.day),
    amounts: amountsOfLine(line),
    words: payeeWords(line.payee),
  }))
  const known: Known[] = candidates.map((c) => ({
    c,
    days: c.days.map(dayNumber),
    amounts: amountsOfRecord(c),
    seller: sellerWords(c.name),
  }))
  // The keys the lines had under another account, asked only by a link keyed under one (А4).
  const keysUnder = new Map<string | null, string[]>([[account, rows.map((r) => r.key)]])
  const keyUnder = (other: string | null, index: number) => {
    let keys = keysUnder.get(other)
    if (keys === undefined) {
      keys = statementLineKeys(actorId, { accountId: other, lines })
      keysUnder.set(other, keys)
    }
    return keys[index]
  }

  const decisions = new Map<number, StatementLineDecision>()
  const spend: Row[] = []
  for (const row of rows) {
    const reason = notSpendingByLine(row.line)
    if (reason !== null) decisions.set(row.index, { group: 'not_spending', reason, record: null })
    else if (row.line.sign === '-') spend.push(row)
  }

  // Every pair whose sum fits, then one to one: met before doubts, the line a record was made from
  // first, then by the share of the name (А4), the nearer day, the order of the lines.
  const pairs: Pair[] = []
  for (const row of spend) {
    const { line } = row
    for (const { c, days, amounts, seller } of known) {
      const own = c.what === 'transfer' || c.what === 'exchange'
      if (own && !onAccount(c, account)) continue
      const inside = days.some((d) => inWindow(form, row.day, d))
      if (!inside && c.link === null) continue // only a link reaches past the window
      const amount = amountFit(row.amounts, amounts)
      if (amount === null) continue
      const distance = Math.min(...days.map((d) => Math.abs(row.day - d)))
      const lets = c.link === null ? true : linkLets(c.link, row, form, keyUnder)
      // A link that names the line lets it in past the window: its key, its operation, its hold's posting.
      const near = inside || (c.link !== null && lets === true)
      let fit: Fit | null
      if (!near)
        fit = lateFit(c, line, form, amount) // a hold's late posting, past the window too (Е3)
      else if (lets === 'unsure') fit = amount === 'exact' ? 'unsure' : null
      else if (!lets)
        fit =
          amount === 'exact' && relinks(c, days, distance)
            ? 'relink'
            : lateFit(c, line, form, amount)
      else fit = amount
      if (fit === null) continue
      const named = wordsShare(row.words, seller)
      // A late posting and a hold are known by the name; a hold only on the statement's account: a hold
      // is a card's, and a record with no account is cash or before the accounts — a purchase under it
      // in the same chain is new (Г3).
      if (fit === 'late' && named === 0) continue
      if (fit === 'hold' && (named === 0 || account === null || c.account !== account)) continue
      if (fit === 'exact' && !own && !onAccount(c, account)) fit = 'elsewhere' // В-1 «а»
      pairs.push({
        row: row.index,
        c,
        fit,
        own: c.link?.key === row.key,
        named,
        nameless: seller.length === 0,
        distance,
      })
    }
  }
  pairs.sort(
    (p, q) =>
      Number(q.own) - Number(p.own) ||
      q.named - p.named ||
      p.distance - q.distance ||
      p.row - q.row,
  )
  const choice = matchPairs(pairs)
  for (const [index, p] of choice) {
    const row = rows[index]
    if (row === undefined) continue
    const record = { id: p.c.id, what: p.c.what }
    const doubt = doubtOf(p, row.line, account)
    if (doubt === 'settled') {
      const reason = p.c.what === 'exchange' ? 'exchange' : 'own_transfer'
      decisions.set(index, { group: 'not_spending', reason, record })
    } else decisions.set(index, { group: 'recorded', record, doubt })
  }

  // A purchase and its refund in the same file (В3): the purchase new and not ticked; one refund a purchase.
  const refunds = rows.filter((row) => !decisions.has(row.index) && row.line.sign === '+')
  const refunded = new Set<number>()
  for (const { index, line } of spend) {
    if (decisions.has(index)) continue
    const back = refunds.find(
      ({ index: r, line: refund }) =>
        !refunded.has(r) &&
        refund.amount.currency === line.amount.currency &&
        refund.amount.minor === line.amount.minor &&
        refund.day >= line.day &&
        sameSeller(refund.payee, line.payee),
    )
    if (back === undefined) continue
    refunded.add(back.index)
    decisions.set(index, { group: 'new', ticked: false, note: 'refunded', categoryHint: null })
    decisions.set(back.index, { group: 'not_spending', reason: 'refund', record: null })
  }

  // A refund of a recorded spending or trip (Г4): the same sum from the same seller within
  // STATEMENT_REFUND_DAYS after it — no spending, said with the record; one refund a record, the nearest
  // before it, then by id — never the order the records came in (review №7).
  const hinted = new Set<string>()
  for (const row of refunds) {
    const { index, line, day } = row
    if (refunded.has(index)) continue
    let best: { readonly c: StatementCandidate; readonly after: number } | undefined
    for (const { c, days, amounts } of known) {
      if ((c.what !== 'spending' && c.what !== 'trip') || c.removed || hinted.has(c.id)) continue
      if (!onAccount(c, account) || !sameAmount(row.amounts, amounts)) continue
      const afters = days.map((d) => day - d).filter((a) => a >= 0 && a <= STATEMENT_REFUND_DAYS)
      if (afters.length === 0 || !sameSeller(line.payee, c.name)) continue
      const after = Math.min(...afters)
      if (best === undefined || after < best.after || (after === best.after && c.id < best.c.id))
        best = { c, after }
    }
    if (best === undefined) continue
    hinted.add(best.c.id)
    decisions.set(index, {
      group: 'not_spending',
      reason: 'refund',
      record: { id: best.c.id, what: best.c.what },
    })
  }

  return {
    lines: rows.map(({ index, line, key }) => ({
      key,
      decision: decisions.get(index) ?? newLine(line),
    })),
    unposted: unpostedHolds(
      statement,
      candidates,
      new Set([...choice.values()].map((p) => p.c.id)),
    ),
  }
}

/** A line nothing decided: money in is income; out — a new spending (В-2 «б»: a transfer, not ticked). */
function newLine(line: StatementLine): StatementLineDecision {
  if (line.sign === '+') return { group: 'not_spending', reason: 'income', record: null }
  const transfer = line.kind === 'transfer'
  return {
    group: 'new',
    ticked: !transfer,
    note: transfer ? 'transfer' : null,
    categoryHint: line.kind === 'fee' ? 'other' : null,
  }
}

/**
 * Records made from a hold on the statement's account that no line of it met (Д3, Е4), where the
 * statement covers the hold's days: it begins no later than the day after the hold — its period, else
 * its first line; a screenshot of today says nothing of a hold two weeks old.
 */
function unpostedHolds(
  statement: Statement,
  candidates: readonly StatementCandidate[],
  paired: ReadonlySet<string>,
): StatementUnposted[] {
  const account = statement.accountId
  if (account === null) return []
  let first = Infinity
  let last = -Infinity
  if (statement.period) {
    first = dayNumber(statement.period.from)
    last = dayNumber(statement.period.to)
  } else
    for (const line of statement.lines) {
      // a loop, not Math.min(...days): a long statement overflows the stack (adversarial А7)
      const day = dayNumber(line.day)
      if (day < first) first = day
      if (day > last) last = day
    }
  if (first > last) return []
  const complete = isBankFile(statement.form) && statement.period !== null
  return candidates.flatMap((c) => {
    const link = c.link
    if (link === null || !link.pending || c.removed || paired.has(c.id)) return []
    if (c.account !== account) return []
    const held = dayNumber(link.day)
    if (first > held + 1 || last < held) return []
    const settled = last - held >= STATEMENT_HOLD_POST_DAYS
    return [{ record: { id: c.id, what: c.what }, settled, ticked: settled && complete }]
  })
}
