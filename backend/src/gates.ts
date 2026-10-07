import {
  GATE_RATINGS,
  GATE_RATINGS_STOP_PERCENT,
  GATE_RATINGS_WINDOW_HOURS,
  GATE_RETURN_STOP_PERCENT,
  LOGIN_SECOND_WAY_PERCENT,
  RECEIPT_EDITS_STOP_PERCENT,
  yerevanDate,
  yerevanMidnight,
  describeFailure,
} from '@molvia/model'
import type {
  GatesReader,
  GatesReport,
  GatesWindow,
  LoginsInWindow,
  ReceiptsInWindow,
  RemindersInWindow,
  TaxReceiptsInWindow,
} from '@/db/gates-reader'

export const GATES_USAGE =
  'usage: gates --from <when> [--to <when>]   when: a day YYYY-MM-DD in Yerevan (--to takes the day in), or an ISO 8601 moment with an offset'

/** 0 — read, 1 — the database failed, 2 — the command was wrong. */
export type GatesExit = 0 | 1 | 2

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
// What `reachedRatings` hands Postgres, checked here so a wrong year is `usage`, not a RangeError.
const FIRST_READABLE = Date.parse('0001-01-01T00:00:00Z')
const PAST_READABLE = Date.parse('+010000-01-01T00:00:00Z')

const DAY = /^\d{4}-\d{2}-\d{2}$/
// A moment without an offset is refused: whose hour it is would be the machine's guess.
const MOMENT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2}(\.\d{1,3})?)?(Z|([+-])(\d{2}):(\d{2}))$/

/**
 * Reads gates 0.2 and 0.3 by hand, on production (MOL-91) — `dist/gates.js` in the API's image,
 * `make gates` in a copy. Read only, and nothing but counts and dates in the output.
 *
 * Every percentage stands beside its `n`: the cohort is «as many as we find», with no minimum, and
 * «2 of 10» must not read as a sentence (the plan of 0.2). For the same reason the stop line is
 * printed and a verdict is not.
 */
export async function gates(
  argv: readonly string[],
  reader: GatesReader,
  write: (line: string) => void,
  now: () => Date = () => new Date(),
): Promise<GatesExit> {
  const parsed = parseWindow(argv, now)
  if (parsed === null) {
    write(GATES_USAGE)
    return 2
  }
  const { window } = parsed

  let report: GatesReport
  try {
    report = await reader.read(window)
  } catch (error) {
    // The kind of failure and never its message: a driver's message is the query with its
    // parameters, as `forget` says of its own.
    const failure = describeFailure(error)
    write(`reading the gates failed: ${failure.code ?? failure.errorName}`)
    return 1
  }

  for (const line of formatReport(parsed, report)) write(line)
  return 0
}

/**
 * The window, and how its edges were given, for the heading: a day is printed as the day and a
 * moment as it was typed, never as an instant turned back into Yerevan time — that lost the
 * seconds of a tag's moment and printed the year after 9999 as `+010000-01 01T00` (adversarial Б),
 * and a day taken in whole read as though the next one were in (self-review С-5).
 */
interface ParsedWindow {
  readonly window: GatesWindow
  /** `2026-10-05 through 2026-10-31, days in Yerevan`, `2026-10-05T14:20:31+04:00 until now`. */
  readonly edges: string
}

function parseWindow(argv: readonly string[], now: () => Date): ParsedWindow | null {
  const given = new Map<string, string>()
  for (let at = 0; at < argv.length; at += 2) {
    const flag = argv[at] ?? ''
    const value = argv[at + 1]
    if (!['--from', '--to'].includes(flag) || given.has(flag) || value === undefined) return null
    given.set(flag, value)
  }

  const fromValue = given.get('--from')
  const toValue = given.get('--to')
  if (fromValue === undefined) return null
  const from = parseWhen(fromValue, 'start')
  const to = toValue === undefined ? now() : parseWhen(toValue, 'end')
  if (from === null || to === null || !(from.getTime() < to.getTime())) return null
  const until =
    toValue === undefined ? 'until now' : `${DAY.test(toValue) ? 'through' : 'until'} ${toValue}`
  const days = DAY.test(fromValue) || (toValue !== undefined && DAY.test(toValue))
  return { window: { from, to }, edges: `${fromValue} ${until}${days ? ', days in Yerevan' : ''}` }
}

