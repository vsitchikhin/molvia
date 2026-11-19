import type { Exchange } from '#model/entities/exchange'
import type { Expense } from '#model/entities/expense'
import type { Spending } from '#model/entities/spending'
import type { SpendingPreset } from '#model/entities/spending-category'
import {
  formKeyIsStable,
  isBankFile,
  statementKeyAccount,
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
import { bankSellerWords, sameSeller, sellerWords, wordsShare } from '#model/support/payee-name'
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
 * `late_post` (Е3), `relink` (Д1), `same_screenshot` (Е1, З1), `posting_day` — a file's line with no
 * posting day and a screenshot days after it (А12), `removed` (А5), `other_name` (Б4), `other_account` (В-1
 * «а»; a line known only by its key under another account — the same file again or another card's, А8),
 * `transfer` and `exchange` — another day, no account, a line that does not call itself so (Б1б, Г1,
 * Р-6).
 */
export type StatementDoubt =
  | 'tip'
  | 'hold'
  | 'late_post'
  | 'relink'
  | 'same_screenshot'
  | 'posting_day'
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

/**
 * The answer over one statement: `matched` — a decision for every line and the holds with no posting;
 * `too_heavy` — the statement weighs more than `STATEMENT_WEIGHED_MAX`, and the rule weighed none (А16,
 * review №23), or its matching took more than `STATEMENT_STEPS_MAX` steps, and the rule stopped there
 * (А22). `pairs` — what it weighs, the pairs of line and record and the keys under other uploads
 * (`STATEMENT_KEY_WEIGHT`); `steps` — the candidates the matching looked at (А20), none when refused
 * before it: both for the log.
 */
export type StatementMatch =
  | {
      readonly outcome: 'matched'
      readonly pairs: number
      readonly steps: number
      readonly lines: readonly { readonly key: string; readonly decision: StatementLineDecision }[]
      readonly unposted: readonly StatementUnposted[]
    }
  | { readonly outcome: 'too_heavy'; readonly pairs: number; readonly steps: number }

type Fit = 'exact' | 'unsure' | 'posting' | 'elsewhere' | 'tip' | 'hold' | 'late' | 'relink'

/** The fits in the order the matching takes them: what met first, the doubts only for what is left. */
const FIT_ORDER: readonly Fit[] = [
  'exact',
  'unsure',
  'posting',
  'elsewhere',
  'tip',
  'hold',
  'late',
  'relink',
]

/** A line as the rule reads it, each once: its key, its days as numbers, its amounts, its payee's seller words. */
interface Row {
  readonly index: number
  readonly line: StatementLine
  readonly key: string
  readonly day: number
  readonly posted: number | null
  readonly amounts: readonly Money[]
  readonly words: readonly string[]
}

/** A record as the rule reads it, each once: its days as numbers, its amounts, its seller's words. */
interface Known {
  readonly c: StatementCandidate
  readonly days: readonly number[]
  readonly link: Linked | null
  readonly amounts: readonly Money[]
  readonly seller: readonly string[]
  /** The account its link's key reads (`statementKeyAccount`), or none. */
  readonly under: string | null
}

interface Pair {
  readonly row: number
  readonly c: StatementCandidate
  readonly fit: Fit
  /** The record's link names this very line by its key: the line it was made from goes first (№15). */
  readonly own: boolean
  readonly named: number
  /** The record or the line names no seller — «Безналичная оплата» of Ardshin's screen (А15). */
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

/** A sum as a key: refunds are looked up among the lines and the records of their own sum (А23). */
const sumKey = ({ minor, currency }: Money) => `${minor.toString()} ${currency}`

/** Each item under every sum it has, once. */
function bySum<T>(items: readonly T[], sums: (item: T) => readonly Money[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const item of items)
    for (const key of new Set(sums(item).map(sumKey))) {
      const there = out.get(key)
      if (there) there.push(item)
      else out.set(key, [item])
    }
  return out
}

function inWindow(form: StatementForm, lineDay: number, recordDay: number): boolean {
  const after = lineDay - recordDay
  return form === 'screenshot'
    ? after >= -STATEMENT_SCREENSHOT_DAYS_BEFORE && after <= STATEMENT_SCREENSHOT_DAYS_AFTER
    : Math.abs(after) <= STATEMENT_FILE_WINDOW_DAYS
}

const daySlack = (a: StatementForm, b: StatementForm) =>
  SHIFTED_FORMS.has(a) || SHIFTED_FORMS.has(b) ? 1 : 0

/**
 * What a record's link says of a line (Г2, Д1, Д2, Е1, Е2, Ж2): `own` — its own line, by its key;
 * `other_upload` — the key the line had under the account the link was keyed under, which is the same
 * file uploaded again with an account chosen since (А4) or a like line of another card (А8): a doubt;
 * `same` — the link's operation in another form, or its hold's posting; `posting` — a file that prints
 * no posting day against a screenshot one to four days after it, which may be the operation posted
 * (А12): a doubt; `unsure` — a screenshot against a screenshot on one day the times do not tell apart;
 * `no` — never another key of the same file, which would have given the same key.
 */
type LinkSays = 'own' | 'other_upload' | 'same' | 'posting' | 'unsure' | 'no'

/** A record's link with its days as numbers, read once (review №21). */
interface Linked extends StatementLink {
  readonly onDay: number
  readonly postedDay: number | null
}

const linkedOf = (link: StatementLink | null): Linked | null =>
  link === null
    ? null
    : {
        ...link,
        onDay: dayNumber(link.day),
        postedDay: link.postedOn === null ? null : dayNumber(link.postedOn),
      }

/**
 * A line of a file against a screenshot of the same operation (MOL-428): a file dates a line by its
 * operation and prints its posting day beside it where its format has one; a screenshot shows the
 * posting day. With a posting day printed, they meet by it alone (А1, А11); with none, on one day, and
 * the screenshot one to four days later is a doubt (А12). Two files meet by the operation's day; ± 1 for
 * a form whose day moves.
 */
function operationSays(link: Linked, row: Row, form: StatementForm): 'same' | 'posting' | 'no' {
  const slack = daySlack(link.form, form)
  const meet = (a: number, b: number) => Math.abs(a - b) <= slack
  const shotOfFile = link.form === 'screenshot' && isBankFile(form)
  const fileOfShot = form === 'screenshot' && isBankFile(link.form)
  if (!shotOfFile && !fileOfShot) return meet(link.onDay, row.day) ? 'same' : 'no'
  const shot = shotOfFile ? link.onDay : row.day
  const file = shotOfFile ? row.day : link.onDay
  const posted = shotOfFile ? row.posted : link.postedDay
  if (posted !== null) return meet(shot, posted) ? 'same' : 'no'
  if (meet(shot, file)) return 'same'
  const later = shot - file
  return later >= 1 && later <= STATEMENT_SCREENSHOT_DAYS_AFTER ? 'posting' : 'no'
}

/**
 * The posting of a hold the record was made from (Г2б). A file dates it by its operation — the hold's
 * own day (Д2), so on that day only: a line of a file days after it is another operation (А2, А3). A
 * screenshot shows the posting day: within `STATEMENT_HOLD_POST_DAYS` after the hold, past the window
 * too, which is the measure of a record typed by hand, not of a bank's posting.
 */
function holdPosting(link: Linked, row: Row, form: StatementForm): boolean {
  if (!link.pending || row.line.status === 'pending') return false
  const after = row.day - link.onDay
  return isBankFile(form)
    ? Math.abs(after) <= daySlack(link.form, form)
    : after >= 0 && after <= STATEMENT_HOLD_POST_DAYS
}

function linkSays(
  link: Linked,
  row: Row,
  form: StatementForm,
  account: string | null,
  keyUnder: (link: Linked, index: number) => string | undefined,
): LinkSays {
  if (link.key === row.key) return 'own'
  // The key the line had under the link's upload: its account's other statement — the card's and the
  // account's, a card reissued — where the account in Molvia is one; else the same file under another
  // choice of account, or a like line of another card: a doubt (А4, А8, А14, А18).
  if (link.key === keyUnder(link, row.index))
    return link.accountId !== null && link.accountId === account ? 'own' : 'other_upload'
  if (link.form === 'screenshot' && form === 'screenshot' && link.onDay === row.day) {
    const said = printedTimesSay(link.time, row.line.time)
    return said === 'same' ? 'same' : said === 'apart' ? 'no' : 'unsure'
  }
  const sameFile = formKeyIsStable(form) && link.form === form
  const operation = sameFile ? 'no' : operationSays(link, row, form)
  if (operation !== 'no') return operation
  return holdPosting(link, row, form) ? 'same' : 'no'
}

/**
 * Relink (Д1): a line met exactly and nearer the record than the line of its link is a doubt. Kept as
 * recorded, it moves the link to itself and writes the link's line as a spending of its own. Neither a
 * hold nor a transfer or an exchange: they have paths of their own.
 */
function relinks(
  c: StatementCandidate,
  link: Linked,
  days: readonly number[],
  distance: number,
): boolean {
  if (link.pending || c.what === 'transfer' || c.what === 'exchange') return false
  return distance < Math.min(...days.map((d) => Math.abs(link.onDay - d)))
}

/**
 * A hold's late posting (Е3): past `STATEMENT_HOLD_POST_DAYS`, within `STATEMENT_LATE_POST_DAYS` — on a
 * screenshot, which shows the posting day; a file's posting is on the hold's day (Д2). Its name is
 * asked by the caller.
 */
function lateFit(
  link: Linked,
  row: Row,
  form: StatementForm,
  amount: 'exact' | 'tip' | 'hold',
): 'late' | null {
  if (!link.pending || row.line.status === 'pending' || isBankFile(form)) return null
  if (amount === 'tip') return null
  const after = row.day - link.onDay
  return after > STATEMENT_HOLD_POST_DAYS && after <= STATEMENT_LATE_POST_DAYS ? 'late' : null
}

/**
 * The days of lines a record can meet: its window around each of its days, and around its link's days
 * as far as a link reaches — a late posting's thirty days either way bound them all (review №1, А13). A
 * line is looked up by its day and its posting day both (`reaching`): a screenshot meets a file's line by
 * the posting day it prints, however long after the operation (review №20). So the index decides
 * nothing; it only spares the pairs no path could join.
 */
function reachOf(form: StatementForm, days: readonly number[], link: Linked | null) {
  const before =
    form === 'screenshot' ? STATEMENT_SCREENSHOT_DAYS_BEFORE : STATEMENT_FILE_WINDOW_DAYS
  const after = form === 'screenshot' ? STATEMENT_SCREENSHOT_DAYS_AFTER : STATEMENT_FILE_WINDOW_DAYS
  let from = Math.min(...days) - before
  let to = Math.max(...days) + after
  if (link !== null) {
    const far = STATEMENT_LATE_POST_DAYS + 1
    from = Math.min(from, link.onDay - far, (link.postedDay ?? link.onDay) - far)
    to = Math.max(to, link.onDay + far, (link.postedDay ?? link.onDay) + far)
  }
  return { from, to }
}

/** Each record under every day of a line it can meet (`reachOf`). */
function dayIndex<T extends { readonly days: readonly number[]; readonly link: Linked | null }>(
  form: StatementForm,
  records: readonly T[],
): Map<number, T[]> {
  const byDay = new Map<number, T[]>()
  for (const r of records) {
    const { from, to } = reachOf(form, r.days, r.link)
    for (let day = from; day <= to; day++) {
      const there = byDay.get(day)
      if (there) there.push(r)
      else byDay.set(day, [r])
    }
  }
  return byDay
}

/** The records a line weighs: those under its day, and under its posting day, each once. */
function reaching<T>(
  byDay: ReadonlyMap<number, readonly T[]>,
  row: Pick<Row, 'day' | 'posted'>,
): readonly T[] {
  const on = byDay.get(row.day) ?? []
  const posted = row.posted === null || row.posted === row.day ? undefined : byDay.get(row.posted)
  if (posted === undefined) return on
  const seen = new Set(on)
  return [...on, ...posted.filter((r) => !seen.has(r))]
}

/** A line the rule weighs against records: money out the reader did not name as no spending. */
const weighed = (line: StatementLine) => notSpendingByLine(line) === null && line.sign === '-'

/**
 * The pairs of line and record the rule weighs at most (А16): it runs in the API's process. A line weighs
 * only the records whose window or link reaches its days, so a year of 3 000 lines against 3 000 records
 * linked to screenshots weighs some 1 500 000, in about half a second here, and the same crowded in one
 * month weighs all 9 000 000, seconds. Past it the rule answers `too_heavy` and weighs nothing — counted
 * on its own index, so no caller weighs past it (review №23); the screen's word is MOL-433's.
 */
export const STATEMENT_WEIGHED_MAX = 2_000_000

/**
 * A line's key under another upload, in pairs (adversarial А21): a link keyed under another account's
 * number asks every line's key under it once — an md5 each, some 7 µs here, as long as twenty pairs
 * weighed at their worst — a pair whose sum fits and whose name is weighed, some 0.33 µs (А16).
 */
export const STATEMENT_KEY_WEIGHT = 20

/**
 * Two names weighed against each other, in pairs (adversarial А23, А24): every word of one against every
 * word of the other — a pair a word against a word, and one more for every `STATEMENT_LETTERS_PER_PAIR`
 * of their letters multiplied. Measured here, a unit of it took 0.04–0.27 µs, under a pair's 0.33: two
 * words against one 0.15 µs, eight against eight 22 µs. Names are bounded (`SELLER_WORDS_MAX`,
 * `SELLER_WORD_LETTERS`); before, fifty words against twenty took 0.4 ms a pair, and 30 000 such pairs —
 * 1.5 % of the ceiling — 15 s.
 */
export const STATEMENT_LETTERS_PER_PAIR = 32

const lettersOf = (words: readonly string[]) => words.reduce((n, word) => n + word.length, 0)

/**
 * The names a pair's 0.33 µs was measured with (А16) — «SAS SUPERMARKET» against «SAS», 4: a pair's names
 * weigh only what they weigh beyond.
 */
export const STATEMENT_NAMES_IN_A_PAIR = 4

/** What weighing two names costs, in pairs (`STATEMENT_LETTERS_PER_PAIR`). */
export function statementNamesWeight(a: readonly string[], b: readonly string[]): number {
  return a.length * b.length + Math.ceil((lettersOf(a) * lettersOf(b)) / STATEMENT_LETTERS_PER_PAIR)
}

/**
 * The steps of the matching at most (adversarial А22): the candidates its searches look at. A crowd of
 * one sum on two days — a line's best taken, its free record a rank worse — sends every line left over
 * through the whole crowd: 856 642 712 steps, 25 s here under the ceiling of pairs, some 0.03 µs a step.
 * Twenty million are some 0.6 s; past them the rule stops and answers `too_heavy`. **The price, named**
 * (review №29): the two ceilings add up — one call weighs up to `STATEMENT_WEIGHED_MAX`, some 0.66 s, and
 * then matches up to these steps, some 0.6 s more: 1.3 s of the API's loop at worst.
 */
export const STATEMENT_STEPS_MAX = 20_000_000

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
  if (p.fit === 'posting') return 'posting_day'
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

const sameRank = (p: Pair, q: Pair) =>
  p.own === q.own && p.named === q.named && p.distance === q.distance

/**
 * One to one by the greatest matching (А3, Б2): lines in the order of their best pair, each with its
 * candidates by preference; a taken record is taken over only when its line finds another (Kuhn's path),
 * and only when no record as good as it is free. The fits go in `FIT_ORDER`: a doubt takes only a record
 * left free. The records a failed search went through lead nowhere until a line is matched, so the next
 * line's search skips them: a crowd of one sum, more lines than records, searched again every record for
 * every line left over — some 10⁹ steps under the ceiling of pairs (adversarial А20).
 */
function matchPairs(pairs: readonly Pair[]): {
  readonly choice: Map<number, Pair> | null
  readonly steps: number
} {
  const owner = new Map<string, number>()
  const choice = new Map<number, Pair>()
  let steps = 0
  for (const fit of FIT_ORDER) {
    const options = new Map<number, Pair[]>()
    for (const p of pairs) {
      if (p.fit !== fit) continue
      const held = options.get(p.row)
      if (held) held.push(p)
      else options.set(p.row, [p])
    }
    const take = (row: number, p: Pair) => {
      owner.set(p.c.id, row)
      choice.set(row, p)
      return true
    }
    const claim = (row: number, seen: Set<string>): boolean => {
      const mine = options.get(row) ?? []
      const best = mine[0]
      for (const p of mine) {
        if (++steps > STATEMENT_STEPS_MAX) return false
        if (best === undefined || !sameRank(p, best)) break
        if (!owner.has(p.c.id)) return take(row, p)
      }
      for (const p of mine) {
        if (++steps > STATEMENT_STEPS_MAX) return false
        if (seen.has(p.c.id)) continue
        seen.add(p.c.id)
        const holder = owner.get(p.c.id)
        if (holder === undefined || (choice.get(holder)?.fit === fit && claim(holder, seen)))
          return take(row, p)
      }
      return false
    }
    let seen = new Set<string>()
    for (const row of options.keys()) {
      if (!choice.has(row) && claim(row, seen)) seen = new Set()
      if (steps > STATEMENT_STEPS_MAX) return { choice: null, steps }
    }
  }
  return { choice, steps }
}

/**
 * The rule over one statement: a decision for every line, with its key, and the holds it shows no
 * posting of. The candidates are the person's spendings (removed ones still within «Вернуть»), finished
 * trips, transfers and exchanges, built by the functions above. A line is weighed only against the
 * records whose window or link reaches its day, the sum first; a name is folded once a line and once a
 * record — it runs in the API's process (review №1, А13), and refuses past `STATEMENT_WEIGHED_MAX` (А16).
 */
export function matchStatement(
  actorId: string,
  statement: Statement,
  candidates: readonly StatementCandidate[],
): StatementMatch {
  const { form } = statement
  const account = statement.accountId
  const rows: Row[] = statementKeyedLines(actorId, statement).map(({ line, key }, index) => ({
    index,
    line,
    key,
    day: dayNumber(line.day),
    posted: line.postedOn === null ? null : dayNumber(line.postedOn),
    amounts: amountsOfLine(line),
    words: bankSellerWords(line.payee),
  }))
  const known: Known[] = candidates.map((c) => ({
    c,
    days: c.days.map(dayNumber),
    link: linkedOf(c.link),
    amounts: amountsOfRecord(c),
    seller: sellerWords(c.name),
    under: c.link === null ? null : statementKeyAccount(c.link),
  }))
  const byDay = dayIndex(form, known) // a line weighs the records that reach its days alone (А13)
  // The keys the lines had under a link's upload, by the account its key reads — masks of one number are
  // one (review №27) — asked once an upload; this upload's are the lines' own (А4, А18).
  const ours = statementKeyAccount(statement)
  const keysUnder = new Map([[ours, rows.map((row) => row.key)]])
  const keyUnder = ({ accountId, accountNumber }: Linked, index: number) => {
    const under = statementKeyAccount({ accountId, accountNumber })
    let keys = keysUnder.get(under)
    if (keys === undefined) {
      keys = statementLineKeys(actorId, { ...statement, accountId, accountNumber })
      keysUnder.set(under, keys)
    }
    return keys[index]
  }

  const decisions = new Map<number, StatementLineDecision>()
  const spend: Row[] = []
  for (const row of rows) {
    const reason = notSpendingByLine(row.line)
    if (reason !== null) decisions.set(row.index, { group: 'not_spending', reason, record: null })
    if (weighed(row.line)) spend.push(row)
  }

  // A refund (В3, Г4) is looked for among the lines and records of its own sum alone (А23), and names its
  // seller: a line or a record naming none is one seller with nothing (`sameSeller`), and is not weighed
  // against a thing (А25).
  const refunds = rows.filter(
    (row) => !decisions.has(row.index) && row.line.sign === '+' && row.words.length > 0,
  )
  const refundsBySum = bySum(refunds, (row) => [row.line.amount])
  const refundable = bySum(
    known.filter(
      ({ c, seller }) =>
        (c.what === 'spending' || c.what === 'trip') &&
        !c.removed &&
        onAccount(c, account) &&
        seller.length > 0,
    ),
    (k) => k.amounts,
  )
  const refundedRecords = (row: Row) => [
    ...new Set(row.amounts.flatMap((a) => refundable.get(sumKey(a)) ?? [])),
  ]

  // The work, before any of it: past the ceiling nothing is weighed (А16) — the pairs, the keys of every
  // line under each other upload a link reaching them was keyed under (А21), and the sellers a refund
  // weighs against a purchase's of its sum and a record's (А23); counted, not kept (review №26).
  let weight = 0
  const uploads = new Set<string>()
  for (const row of spend) {
    const records = reaching(byDay, row)
    weight += records.length
    for (const { under } of records) if (under !== null && under !== ours) uploads.add(under)
  }
  weight += uploads.size * rows.length * STATEMENT_KEY_WEIGHT
  // A seller is weighed both ways (`sameSeller`); summed with an early way out, a crowd of one sum is
  // counted no further than the ceiling.
  const tooHeavy = () => ({ outcome: 'too_heavy', pairs: weight, steps: 0 }) as const
  for (const row of spend) {
    if (row.words.length === 0) continue
    for (const back of refundsBySum.get(sumKey(row.line.amount)) ?? [])
      weight += 2 * statementNamesWeight(row.words, back.words)
    if (weight > STATEMENT_WEIGHED_MAX) return tooHeavy()
  }
  for (const row of refunds) {
    for (const sum of row.amounts)
      for (const { seller } of refundable.get(sumKey(sum)) ?? [])
        weight += 2 * statementNamesWeight(row.words, seller)
    if (weight > STATEMENT_WEIGHED_MAX) return tooHeavy()
  }
  if (weight > STATEMENT_WEIGHED_MAX) return tooHeavy()

  // Every pair whose sum fits, then one to one: met before doubts, the line a record was made from
  // first, then by the share of the name (А4), the nearer day, the order of the lines. A pair's names are
  // weighed before they are compared (А24), and past the ceiling none is (review №30).
  const pairs: Pair[] = []
  for (const row of spend) {
    for (const { c, days, link, amounts, seller } of reaching(byDay, row)) {
      const moves = c.what === 'transfer' || c.what === 'exchange'
      if (moves && !onAccount(c, account)) continue
      const inside = days.some((d) => inWindow(form, row.day, d))
      if (!inside && link === null) continue // only a link reaches past the window
      const amount = amountFit(row.amounts, amounts)
      if (amount === null) continue
      const distance = Math.min(...days.map((d) => Math.abs(row.day - d)))
      const says = link === null ? 'same' : linkSays(link, row, form, account, keyUnder)
      // A link that names the line lets it in past the window: its key, its operation, its hold's posting.
      const near = inside || (says !== 'no' && says !== 'unsure')
      const exact = amount === 'exact'
      let fit: Fit | null
      if (link !== null && !near)
        fit = lateFit(link, row, form, amount) // a hold's late posting, past the window too (Е3)
      else if (says === 'unsure') fit = exact ? 'unsure' : null
      else if (says === 'posting') fit = exact ? 'posting' : null
      else if (says === 'other_upload')
        fit = exact ? 'elsewhere' : null // А8
      else if (link !== null && says === 'no')
        fit =
          exact && relinks(c, link, days, distance) ? 'relink' : lateFit(link, row, form, amount)
      else fit = amount
      if (fit === null) continue
      weight += Math.max(0, statementNamesWeight(row.words, seller) - STATEMENT_NAMES_IN_A_PAIR)
      if (weight > STATEMENT_WEIGHED_MAX) return tooHeavy()
      const named = wordsShare(row.words, seller)
      // A late posting and a hold are known by the name; a hold only on the statement's account: a hold
      // is a card's, and a record with no account is cash or before the accounts — a purchase under it
      // in the same chain is new (Г3).
      if (fit === 'late' && named === 0) continue
      if (fit === 'hold' && (named === 0 || account === null || c.account !== account)) continue
      if (fit === 'exact' && !moves && !onAccount(c, account)) fit = 'elsewhere' // В-1 «а»
      pairs.push({
        row: row.index,
        c,
        fit,
        own: says === 'own' || says === 'other_upload',
        named,
        // A line that names no seller is no other name only for a record its link reaches: by the window
        // alone a dinner typed by hand would take a purchase silently (А15, А17).
        nameless: seller.length === 0 || (row.words.length === 0 && link !== null && says !== 'no'),
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
  const { choice, steps } = matchPairs(pairs)
  if (choice === null) return { ...tooHeavy(), steps }
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
  const refunded = new Set<number>()
  for (const { index, line, words } of spend) {
    if (decisions.has(index) || words.length === 0) continue
    const back = refundsBySum
      .get(sumKey(line.amount))
      ?.find(
        ({ index: r, line: refund, words: theirs }) =>
          !refunded.has(r) && refund.day >= line.day && sameSeller(theirs, words),
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
    const { index, day, words } = row
    if (refunded.has(index)) continue
    let best: { readonly c: StatementCandidate; readonly after: number } | undefined
    for (const { c, days, seller } of refundedRecords(row)) {
      if (hinted.has(c.id)) continue
      const afters = days.map((d) => day - d).filter((a) => a >= 0 && a <= STATEMENT_REFUND_DAYS)
      if (afters.length === 0 || !sameSeller(words, seller)) continue
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
    outcome: 'matched',
    pairs: weight,
    steps,
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
