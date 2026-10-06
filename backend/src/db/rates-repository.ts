import { and, asc, eq, gte, inArray, lt, lte, max, sql } from 'drizzle-orm'
import { RATE_BASE, RATE_JUMP_HISTORY } from '@molvia/model'
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

  /** The providers with a row in the cache — whether a source asked every hour has ever written. */
  writtenBy(): Promise<ReadonlySet<RateProvider>>

  /**
   * The history of the central bank (MOL-137, Р-4): only the days the cache does not have yet — a
   * day already there is left as it is, jump mark included. Returns how many were written.
   */
  insertMissing(rates: readonly CachedRate[]): Promise<number>

  /** Every row of a provider dated from `from` to `to`, oldest first — what a history is judged by. */
  between(provider: RateProvider, from: string, to: string): Promise<readonly CachedRate[]>
}

/** Rows per statement: the whole history since 2022 is three thousand of them. */
const WRITE_CHUNK = 2_000

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
            base: RATE_BASE[rate.provider],
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

    async insertMissing(rates) {
      let written = 0
      await db.transaction(async (tx) => {
        for (let start = 0; start < rates.length; start += WRITE_CHUNK) {
          const inserted = await tx
            .insert(officialRates)
            .values(
              rates.slice(start, start + WRITE_CHUNK).map((rate) => ({
                provider: rate.provider,
                currency: rate.currency,
                base: RATE_BASE[rate.provider],
                rateDate: rate.date,
                scaled: rate.scaled,
                jump: rate.jump,
              })),
            )
            .onConflictDoNothing()
            .returning({ date: officialRates.rateDate })
          written += inserted.length
        }
      })
      return written
    },

    async between(provider, from, to) {
      const rows = await db
        .select()
        .from(officialRates)
        .where(
          and(
            eq(officialRates.provider, provider),
            gte(officialRates.rateDate, from),
            lte(officialRates.rateDate, to),
          ),
        )
        .orderBy(asc(officialRates.rateDate), asc(officialRates.currency))
      return rows.map((row) => ({
        provider: row.provider,
        currency: row.currency,
        date: row.rateDate,
        scaled: row.scaled,
        jump: row.jump,
      }))
    },

    async lastFetchedAt() {
      const [row] = await db.select({ at: max(officialRates.fetchedAt) }).from(officialRates)
      return row?.at ?? null
    },

    async writtenBy() {
      const rows = await db.selectDistinct({ provider: officialRates.provider }).from(officialRates)
      return new Set(rows.map((row) => row.provider))
    },
  }
}