/**
 * A day is Yerevan's (Р-2): `--from` starts at its midnight, `--to` takes the whole day in and
 * ends at the next one — «from the 5th to the 31st» is read the way it is said.
 */
function parseWhen(value: string, edge: 'start' | 'end'): Date | null {
  let instant: number
  if (DAY.test(value)) {
    // `Date.parse('2026-02-31')` is the 3rd of March, so a day has to come back as itself.
    if (new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) return null
    instant = yerevanMidnight(value).getTime() + (edge === 'end' ? DAY_MS : 0)
  } else {
    const parts = MOMENT.exec(value)
    if (parts === null) return null
    instant = Date.parse(value)
    if (Number.isNaN(instant)) return null
    // And so does a moment, in its own offset: `24:00` and the 31st of February are refused.
    const sign = parts[5] === '-' ? -1 : 1
    const offset =
      parts[4] === 'Z' ? 0 : sign * (Number(parts[6]) * HOUR_MS + Number(parts[7]) * MINUTE_MS)
    if (new Date(instant + offset).toISOString().slice(0, 16) !== parts[1]) return null
  }
  return instant >= FIRST_READABLE && instant < PAST_READABLE ? new Date(instant) : null
}

function formatReport(parsed: ParsedWindow, report: GatesReport): string[] {
  const { ratings, products, venues } = report
  const days = String(GATE_RATINGS_WINDOW_HOURS / 24)
  return [
    `Molvia gates · appeared from ${parsed.edges}`,
    `read at ${inYerevan(report.readAt)}, Yerevan time`,
    '',
    heading('0.2', 'do strangers fill the base?', GATE_RATINGS_STOP_PERCENT),
    row(
      `gave ${String(GATE_RATINGS)} ratings within ${days} days`,
      share(ratings.reached, ratings.cohortSize),
    ),
    row(`still inside their ${days} days`, [String(ratings.pending), 'not counted yet']),
    // Never consented to the statistics (MOL-236): edition 2 asks it, and nothing is counted without.
    row('no consent to the statistics', [String(ratings.withoutConsent), 'in neither half']),
    // Objected to being counted (MOL-96, В-2): named, or the share fell with each objection.
    row('opted out of the statistics', [String(ratings.optedOut), 'in neither half']),
    '',
    heading('0.3', "do they come back for other people's data?", GATE_RETURN_STOP_PERCENT),
    row('products   back in week 4', share(products.returned, products.cohortSize)),
    row('venues     back in week 4', share(venues.returned, venues.cohortSize)),
    // The cohort is people, not what they looked at: the two halves wait and lack access alike.
    row('week 4 not over yet', [String(products.pending), 'not counted yet']),
    row('no access in week 4', [String(products.withoutAccess), 'not in the cohort']),
    row('no consent to the statistics', [String(products.withoutConsent), 'in neither half']),
    row('opted out of the statistics', [String(products.optedOut), 'in neither half']),
    '',
    row('erased', [String(report.erased.count), erasedWeeks(report.erased)]),
    '',
    ...loginLines(report.logins),
    '',
    ...reminderLines(report.reminders),
    '',
    ...receiptLines(report.receipts),
    '',
    ...taxReceiptLines(report.taxReceipts),
  ]
}

/**
 * The receipt scanner (MOL-222, owner's decision 04.10.2026): the share of lines people put right
 * before recording — above a third after four weeks, the question of the reader comes back. Beside it
 * the readings that never reached a record, since the share counts recorded receipts only and would
 * read better than the scanner is. A line put right is counted once; its kinds may add up past it.
 */
