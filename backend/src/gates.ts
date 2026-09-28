import {
  GATE_RATINGS,
  GATE_RATINGS_STOP_PERCENT,
  GATE_RATINGS_WINDOW_HOURS,
  GATE_RETURN_STOP_PERCENT,
  yerevanDate,
  yerevanMidnight,
} from '@molvia/model'
import type { GatesReader, GatesReport, GatesWindow } from '@/db/gates-reader'
import { describeFailure } from '@/db/failure'

export const GATES_USAGE =
  'usage: gates --from <when> [--to <when>]   when: a day YYYY-MM-DD in Yerevan (--to takes the day in), or an ISO 8601 moment with an offset'

/** 0 — read, 1 — the database failed, 2 — the command was wrong. */
export type GatesExit = 0 | 1 | 2

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const YEREVAN_OFFSET_MS = 4 * HOUR_MS
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
  const window = parseWindow(argv, now)
  if (window === null) {
    write(GATES_USAGE)
    return 2
  }

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

  for (const line of formatReport(window, report)) write(line)
  return 0
}

function parseWindow(argv: readonly string[], now: () => Date): GatesWindow | null {
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
  return { from, to }
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
      parts[4] === 'Z' ? 0 : sign * (Number(parts[6]) * HOUR_MS + Number(parts[7]) * 60 * 1000)
    if (new Date(instant + offset).toISOString().slice(0, 16) !== parts[1]) return null
  }
  return instant >= FIRST_READABLE && instant < PAST_READABLE ? new Date(instant) : null
}

function formatReport({ from, to }: GatesWindow, report: GatesReport): string[] {
  const { ratings, products, venues } = report
  const days = String(GATE_RATINGS_WINDOW_HOURS / 24)
  return [
    `Molvia gates · appeared from ${inYerevan(from)} until ${inYerevan(to)}, Yerevan time`,
    `read at ${inYerevan(report.readAt)}`,
    '',
    heading('0.2', 'do strangers fill the base?', GATE_RATINGS_STOP_PERCENT),
    row(
      `gave ${String(GATE_RATINGS)} ratings within ${days} days`,
      share(ratings.reached, ratings.cohortSize),
    ),
    row(`still inside their ${days} days`, [String(ratings.pending), 'not counted yet']),
    '',
    heading('0.3', "do they come back for other people's data?", GATE_RETURN_STOP_PERCENT),
    row('products   back in week 4', share(products.returned, products.cohortSize)),
    row('venues     back in week 4', share(venues.returned, venues.cohortSize)),
    // The cohort is people, not what they looked at: the two halves wait and lack access alike.
    row('week 4 not over yet', [String(products.pending), 'not counted yet']),
    row('no access in week 4', [String(products.withoutAccess), 'not in the cohort']),
    '',
    row('erased', [String(report.erased.count), erasedWeeks(report.erased)]),
  ]
}

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
 * `k of n` and the share, in tenths, rounded down (Р-5): 19.96 % is «19.9 %», never a «20.0 %»
 * standing over a line that stops below 20. An empty cohort has no share at all.
 */
function share(part: number, whole: number): [string, string] {
  if (whole === 0) return [`${String(part)} of 0`, '—']
  const tenths = Math.floor((part * 1000) / whole)
  const percent = `${String(Math.floor(tenths / 10))}.${String(tenths % 10)} %`
  return [`${String(part)} of ${String(whole)}`, percent.padStart(7)]
}

function inYerevan(instant: Date): string {
  const shifted = new Date(instant.getTime() + YEREVAN_OFFSET_MS).toISOString()
  return `${yerevanDate(instant)} ${shifted.slice(11, 16)}`
}
