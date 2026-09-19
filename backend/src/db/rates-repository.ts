import { and, eq, inArray, lt, lte, max, sql } from 'drizzle-orm'
import { RATE_JUMP_HISTORY } from '@molvia/model'
import type { AmdRate, CachedRate, RateProvider } from '@molvia/model'
import type { Conn } from './index'
import { officialRates } from './schema'

/** One earlier rate a new one is measured against: its day matters for whose history counts. */
export interface PastRate {
  readonly date: string
  readonly scaled: bigint
}

export interface RateRepository {
  /**
   * What a provider published, written whole: one statement, so a response is in the cache
   * entirely or not at all. A day already there is overwritten — the cache mirrors its
   * provider, and a trip that took the old number keeps it in its own columns (MOL-39, Р-8).
   */
  upsert(rates: readonly CachedRate[]): Promise<void>

  /**
   * For each provider and each of `currencies`, dated no later than `date`: the latest row, and
   * the latest row that did not jump when they differ — the one a trip offers as «previous»
   * (Р-19). Which provider a trip takes is the domain's rule (`pickOfficialRate`), not a query's.
   */
  latestOnOrBefore(
    currencies: readonly AmdRate['currency'][],
    date: string,
  ): Promise<readonly CachedRate[]>

  /**
   * A provider's latest rates of each currency dated before `date`, newest first, at most
   * `RATE_JUMP_HISTORY` of them — what a new rate is measured against for a jump.
   */
  history(
    provider: RateProvider,
    currencies: readonly AmdRate['currency'][],
    date: string,
  ): Promise<ReadonlyMap<AmdRate['currency'], readonly PastRate[]>>

  /** When any provider's answer was last written — whether the boot refresh can be skipped. */
  lastFetchedAt(): Promise<Date | null>
}

export function createRateRepository(db: Conn): RateRepository {
  async function latest(
    currencies: readonly AmdRate['currency'][],
    date: string,
    steadyOnly: boolean,
  ): Promise<CachedRate[]> {
    const rows = await db
      .selectDistinctOn([officialRates.provider, officialRates.currency])
      .from(officialRates)
      .where(
        and(
          inArray(officialRates.currency, [...currencies]),
          lte(officialRates.rateDate, date),
          steadyOnly ? eq(officialRates.jump, false) : undefined,
        ),
      )
      .orderBy(officialRates.provider, officialRates.currency, sql`${officialRates.rateDate} desc`)
    return rows.map((row) => ({
      provider: row.provider,
      currency: row.currency,
      date: row.rateDate,
      scaled: row.scaled,
      jump: row.jump,
    }))
  }

  return {
    async upsert(rates) {
      if (rates.length === 0) return
      await db
        .insert(officialRates)
        .values(
          rates.map((rate) => ({
            provider: rate.provider,
            currency: rate.currency,
            rateDate: rate.date,
            scaled: rate.scaled,
            jump: rate.jump,
          })),
        )
        .onConflictDoUpdate({
          target: [officialRates.provider, officialRates.currency, officialRates.rateDate],
          set: { scaled: sql`excluded.scaled`, jump: sql`excluded.jump`, fetchedAt: sql`now()` },
        })
    },

    async latestOnOrBefore(currencies, date) {
      if (currencies.length === 0) return []
      const newest = await latest(currencies, date, false)
      if (!newest.some((row) => row.jump)) return newest
      return [...newest, ...(await latest(currencies, date, true))]
    },

    async history(provider, currencies, date) {
      const byCurrency = new Map<AmdRate['currency'], PastRate[]>()
      if (currencies.length === 0) return byCurrency
      const ranked = db
        .select({
          currency: officialRates.currency,
          date: officialRates.rateDate,
          scaled: officialRates.scaled,
          rank: sql<number>`row_number() over (partition by ${officialRates.currency} order by ${officialRates.rateDate} desc)`.as(
            'rank',
          ),
        })
        .from(officialRates)
        .where(
          and(
            eq(officialRates.provider, provider),
            inArray(officialRates.currency, [...currencies]),
            lt(officialRates.rateDate, date),
          ),
        )
        .as('ranked')
      const rows = await db
        .select()
        .from(ranked)
        .where(lte(ranked.rank, RATE_JUMP_HISTORY))
        .orderBy(ranked.currency, ranked.rank)
      for (const row of rows) {
        const past = { date: row.date, scaled: row.scaled }
        byCurrency.set(row.currency, [...(byCurrency.get(row.currency) ?? []), past])
      }
      return byCurrency
    },

    async lastFetchedAt() {
      const [row] = await db.select({ at: max(officialRates.fetchedAt) }).from(officialRates)
      return row?.at ?? null
    },
  }
}