function receiptLines(receipts: ReceiptsInWindow): string[] {
  const { firstDay, lastDay } = receipts
  const span = firstDay === lastDay ? `the day ${firstDay}` : `days ${firstDay} … ${lastDay}`
  const readings =
    receipts.read + receipts.readPartly + receipts.reshoot + receipts.noItems + receipts.unreadable
  return [
    `0.2r ${'does the scanner spare typing?'.padEnd(47)}stop above ${String(RECEIPT_EDITS_STOP_PERCENT)} % after 4 weeks`,
    row('receipts read', [String(readings), `${span} in Yerevan`]),
    row('  with their lines', [String(receipts.read), '']),
    row('  in part', [String(receipts.readPartly), 'to the review all the same']),
    row('  not one line found', [String(receipts.reshoot), '«переснимите»']),
    row('  no items on it', [String(receipts.noItems), 'a sum to record (MOL-227)']),
    row('  unreadable', [String(receipts.unreadable), '']),
    row('receipts recorded', [String(receipts.recorded), '']),
    row('lines put right', share(receipts.linesEdited, receipts.lines, 'up')),
    row('  left out', [String(receipts.linesSkipped), '']),
    row('  another item', [String(receipts.linesItem), '']),
    row('  quantity or sum', [String(receipts.linesFigures), '']),
    // the receipt's own edit, not its lines': a total put right moves no line (MOL-222, review 2)
    row('total put right', [String(receipts.totalsCorrected), 'receipts']),
    row('sent to recorded, within 5 min', [String(receipts.within5m), 'receipts']),
    row('  15 min', [String(receipts.within15m), '']),
    row('  1 hour', [String(receipts.within1h), '']),
    row('  1 day', [String(receipts.within1d), '']),
    row('  later', [String(receipts.later), '']),
  ]
}

/**
 * The receipts from the Serbian tax office (MOL-234), apart from the reader's block: their lines are
 * the tax office's, and counted there they would thin its stop line. No stop of their own. How the
 * links came is the risk of MOL-233 — a link pasted after the camera missed is a QR that did not read;
 * one pasted with no shot is the person's habit. The lines put right are what the matcher missed.
 */
function taxReceiptLines(tax: TaxReceiptsInWindow): string[] {
  const { firstDay, lastDay } = tax
  const span = firstDay === lastDay ? `the day ${firstDay}` : `days ${firstDay} … ${lastDay}`
  const sent = tax.sentQr + tax.sentQrMissed + tax.sentPaste + tax.sentPasteMissed + tax.sentUnnamed
  const read = tax.read + tax.missing + tax.invalid + tax.unreadable
  return [
    `0.2r ${'· the Serbian tax office'.padEnd(47)}no stop: the lines are the tax office's`,
    row('links sent', [String(sent), `${span} in Yerevan`]),
    row('  QR read by the app', [String(tax.sentQr), '']),
    row('  QR read after a miss', [String(tax.sentQrMissed), '']),
    row('  pasted after the camera missed', [String(tax.sentPasteMissed), 'the QR did not read']),
    row('  pasted with no shot', [String(tax.sentPaste), '']),
    row('  not named', [String(tax.sentUnnamed), 'a phone of an earlier build']),
    row('receipts asked', [String(read), '']),
    row('  with their lines', [String(tax.read), '']),
    row('  not shown in 48 hours', [String(tax.missing), '']),
    row('  refused by the tax office', [String(tax.invalid), '']),
    row('  unreadable', [String(tax.unreadable), '']),
    row('specification answered', share(tax.specsOk, tax.specsOk + tax.specsFailed)),
    row('  lines with a code', [String(tax.linesCoded), '']),
    row('receipts recorded', [String(tax.recorded), '']),
    row('lines put right', share(tax.linesEdited, tax.lines, 'up')),
    row('  left out', [String(tax.linesSkipped), '']),
    row('  another item', [String(tax.linesItem), 'the matcher missed']),
    row('  quantity or sum', [String(tax.linesFigures), '']),
    row('total put right', [String(tax.totalsCorrected), 'receipts']),
    row('codes bound to items', [String(tax.codesWritten), '']),
    row('sent to recorded, within 5 min', [String(tax.within5m), 'receipts']),
    row('  15 min', [String(tax.within15m), '']),
    row('  1 hour', [String(tax.within1h), '']),
    row('  1 day', [String(tax.within1d), '']),
    row('  later', [String(tax.later), '']),
  ]
}

