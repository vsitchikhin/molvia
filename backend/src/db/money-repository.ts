import { and, eq, gte, or, sql } from 'drizzle-orm'
import { exchangeRateSchema, monthOf } from '@molvia/model'
import type { Currency, ExchangeRate, TripLine } from '@molvia/model'
import type { Conn } from './index'
import { moneyMonthRates } from './schema'

/**
 * What «Деньги» reads beside the spendings (MOL-73): the finished trips of a month, as lines of the
 * journal, and the rate a closed month was frozen at.
 */
export interface MoneyRepository {
  /**
   * The owner's trips finished on a day from `from` to `to` in Yerevan — the device's moment of
   * finishing, the server's for old rows (MOL-25) — one line per currency their purchases were paid
   * in. Summed from the purchases each time: nothing is copied, so amending one moves the month.
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
                 coalesce(t.finished_on_device_at, t.finished_at) as finished_at
            from trips t
            join places p on p.id = t.place_id
           where t.actor_id = ${actorId}
             and t.finished_at is not null
             and (coalesce(t.finished_on_device_at, t.finished_at) at time zone 'Asia/Yerevan')::date
                 between ${from}::date and ${to}::date
        )
        select f.id as trip_id, f.place_name, f.finished_at,
               to_char(f.finished_at at time zone 'Asia/Yerevan', 'YYYY-MM-DD') as finished_on,
               e.amount_currency as currency, sum(e.amount_minor) as amount_minor,
               count(*) as items
          from finished f
          join expenses e on e.trip_id = f.id and e.amount_minor is not null
         group by f.id, f.place_name, f.finished_at, e.amount_currency
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
  }
}
