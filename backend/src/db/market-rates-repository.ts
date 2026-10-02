import { and, eq, gte, inArray, lte, max, sql } from 'drizzle-orm'
import type { MarketChannel, MarketRate } from '@molvia/model'
import type { Conn } from './index'
import { marketRates } from './schema'

/** Rows per statement: a history of the daily file is seven thousand of them. */
const WRITE_CHUNK = 2_000

export interface MarketRateRepository {
  /**
   * What one file of the central bank said, written whole: one transaction, so a file is in the
   * table entirely or not at all. A day already there is overwritten — the table mirrors its
   * source, and nothing was taken from it that a rewrite could move (MOL-137).
   */
  upsert(rates: readonly MarketRate[]): Promise<void>

  /**
   * Each channel's latest row of each currency and side dated no later than `day` and no earlier
   * than `from` — the week a rate stays fresh. Which one an exchange is set beside is the domain's
   * rule (`marketQuotesOn`), not a query's.
   */
  between(
    currencies: readonly MarketRate['currency'][],
    from: string,
    day: string,
  ): Promise<readonly MarketRate[]>

  /**
   * Every row of one channel for these currencies dated from `from` to `to`, oldest first — the
   * line of «Курс рубля за 12 месяцев» (MOL-161). Which row a week takes is the domain's rule.
   */
  series(
    channel: MarketChannel,
    currencies: readonly MarketRate['currency'][],
    from: string,
    to: string,
  ): Promise<readonly MarketRate[]>

  /** Each channel's latest row of each currency and side, of any age — the block of today. */
  latest(): Promise<readonly MarketRate[]>

  /** The latest day a channel has any row for, or null — how far the exchange offices reached. */
  through(channel: MarketChannel): Promise<string | null>
}

function toRate(row: typeof marketRates.$inferSelect): MarketRate {
  return {
    channel: row.channel,
    currency: row.currency,
    date: row.rateDate,
    side: row.side,
    scaled: row.scaled,
  }
}

export function createMarketRateRepository(db: Conn): MarketRateRepository {
  function newest(where: ReturnType<typeof and>) {
    return db
      .selectDistinctOn([marketRates.channel, marketRates.currency, marketRates.side])
      .from(marketRates)
      .where(where)
      .orderBy(
        marketRates.channel,
        marketRates.currency,
        marketRates.side,
        sql`${marketRates.rateDate} desc`,
      )
  }

  return {
    async upsert(rates) {
      if (rates.length === 0) return
      await db.transaction(async (tx) => {
        for (let start = 0; start < rates.length; start += WRITE_CHUNK) {
          await tx
            .insert(marketRates)
            .values(
              rates.slice(start, start + WRITE_CHUNK).map((rate) => ({
                channel: rate.channel,
                currency: rate.currency,
                rateDate: rate.date,
                side: rate.side,
                scaled: rate.scaled,
              })),
            )
            .onConflictDoUpdate({
              target: [
                marketRates.channel,
                marketRates.currency,
                marketRates.side,
                marketRates.rateDate,
              ],
              set: { scaled: sql`excluded.scaled`, fetchedAt: sql`now()` },
            })
        }
      })
    },

    async between(currencies, from, day) {
      if (currencies.length === 0) return []
      const rows = await newest(
        and(
          inArray(marketRates.currency, [...currencies]),
          gte(marketRates.rateDate, from),
          lte(marketRates.rateDate, day),
        ),
      )
      return rows.map(toRate)
    },

    async series(channel, currencies, from, to) {
      if (currencies.length === 0) return []
      const rows = await db
        .select()
        .from(marketRates)
        .where(
          and(
            eq(marketRates.channel, channel),
            inArray(marketRates.currency, [...currencies]),
            gte(marketRates.rateDate, from),
            lte(marketRates.rateDate, to),
          ),
        )
        .orderBy(marketRates.rateDate)
      return rows.map(toRate)
    },

    async latest() {
      return (await newest(undefined)).map(toRate)
    },

    async through(channel) {
      const [row] = await db
        .select({ day: max(marketRates.rateDate) })
        .from(marketRates)
        .where(eq(marketRates.channel, channel))
      return row?.day ?? null
    },
  }
}