/**
 * The rating reminder's lever (MOL-101, В-4) under the login: if gate 0.2 says stop, whether the
 * reminders did not go out, went out and were not pressed, or were pressed and there was little to
 * ask about — and whether it annoys: how many turned it off, and how (MOL-103, В-4). No line of its
 * own to cross, so no verdict — only the counts and the share with its n.
 * A press is counted on its own day, so the share of a window is of the items asked in it and the
 * presses made in it; at its edges the two need not be the same days.
 */
function reminderLines(reminders: RemindersInWindow): string[] {
  const { firstDay, lastDay } = reminders
  const span = firstDay === lastDay ? `the day ${firstDay}` : `days ${firstDay} … ${lastDay}`
  return [
    `remind ${'do reminders bring ratings?'.padEnd(45)}read beside 0.2`,
    row('first step, the next day', [String(reminders.firstSteps), `${span} in Yerevan`]),
    row('second step, 3 days on', [String(reminders.secondSteps), '']),
    row('third step, then the pause', [String(reminders.thirdSteps), 'silent after it: 6 months']),
    row('items asked about', [String(reminders.items), '']),
    row(
      'rated by a press in the bot',
      // More presses than items: a message forwarded and pressed by somebody else too, or items
      // asked before the window and pressed inside. Printed as it is, with both reasons, never as
      // a share above a hundred (adversarial Б, Ж).
      reminders.rated > reminders.items
        ? [
            `${String(reminders.rated)} of ${String(reminders.items)}`,
            'forwarded, or asked before the window',
          ]
        : share(reminders.rated, reminders.items),
    ),
    // People, on the day they turned it off; one who turned it on and off again counts twice.
    row('turned off under a reminder', [String(reminders.offButton), 'people']),
    row('turned off in the settings', [String(reminders.offSettings), 'people']),
    row('blocked the bot', [String(reminders.offBlocked), 'people, reminders off by it']),
  ]
}

/**
 * The login's funnel (MOL-68) under the gates: how many who began a login came in. «Began» is the
 * starts less those a device said were its own again — «Начать заново», or a return after the link
 * ran out — so a person who needed two tries is one who began and one who got in.
 *
 * Where they were lost is counted in requests, not people, so those lines need not add up to
 * «lost». And «lost» is not held at zero: a repeat inside the window of a start before it can make
 * more come in than began, and printed as it is, that edge stays in sight.
 */
