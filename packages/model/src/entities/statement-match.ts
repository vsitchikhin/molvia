import { COUNTRY_CITIES } from '#model/contracts/settings'
import type { Exchange } from '#model/entities/exchange'
import type { Expense } from '#model/entities/expense'
import type { Spending } from '#model/entities/spending'
import { formKeyIsStable, statementLineKeys } from '#model/entities/statement-line'
import type {
  Statement,
  StatementForm,
  StatementLine,
  StatementLink,
} from '#model/entities/statement-line'
import type { Transfer } from '#model/entities/transfer'
import { tripMoney } from '#model/entities/trip'
import { levenshtein } from '#model/support/edits'
import { payeeNameShare, payeeWords, payeeWordsNear } from '#model/support/payee-name'
import { printedTimesSay } from '#model/support/printed-time'
import type { Money } from '#model/values/money'
import { yerevanDate } from '#model/values/rates'

// The duplicates rule (MOL-429): which lines of a statement are already in Molvia — a spending, a trip,
// a transfer, an exchange — which are new spendings, and which are no spendings at all. The rule is the
// bench's of MOL-409 (`research/MOL-409/bench/match.mjs`, rounds А…Н, each named where it acts), with
// the two findings of MOL-428's measurement: an exchange is a candidate, and a record on another account
// is a doubt (owner's В-1 «а»). The windows and the tolerance are measured there.

/** A file's line meets a record within two days of it (MOL-428). */
export const STATEMENT_FILE_WINDOW_DAYS = 2

/** A screenshot shows the posting day: from two days before the record to four after (MOL-428). */
export const STATEMENT_SCREENSHOT_DAYS_BEFORE = 2
export const STATEMENT_SCREENSHOT_DAYS_AFTER = 4

/** A line up to a fifth over the record — a tip, a service — is a doubt, never a match (А2). */
const TIP_PERMILLE = 200n

/** A posting under its hold, down to half of it, with the same name, is a doubt (В4). */
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
 * What the rule reads of a record. `accounts` are the record's account — for a transfer the source and
 * the destination, for an exchange the account given from; `days` — a trip's start and finish.
 */
export interface StatementCandidate {
  readonly id: string
  readonly what: StatementCandidateKind
  readonly days: readonly string[]
  readonly money: readonly Money[]
  readonly debited: Money | null
  readonly accounts: readonly (string | null)[]
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
    accounts: [spending.accountId],
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
    accounts: [trip.accountId],
    name: trip.placeName,
    removed,
    link,
  }
}

