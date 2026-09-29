import { sql } from 'drizzle-orm'
import { GATE_RATINGS, GATE_RATINGS_WINDOW_HOURS } from '@molvia/model'
import type { CohortReturn } from './events-repository'
import type { Conn, Db } from './index'
import type { CohortReached } from './verdicts-repository'
import { createEventRepository } from './events-repository'
import { loginDays } from './schema'
import { createVerdictRepository } from './verdicts-repository'
import { yerevanDay, yerevanWeek } from './yerevan-week'

/** People who appeared in `[from, to)` — the one window both gates are read over (MOL-91, Р-1). */
export interface GatesWindow {
  readonly from: Date
  readonly to: Date
}

export interface GatesReport {
  /** The database's `now()`: the moment every «window still open» of this report was judged by. */
  readonly readAt: Date
  readonly ratings: CohortReached
  readonly products: CohortReturn
  readonly venues: CohortReturn
  readonly erased: ErasedInWindow
  readonly logins: LoginsInWindow
}

/**
 * People who erased themselves among those who appeared in the weeks the window touches — whole
 * weeks, Mondays in Yerevan, since that is all `erasures` keeps (MOL-91). In neither half of
 * either gate: erasure took them out of both.
 */
export interface ErasedInWindow {
  readonly count: number
  readonly firstWeek: string
  readonly lastWeek: string
}

/** One row of `login_days` (MOL-68): the logins begun that day, and where each of them ended. */
export interface LoginDay {
  readonly day: string
  readonly started: number
  readonly again: number
  readonly confirmed: number
  readonly declined: number
  readonly collected: number
  readonly expiredUnconfirmed: number
  readonly expiredConfirmed: number
  readonly refused: number
}

/**
 * The login's funnel over the days the window touches, in Yerevan — whole days, since that is all
 * `login_days` keeps. Not people who appeared, as both gates are: the logins begun on those days,
 * which is where the people who never appeared are.
 */
export interface LoginsInWindow {
  readonly firstDay: string
  readonly lastDay: string
  /** The days that counted anything, in order. */
  readonly days: readonly LoginDay[]
}

export interface GatesReader {
  read(window: GatesWindow): Promise<GatesReport>
}

/**
 * Reads both gates for `dist/gates.js` (MOL-91) in one transaction, `repeatable read` and
 * `read only`: one snapshot and one `now()` for every line of the output — a person whose window
 * closed between two statements would otherwise be waiting in one half and counted in the other
 * — and a tool run on production by hand that cannot write even by mistake.
 */
export function createGatesReader(db: Db): GatesReader {
  return {
    async read({ from, to }) {
      return db.transaction(
        async (tx) => {
          const [clock] = await tx.execute<{ ms: number }>(
            sql`select (extract(epoch from now()) * 1000)::float8 as ms`,
          )
          const verdicts = createVerdictRepository(tx)
          const events = createEventRepository(tx)
          return {
            readAt: new Date(clock?.ms ?? Number.NaN),
            ratings: await verdicts.reachedRatings({
              from,
              to,
              ratings: GATE_RATINGS,
              windowHours: GATE_RATINGS_WINDOW_HOURS,
            }),
            products: await events.weekFourReturn('product', from, to),
            venues: await events.weekFourReturn('venue', from, to),
            erased: await erasedIn(tx, from, to),
            logins: await loginsIn(tx, from, to),
          }
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      )
    },
  }
}

async function erasedIn(tx: Conn, from: Date, to: Date): Promise<ErasedInWindow> {
  // The week as `erase` writes it. The last week is the one holding the window's last
  // millisecond, `to` being open.
  const [row] = await tx.execute<{ count: number; first_week: string; last_week: string }>(sql`
    with bounds as (
      select
        ${yerevanWeek(sql`${from.toISOString()}::timestamptz`)} as first_week,
        ${yerevanWeek(sql`${to.toISOString()}::timestamptz - interval '1 millisecond'`)} as last_week
    )
    select
      coalesce(sum(e.erased), 0)::int as count,
      to_char(b.first_week, 'YYYY-MM-DD') as first_week,
      to_char(b.last_week, 'YYYY-MM-DD') as last_week
    from bounds b
    left join erasures e on e.appeared_week between b.first_week and b.last_week
    group by b.first_week, b.last_week
  `)
  return {
    count: row?.count ?? 0,
    firstWeek: row?.first_week ?? '',
    lastWeek: row?.last_week ?? '',
  }
}

async function loginsIn(tx: Conn, from: Date, to: Date): Promise<LoginsInWindow> {
  // As `erasedIn` does with weeks: the last day is the one holding the window's last millisecond.
  const [bounds] = await tx.execute<{ first_day: string; last_day: string }>(sql`
    select
      to_char(${yerevanDay(sql`${from.toISOString()}::timestamptz`)}, 'YYYY-MM-DD') as first_day,
      to_char(${yerevanDay(sql`${to.toISOString()}::timestamptz - interval '1 millisecond'`)}, 'YYYY-MM-DD') as last_day`)
  const firstDay = bounds?.first_day ?? ''
  const lastDay = bounds?.last_day ?? ''
  const rows = await tx
    .select()
    .from(loginDays)
    .where(sql`${loginDays.day} between ${firstDay}::date and ${lastDay}::date`)
    .orderBy(loginDays.day)
  return { firstDay, lastDay, days: rows }
}
