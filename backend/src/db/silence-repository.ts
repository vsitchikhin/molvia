import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import {
  SILENCE_LAST_WARNING_DAYS,
  SILENCE_STEP_GAP_HOURS,
  SILENCE_WARN_DAYS,
  SILENCE_YEARS,
} from '@molvia/model'
import type { SilenceStep, TelegramUserId } from '@molvia/model'
import type { Conn } from './index'
import { rowLimit } from './rows'

/**
 * Two years of silence (MOL-239): who is warned and who is erased, in SQL — the question is asked of
 * every account, every minute, so it is a query and not a loop. The rule is one set of fragments, read
 * by the claim of warnings, the day's run and erasure under its lock alike.
 *
 * The moment is the caller's, never `now()`: the claim's countries are the domain's by the same moment.
 */
const [FIRST_STEP, LAST_STEP] = SILENCE_WARN_DAYS
/** The steps as literals of the statement — constants of the code, typed as the column is. */
const FIRST = sql.raw(`${String(FIRST_STEP)}::smallint`)
const LAST = sql.raw(`${String(LAST_STEP)}::smallint`)

const at = (now: Date): SQL => sql`${now.toISOString()}::timestamptz`

/** When the account goes if nothing changes: two calendar years after its last visit (MOL-238). */
const deadline = (a: string): SQL =>
  sql`(${sql.raw(a)}.last_seen_at + make_interval(years => ${SILENCE_YEARS}))`

/** Its warning is of this silence: given after the last visit, never one a login has since ended. */
const warnedNow = (a: string): SQL =>
  sql`coalesce(${sql.raw(a)}.silence_warned_at > ${sql.raw(a)}.last_seen_at, false)`

/**
 * Close enough to be asked about at all — said of `last_seen_at` alone, so the index can answer it; the
 * exact rule follows. Calendar years are not a fixed length, and a day of margin covers the 29th of
 * February either way.
 */
const silentSince = (a: string, now: Date, days: number): SQL =>
  sql`${sql.raw(a)}.last_seen_at <= ${at(now)} - make_interval(years => ${SILENCE_YEARS}) + make_interval(days => ${days + 1})`

/**
 * The warning due now, or none: the first when thirty days are left, the last when seven are — and a
 * bot late past both sends the last alone (Р-4). The last comes a day after the first at the soonest,
 * so a first sent late is never followed by the other at once.
 */
const dueStep = (a: string, now: Date): SQL => {
  const t = deadline(a)
  const warnedAt = sql`${sql.raw(a)}.silence_warned_at`
  return sql`case
    when ${warnedNow(a)} and ${sql.raw(a)}.silence_warning = ${LAST} then null
    when ${warnedNow(a)} then case
      when ${at(now)} >= greatest(${t} - make_interval(days => ${LAST_STEP}),
        ${warnedAt} + make_interval(hours => ${SILENCE_STEP_GAP_HOURS})) then ${LAST} end
    when ${at(now)} >= ${t} - make_interval(days => ${LAST_STEP}) then ${LAST}
    when ${at(now)} >= ${t} - make_interval(days => ${FIRST_STEP}) then ${FIRST}
  end`
}

/**
 * Whether the account is to be erased now (Р-3): its two years are over, and either the bot is blocked
 * — there is nothing to warn by, the page's one exception — or the last warning was handed a week ago
 * at least. An account the bot can reach is never erased unwarned: a bot down for days moves the day.
 */
export function silentErasable(a: string, now: Date): SQL {
  return sql`(${at(now)} >= ${deadline(a)} and (
    ${sql.raw(a)}.bot_blocked_at is not null
    or (${warnedNow(a)} and ${sql.raw(a)}.silence_warning = ${LAST}
      and ${at(now)} >= ${sql.raw(a)}.silence_warned_at + make_interval(days => ${SILENCE_LAST_WARNING_DAYS}))))`
}

/** A warning handed out: whose chat, which, and when the account goes — its zone is the caller's. */
export interface SilenceWarned {
  readonly telegramUserId: TelegramUserId
  readonly country: string
  readonly step: SilenceStep
  readonly eraseAt: Date
}

/** An account whose silence is over: erased by its Telegram id, as every erasure is. */
export interface SilenceDue {
  readonly telegramUserId: TelegramUserId
  readonly blocked: boolean
}

export interface SilenceRepository {
  /**
   * The warnings due now for people of `countries` — the ones whose day it is — the bot not blocked,
   * marked as handed in the same statement: two claims at once take different rows (`skip locked`), and
   * a bot that dies before sending loses the message rather than sends it twice (MOL-101 Р-2). The
   * day a warning names is the account's erasure as it stands: for the last one, a week after it at
   * the soonest (Р-3).
   */
  claimWarnings(
    countries: readonly string[],
    now: Date,
    limit: number,
  ): Promise<readonly SilenceWarned[]>
  /** The accounts to erase now, the longest silent first. */
  due(now: Date, limit: number): Promise<readonly SilenceDue[]>
}

export function createSilenceRepository(db: Conn): SilenceRepository {
  return {
    async claimWarnings(countries, now, limit) {
      if (countries.length === 0) return []
      const rows = await db.execute<{
        telegram_user_id: number
        country: string
        step: number
        erase_at: string
      }>(sql`
        update actors a set silence_warning = picked.step, silence_warned_at = ${at(now)}
        from (
          select d.id, d.step from (
            select c.id, c.last_seen_at, ${dueStep('c', now)} as step
            from actors c
            where ${silentSince('c', now, FIRST_STEP)} and c.bot_blocked_at is null
              and c.country in (${sql.join(
                countries.map((country) => sql`${country}`),
                sql`, `,
              )})
            for update of c skip locked
          ) d
          where d.step is not null
          order by d.last_seen_at, d.id
          limit ${rowLimit(limit)}
        ) picked
        where a.id = picked.id
        returning a.telegram_user_id::float8 as telegram_user_id, trim(a.country) as country, picked.step,
          (case when picked.step = ${LAST}
            then greatest(${deadline('a')}, ${at(now)} + make_interval(days => ${SILENCE_LAST_WARNING_DAYS}))
            else ${deadline('a')} end)::text as erase_at`)
      return rows.map((row) => ({
        telegramUserId: row.telegram_user_id,
        country: row.country,
        step: row.step === LAST_STEP ? LAST_STEP : FIRST_STEP,
        eraseAt: new Date(row.erase_at),
      }))
    },

    async due(now, limit) {
      const rows = await db.execute<{ telegram_user_id: number; blocked: boolean }>(sql`
        select a.telegram_user_id::float8 as telegram_user_id, a.bot_blocked_at is not null as blocked
        from actors a
        where ${silentSince('a', now, 0)} and ${silentErasable('a', now)}
        order by a.last_seen_at, a.id
        limit ${rowLimit(limit)}`)
      return rows.map((row) => ({
        telegramUserId: row.telegram_user_id,
        blocked: row.blocked,
      }))
    },
  }
}