function loginLines({ firstDay, lastDay, days }: LoginsInWindow): string[] {
  const total = (pick: (day: LoginsInWindow['days'][number]) => number): number =>
    days.reduce((sum, day) => sum + pick(day), 0)
  const again = total((day) => day.again)
  const began = total((day) => day.started) - again
  const gotIn = total((day) => day.collected)
  // Begun and not over yet: a login lives five minutes, and a window reaching until now holds
  // some that are still on their way to an outcome — not lost, not in (review А2).
  const open =
    total((day) => day.started) -
    gotIn -
    total((day) => day.declined + day.expiredUnconfirmed + day.expiredConfirmed)
  // Only what is still on its way comes off «lost»: below zero, «under way» is outcomes whose start
  // was never counted, and subtracted it would add them to the losses (round 2, Р5).
  const lost = began - gotIn - Math.max(open, 0)
  const span = firstDay === lastDay ? `the day ${firstDay}` : `days ${firstDay} … ${lastDay}`
  const lines = [
    `login ${'how many who began got in?'.padEnd(46)}second way in above ${String(LOGIN_SECOND_WAY_PERCENT)} %`,
    row('began', [String(began), `${span} in Yerevan`]),
    row('got in', share(gotIn, began)),
    // Below zero only with outcomes whose start was never counted: a request an older image made
    // after a rollback, which puts the image back and not the schema (review Г).
    row(
      'still under way',
      open < 0
        ? [String(open), 'outcomes of starts never counted']
        : // A request erased mid-login (MOL-58) ends in no outcome at all and stays here for
          // good; named on the line so a window long closed does not read «too early» (round 2, Р4).
          [String(open), 'not counted yet, or erased mid-login'],
    ),
    row(
      'lost',
      lost < 0
        ? [`${String(lost)} of ${String(began)}`, 'repeats of starts before the window']
        : share(lost, began, 'up'),
    ),
    row('  never confirmed in the bot', [String(total((day) => day.expiredUnconfirmed)), '']),
    row('  confirmed, did not come back', [String(total((day) => day.expiredConfirmed)), '']),
    row('  «not me» in the bot', [String(total((day) => day.declined)), '']),
    row('  refused by the quota', [String(total((day) => day.refused)), 'starts, not in «began»']),
    row('began again on the same device', [String(again), 'not counted as beginning']),
  ]
  if (days.length === 0) return lines
  return [
    ...lines,
    '',
    `     ${['day'.padEnd(10), ...DAY_COLUMNS.map((name) => name.padStart(10))].join('')}`,
    ...days.map(
      (day) =>
        `     ${[
          day.day.padEnd(10),
          ...[
            day.started - day.again,
            day.again,
            day.confirmed,
            day.declined,
            day.collected,
            day.expiredUnconfirmed + day.expiredConfirmed,
            day.refused,
          ].map((count) => String(count).padStart(10)),
        ].join('')}`,
    ),
  ]
}

const DAY_COLUMNS = ['began', 'again', 'confirmed', 'declined', 'got in', 'expired', 'refused']

/** Whole weeks, and named, so the approximation of `erasures` is in sight (Р-11). */
function erasedWeeks({ firstWeek, lastWeek }: GatesReport['erased']): string {
  const weeks =
    firstWeek === lastWeek ? `the week of ${firstWeek}` : `the weeks of ${firstWeek} … ${lastWeek}`
  return `appeared ${weeks}, in neither half`
}

function heading(release: string, question: string, stopPercent: number): string {
  return `${release.padEnd(5)}${question.padEnd(47)}stop below ${String(stopPercent)} %`
}

function row(label: string, [count, note]: readonly [string, string]): string {
  return `     ${label.padEnd(36)}${count.padEnd(11)}${note}`.trimEnd()
}

/**
 * `k of n` and the share, in tenths, rounded **towards the line's own side** (Р-5): down beside a
 * line that stops below — 19.96 % is «19.9 %», never a «20.0 %» standing over «stop below 20» —
 * and up beside the login's line, which fires above (MOL-68, review Б): 25.09 % is «25.1 %», never a
 * «25.0 %» sitting on «above 25». Either way a share past its line is never printed on it. An empty
 * cohort has no share at all.
 */
function share(part: number, whole: number, round: 'down' | 'up' = 'down'): [string, string] {
  if (whole === 0) return [`${String(part)} of 0`, '—']
  const tenths = (round === 'up' ? Math.ceil : Math.floor)((part * 1000) / whole)
  const percent = `${String(Math.floor(tenths / 10))}.${String(tenths % 10)} %`
  return [`${String(part)} of ${String(whole)}`, percent.padStart(7)]
}

function inYerevan(instant: Date): string {
  const day = yerevanDate(instant)
  const minutes = Math.floor((instant.getTime() - yerevanMidnight(day).getTime()) / MINUTE_MS)
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
  return `${day} ${hh}:${String(minutes % 60).padStart(2, '0')}`
}