export function transferCandidate(
  transfer: Pick<
    Transfer,
    'id' | 'fromAccountId' | 'toAccountId' | 'amount' | 'transferredOn' | 'note'
  >,
  { removed, link }: RecordState,
): StatementCandidate {
  return {
    id: transfer.id,
    what: 'transfer',
    days: [transfer.transferredOn],
    money: [transfer.amount],
    debited: null,
    accounts: [transfer.fromAccountId, transfer.toAccountId],
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
    accounts: [exchange.givenAccountId],
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
      readonly categoryHint: 'other' | null
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

interface Pair {
  readonly line: number
  readonly c: StatementCandidate
  readonly fit: Fit
  readonly named: number
  readonly distance: number
}

const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00.000Z`) / 86_400_000)

/** The words of a city of the settings, folded: «Москва» is «MOSCOW», «Ереван» is «YEREVAN» (Р-4). */
const CITY_WORDS: readonly string[] = Object.values(COUNTRY_CITIES).flatMap((cities) =>
  cities.flatMap((city) => payeeWords(city)),
)

/**
 * A word the bank's format puts in every card line of a city — «…\AM\YEREVAN\…» — which says nothing of
 * the seller (М1). Exact under six letters, «SAS» is no «Сад»; two edits from six, as any word.
 */
function isPlaceWord(word: string): boolean {
  return CITY_WORDS.some(
    (city) =>
      city === word || (Math.min(city.length, word.length) >= 6 && levenshtein(city, word) <= 2),
  )
}

/**
 * One seller in two bank lines, or a line and a record (В3, Г4): every word of one name, places aside,
 * is the other's (Н1: one shared word — «SUPERMARKET», «PIZZA» — is no seller).
 */
function sameSeller(a: string, b: string): boolean {
  const ours = payeeWords(a).filter((w) => !isPlaceWord(w))
  const theirs = payeeWords(b).filter((w) => !isPlaceWord(w))
  const within = (xs: string[], ys: string[]) =>
    xs.length > 0 && xs.every((x) => ys.some((y) => payeeWordsNear(x, y)))
  return within(ours, theirs) || within(theirs, ours)
}

const amountsOfLine = (line: StatementLine): Money[] =>
  line.debited ? [line.amount, line.debited] : [line.amount]
const amountsOfRecord = (c: StatementCandidate): Money[] =>
  c.debited ? [...c.money, c.debited] : [...c.money]

/**
 * Each amount the line shows against each the record has — its money and its «списано» (А1): `exact`
 * when one meets, `tip` a line up to a fifth over, `hold` a line under, down to half; else null.
 */
function amountFit(line: StatementLine, c: StatementCandidate): 'exact' | 'tip' | 'hold' | null {
  let near: 'tip' | 'hold' | null = null
  for (const a of amountsOfLine(line))
    for (const r of amountsOfRecord(c)) {
      if (a.currency !== r.currency) continue
      if (a.minor === r.minor) return 'exact'
      if (a.minor > r.minor && (a.minor - r.minor) * 1000n <= r.minor * TIP_PERMILLE) near = 'tip'
      else if (a.minor < r.minor && a.minor * 1000n >= r.minor * HOLD_FLOOR_PERMILLE)
        near ??= 'hold'
    }
  return near
}

const sameAmount = (line: StatementLine, c: StatementCandidate) =>
  amountsOfLine(line).some((a) =>
    amountsOfRecord(c).some((r) => r.currency === a.currency && r.minor === a.minor),
  )

function inWindow(form: StatementForm, lineDay: number, recordDay: number): boolean {
  const after = lineDay - recordDay
  return form === 'screenshot'
    ? after >= -STATEMENT_SCREENSHOT_DAYS_BEFORE && after <= STATEMENT_SCREENSHOT_DAYS_AFTER
    : Math.abs(after) <= STATEMENT_FILE_WINDOW_DAYS
}

const daySlack = (a: StatementForm, b: StatementForm) =>
  SHIFTED_FORMS.has(a) || SHIFTED_FORMS.has(b) ? 1 : 0

/**
 * Whether a record's link lets this line in (Г2, Д2, Е1, Е2): its own line; a line of another form — or
 * a screenshot against a screenshot — on the link's day, ± 1 for a form whose day moves; never another
 * key of the same file, which would have given the same key; a hold's posting within its days. A
 * screenshot against a screenshot on one day is told by the time, else is a doubt (Ж2, З1, И1, И2).
 */
function linkLets(
  link: StatementLink,
  line: StatementLine,
  key: string,
  form: StatementForm,
): boolean | 'unsure' {
  if (link.key === key) return true
  const day = dayNumber(line.day)
  const linkDay = dayNumber(link.day)
  if (link.form === 'screenshot' && form === 'screenshot' && day === linkDay) {
    const said = printedTimesSay(link.time, line.time)
    return said === 'same' ? true : said === 'apart' ? false : 'unsure'
  }
  const sameFile = formKeyIsStable(form) && link.form === form
  if (!sameFile && Math.abs(day - linkDay) <= daySlack(link.form, form)) return true
  return holdPosting(link, line)
}

/**
 * The posting of a hold the record was made from (Г2б): posted, within `STATEMENT_HOLD_POST_DAYS` after it — past
 * the window too, which is the measure of a record typed by hand, not of a bank's posting.
 */
function holdPosting(link: StatementLink | null, line: StatementLine): boolean {
  if (link === null || !link.pending || line.status === 'pending') return false
  const after = dayNumber(line.day) - dayNumber(link.day)
  return after > 0 && after <= STATEMENT_HOLD_POST_DAYS
}

/**
 * Relink (Д1): a line met exactly and nearer the record than the line of its link is a doubt. Kept as
 * recorded, it moves the link to itself and writes the link's line as a spending of its own. Neither a
 * hold nor a transfer or an exchange: they have paths of their own.
 */
function relinks(c: StatementCandidate, distance: number): boolean {
  const link = c.link
  if (link === null || link.pending || c.what === 'transfer' || c.what === 'exchange') return false
  const linkDay = dayNumber(link.day)
  return distance < Math.min(...c.days.map((d) => Math.abs(linkDay - dayNumber(d))))
}

/** A hold's late posting (Е3): posted, past `STATEMENT_HOLD_POST_DAYS`, within `STATEMENT_LATE_POST_DAYS`, by its name. */
function lateFit(
  c: StatementCandidate,
  line: StatementLine,
  fit: Fit | null,
  named: number,
): Fit | null {
  const link = c.link
  if (link === null || !link.pending || line.status === 'pending' || named === 0) return null
  if (fit !== 'exact' && fit !== 'hold') return null
  const after = dayNumber(line.day) - dayNumber(link.day)
  return after > STATEMENT_HOLD_POST_DAYS && after <= STATEMENT_LATE_POST_DAYS ? 'late' : null
}

/** A record on the statement's account, or either of them with none. */
const onAccount = (c: StatementCandidate, account: string | null) =>
  account === null || c.accounts.every((a) => a === null) || c.accounts.includes(account)

/** A transfer's or an exchange's money left this account — or either is not known (Б1а). */
const fromAccount = (c: StatementCandidate, account: string | null) =>
  account === null || c.accounts[0] === null || c.accounts[0] === account

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
    const sure = account !== null && p.c.accounts[0] === account && says && p.distance === 0
    return sure ? 'settled' : p.c.what
  }
  return payeeWords(p.c.name).length > 0 && p.named === 0 ? 'other_name' : null
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
    for (const p of pairs)
      if (p.fit === fit) options.set(p.line, [...(options.get(p.line) ?? []), p])
    const claim = (line: number, seen: Set<string>): boolean => {
      for (const p of options.get(line) ?? []) {
        if (seen.has(p.c.id)) continue
        seen.add(p.c.id)
        const holder = owner.get(p.c.id)
        if (holder === undefined || (choice.get(holder)?.fit === fit && claim(holder, seen))) {
          owner.set(p.c.id, line)
          choice.set(line, p)
          return true
        }
      }
      return false
    }
    for (const line of options.keys()) if (!choice.has(line)) claim(line, new Set())
  }
  return choice
}

/**
 * The rule over one statement: a decision for every line, with its key, and the holds it shows no
 * posting of. The candidates are the person's spendings (removed ones still within «Вернуть»), finished
 * trips, transfers and exchanges, built by the functions above.
 */
export function matchStatement(
  actorId: string,
  statement: Statement,
  candidates: readonly StatementCandidate[],
): StatementMatch {
  const { form, lines } = statement
  const account = statement.accountId
  const keys = statementLineKeys(actorId, statement)
  const decisions = new Map<number, StatementLineDecision>()
  const spend: number[] = []
  lines.forEach((line, i) => {
    const reason = notSpendingByLine(line)
    if (reason !== null) decisions.set(i, { group: 'not_spending', reason, record: null })
    else if (line.sign === '-') spend.push(i)
  })

  // Every pair in the window, then one to one: met before doubts, by the share of the name (А4), the
  // nearer day first, then the order of the lines.
  const pairs: Pair[] = []
  for (const i of spend) {
    const line = lines[i]
    const key = keys[i]
    if (line === undefined || key === undefined) continue
    const day = dayNumber(line.day)
    for (const c of candidates) {
      const own = c.what === 'transfer' || c.what === 'exchange'
      if (own && !fromAccount(c, account)) continue
      const days = c.days.map(dayNumber)
      const distance = Math.min(...days.map((d) => Math.abs(day - d)))
      const near = days.some((d) => inWindow(form, day, d)) || holdPosting(c.link, line)
      const named = payeeNameShare(line.payee, c.name)
      const amount = amountFit(line, c)
      const lets = near && c.link !== null ? linkLets(c.link, line, key, form) : near
      let fit: Fit | null
      if (!near)
        fit = lateFit(c, line, amount, named) // a hold's late posting, past the window too (Е3)
      else if (lets === 'unsure') fit = amount === 'exact' ? 'unsure' : null
      else if (!lets)
        fit =
          amount === 'exact' && relinks(c, distance) ? 'relink' : lateFit(c, line, amount, named)
      else fit = amount
      if (fit === null) continue
      // A hold is known by its name and only on the statement's account: a hold is a card's, and a record
      // with no account is cash or before the accounts — a purchase under it in the same chain is new (Г3).
      if (fit === 'hold' && (named === 0 || account === null || !c.accounts.includes(account)))
        continue
      if (fit === 'exact' && !own && !onAccount(c, account)) fit = 'elsewhere' // В-1 «а»
      pairs.push({ line: i, c, fit, named, distance })
    }
  }
  pairs.sort(
    (p, q) =>
      (p.fit === 'exact' ? 0 : 1) - (q.fit === 'exact' ? 0 : 1) ||
      q.named - p.named ||
      p.distance - q.distance ||
      p.line - q.line,
  )
  const choice = matchPairs(pairs)
  for (const [i, p] of choice) {
    const line = lines[i]
    if (line === undefined) continue
    const record = { id: p.c.id, what: p.c.what }
    const doubt = doubtOf(p, line, account)
    if (doubt === 'settled') {
      const reason = p.c.what === 'exchange' ? 'exchange' : 'own_transfer'
      decisions.set(i, { group: 'not_spending', reason, record })
    } else decisions.set(i, { group: 'recorded', record, doubt })
  }

  // A purchase and its refund in the same file (В3): the purchase new and not ticked; one refund a purchase.
  const refunds = lines.flatMap((line, i) => (decisions.has(i) || line.sign !== '+' ? [] : [i]))
  const refunded = new Set<number>()
  for (const i of spend) {
    const line = lines[i]
    if (line === undefined || decisions.has(i)) continue
    const back = refunds.find((r) => {
      const refund = lines[r]
      return (
        refund !== undefined &&
        !refunded.has(r) &&
        refund.amount.currency === line.amount.currency &&
        refund.amount.minor === line.amount.minor &&
        refund.day >= line.day &&
        sameSeller(refund.payee, line.payee)
      )
    })
    if (back === undefined) continue
    refunded.add(back)
    decisions.set(i, { group: 'new', ticked: false, note: 'refunded', categoryHint: null })
    decisions.set(back, { group: 'not_spending', reason: 'refund', record: null })
  }

  // A refund of a recorded spending or trip (Г4): the same sum from the same seller within STATEMENT_REFUND_DAYS
  // after it — no spending, said with the record; one refund a record.
  const hinted = new Set<string>()
  for (const i of refunds) {
    const line = lines[i]
    if (line === undefined || refunded.has(i)) continue
    const day = dayNumber(line.day)
    const c = candidates.find(
      (c) =>
        (c.what === 'spending' || c.what === 'trip') &&
        !c.removed &&
        !hinted.has(c.id) &&
        onAccount(c, account) &&
        c.days.some((d) => day >= dayNumber(d) && day - dayNumber(d) <= STATEMENT_REFUND_DAYS) &&
        sameAmount(line, c) &&
        sameSeller(line.payee, c.name),
    )
    if (c === undefined) continue
    hinted.add(c.id)
    decisions.set(i, {
      group: 'not_spending',
      reason: 'refund',
      record: { id: c.id, what: c.what },
    })
  }

  const decided = lines.map((line, i): StatementLineDecision => {
    const known = decisions.get(i)
    if (known !== undefined) return known
    if (line.sign === '+') return { group: 'not_spending', reason: 'income', record: null }
    const transfer = line.kind === 'transfer' // В-2 «б»: shown, not ticked, asked whether it is a spending
    return {
      group: 'new',
      ticked: !transfer,
      note: transfer ? 'transfer' : null,
      categoryHint: line.kind === 'fee' ? 'other' : null,
    }
  })

  return {
    lines: decided.map((decision, i) => ({ key: keys[i] ?? '', decision })),
    unposted: unpostedHolds(
      statement,
      candidates,
      new Set([...choice.values()].map((p) => p.c.id)),
    ),
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
  const days = statement.lines.map((line) => dayNumber(line.day))
  if (account === null || (statement.period === null && days.length === 0)) return []
  const first = statement.period ? dayNumber(statement.period.from) : Math.min(...days)
  const last = statement.period ? dayNumber(statement.period.to) : Math.max(...days)
  const complete = formKeyIsStable(statement.form) && statement.period !== null
  return candidates.flatMap((c) => {
    const link = c.link
    if (link === null || !link.pending || c.removed || paired.has(c.id)) return []
    if (!c.accounts.includes(account)) return []
    const held = dayNumber(link.day)
    if (first > held + 1 || last < held) return []
    const settled = last - held >= STATEMENT_HOLD_POST_DAYS
    return [{ record: { id: c.id, what: c.what }, settled, ticked: settled && complete }]
  })
}
