import { and, eq, gte, or, sql } from 'drizzle-orm'
import { exchangeRateSchema, monthOf } from '@molvia/model'
import type { Currency, ExchangeRate, TripLine } from '@molvia/model'
import type { Conn } from './index'
import { actors, moneyMonthRates } from './schema'
import { tripMoneyRows } from './trip-money'

/**
 * What «Деньги» reads beside the spendings (MOL-73): the finished trips of a month, as lines of the
 * journal, and the rate a closed month was frozen at.
 */
export interface MoneyRepository {
  /**
   * The owner's trips finished on a day from `from` to `to` — the phone's day of the tap of
   * «Завершить» (`finished_on`, MOL-121), and for a trip from an old queue Yerevan's day of the
   * device's moment of finishing, or the server's (MOL-25) — one line per currency of the trip's
   * money (`tripMoneyRows`): the receipt's sum when there is one (MOL-78), else the purchases of each
   * currency. Read each time: nothing is copied, so amending a purchase or the receipt moves the month.
   */
  tripLines(actorId: string, from: string, to: string): Promise<readonly TripLine[]>

  /** The rate `month` was frozen at, of this pair on either side, or null when it is not frozen. */
  frozenRate(
    actorId: string,
    month: string,
    base: Currency,
    quote: Currency,
  ): Promise<ExchangeRate | null>

  /** Freezes `month` at `rate` — once: a rate already there stays, and is what comes back. */
  freeze(actorId: string, month: string, rate: ExchangeRate): Promise<ExchangeRate>

  /**
   * Lets go of the months frozen from `day` on (owner's decision В-6): an exchange or an income of
   * that day was written, amended, removed or brought back, and every month whose last day is not
   * before it was counted without that. The running month is never frozen, so today's exchange
   * lets go of nothing — which is what «a new exchange today does not move August» means. With no
   * day, every month: the rule they were counted by changed (В-8).
   */
  thaw(actorId: string, day?: string): Promise<void>

  /** From which day of a month a salary counts in the next one (MOL-134, В-3); null — off. */
  salaryShift(actorId: string): Promise<number | null>

  /** Sets it, whole each time: a repeat after a lost answer is the same write. */
  setSalaryShift(actorId: string, day: number | null): Promise<number | null>
}

interface TripLineRow extends Record<string, unknown> {
  trip_id: string
  place_name: string
  items: string | number
  finished_at: Date | string
  finished_on: string
  currency: Currency
  amount_minor: string | bigint
}

export function createMoneyRepository(db: Conn): MoneyRepository {
  async function frozenRate(actorId: string, month: string, base: Currency, quote: Currency) {
    const [row] = await db
      .select()
      .from(moneyMonthRates)
      .where(
        and(
          eq(moneyMonthRates.actorId, actorId),
          eq(moneyMonthRates.month, month),
          or(
            and(eq(moneyMonthRates.base, base), eq(moneyMonthRates.quote, quote)),
            and(eq(moneyMonthRates.base, quote), eq(moneyMonthRates.quote, base)),
          ),
        ),
      )
    return row
      ? exchangeRateSchema.parse({
          base: row.base,
          quote: row.quote,
          scaled: row.scaled,
          source: row.source,
          asOf: row.asOf,
        })
      : null
  }

  return {
    async tripLines(actorId, from, to) {
      const rows = await db.execute<TripLineRow>(sql`
        with finished as (
          select t.id, p.name as place_name,
                 coalesce(t.finished_on_device_at, t.finished_at) as finished_at,
                 -- The phone's day of the tap (MOL-121), beside the spendings the same phone dated;
                 -- a trip from an old queue has none, and the server's day of the moment stands.
                 coalesce(t.finished_on,
                          (coalesce(t.finished_on_device_at, t.finished_at)
                             at time zone 'Asia/Yerevan')::date) as finished_day
            from trips t
            join places p on p.id = t.place_id
           where t.actor_id = ${actorId}
             and t.finished_at is not null
             and t.deleted_at is null
        ),
        money as (${tripMoneyRows(sql`t.actor_id = ${actorId} and t.finished_at is not null and t.deleted_at is null`)})
        select f.id as trip_id, f.place_name, f.finished_at,
               to_char(f.finished_day, 'YYYY-MM-DD') as finished_on,
               m.currency, m.minor as amount_minor, m.items
          from finished f
          join money m on m.trip_id = f.id
         where f.finished_day between ${from}::date and ${to}::date
      `)
      return rows.map((row) => ({
        tripId: row.trip_id,
        placeName: row.place_name,
        items: Number(row.items),
        finishedOn: row.finished_on,
        finishedAt: new Date(row.finished_at),
        amount: { minor: BigInt(row.amount_minor), currency: row.currency },
      }))
    },

    frozenRate,

    async freeze(actorId, month, rate) {
      await db
        .insert(moneyMonthRates)
        .values({
          actorId,
          month,
          base: rate.base,
          quote: rate.quote,
          scaled: rate.scaled,
          source: rate.source,
          asOf: rate.asOf,
        })
        .onConflictDoNothing()
      return (await frozenRate(actorId, month, rate.base, rate.quote)) ?? rate
    },

    async thaw(actorId, day) {
      await db
        .delete(moneyMonthRates)
        .where(
          and(
            eq(moneyMonthRates.actorId, actorId),
            day === undefined ? undefined : gte(moneyMonthRates.month, monthOf(day)),
          ),
        )
    },

    async salaryShift(actorId) {
      const [row] = await db
        .select({ day: actors.salaryShiftDay })
        .from(actors)
        .where(eq(actors.id, actorId))
      return row?.day ?? null
    },

    async setSalaryShift(actorId, day) {
      const [row] = await db
        .update(actors)
        .set({ salaryShiftDay: day })
        .where(eq(actors.id, actorId))
        .returning({ day: actors.salaryShiftDay })
      return row?.day ?? null
    },
  }
}
