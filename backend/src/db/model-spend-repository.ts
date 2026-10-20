import { sql } from 'drizzle-orm'
import { modelSpendStep } from '@molvia/model'
import type { ModelSpendNotice, ModelSpendStep } from '@molvia/model'
import type { Conn, Db } from './index'
import { modelSpend, ownerNotices } from './schema'

/** A month's spending as the table holds it. */
export interface MonthSpend {
  readonly spentMicroUsd: number
  readonly calls: number
  readonly noticed: number
}

/**
 * The month's spending on the model that reads receipts (MOL-272): the cap is held here, in one statement
 * a call, and the owner's notices are queued in the same transaction as the step they tell of. `owner` says
 * whether anybody is there to tell (`OWNER_TELEGRAM_ID`): without it nothing is queued, as for failures.
 */
export interface ModelSpendRepository {
  /**
   * Counts a call's worst price into its month if the month stays within the cap, and says so; a call that
   * would not fit is refused, and the owner hears of the stop once a month.
   */
  reserve(month: string, worstMicroUsd: number, capMicroUsd: number, at: Date): Promise<boolean>
  /** Puts what the call cost in place of its worst, and tells the owner of a share of the cap passed. */
  settle(
    month: string,
    worstMicroUsd: number,
    costMicroUsd: number,
    capMicroUsd: number,
    at: Date,
  ): Promise<void>
  month(month: string): Promise<MonthSpend | null>
}

async function tell(
  tx: Conn,
  owner: boolean,
  notice: Omit<ModelSpendNotice, 'kind'>,
  at: Date,
): Promise<void> {
  if (!owner) return
  const payload: ModelSpendNotice = { kind: 'model_spend', ...notice }
  await tx.insert(ownerNotices).values({ kind: payload.kind, payload, createdAt: at })
}

export function createModelSpendRepository(db: Db, owner: boolean): ModelSpendRepository {
  return {
    async reserve(month, worstMicroUsd, capMicroUsd, at) {
      return db.transaction(async (tx) => {
        // one statement takes the month's row and holds the cap: no second call fits between a read and a
        // write, whatever runs beside it
        const counted = await tx.execute<{ spent: string }>(sql`
          insert into ${modelSpend} (month, spent_micro_usd, calls)
          select ${month}::date, ${worstMicroUsd}::bigint, 1 where ${worstMicroUsd}::bigint <= ${capMicroUsd}::bigint
          on conflict (month) do update
            set spent_micro_usd = ${modelSpend.spentMicroUsd} + excluded.spent_micro_usd,
                calls = ${modelSpend.calls} + 1
            where ${modelSpend.spentMicroUsd} + excluded.spent_micro_usd <= ${capMicroUsd}::bigint
          returning spent_micro_usd as spent`)
        if (counted.length > 0) return true
        const stopped = await tx.execute<{ spent: string }>(sql`
          insert into ${modelSpend} (month, noticed) values (${month}::date, 100)
          on conflict (month) do update set noticed = 100 where ${modelSpend.noticed} < 100
          returning spent_micro_usd as spent`)
        const [row] = stopped
        if (row !== undefined) {
          await tell(
            tx,
            owner,
            { month, step: 100, spentMicroUsd: Number(row.spent), capMicroUsd },
            at,
          )
        }
        return false
      })
    },

    async settle(month, worstMicroUsd, costMicroUsd, capMicroUsd, at) {
      await db.transaction(async (tx) => {
        const settled = await tx.execute<{ spent: string; noticed: number }>(sql`
          update ${modelSpend}
          set spent_micro_usd = greatest(${modelSpend.spentMicroUsd} - ${worstMicroUsd}::bigint + ${costMicroUsd}::bigint, 0)
          where month = ${month}::date
          returning spent_micro_usd as spent, noticed`)
        const [row] = settled
        if (row === undefined) return
        const spent = Number(row.spent)
        const step: ModelSpendStep | 0 = modelSpendStep(spent, capMicroUsd)
        if (step === 0 || step <= row.noticed) return
        await tx.execute(sql`
          update ${modelSpend} set noticed = ${step}::smallint where month = ${month}::date`)
        await tell(tx, owner, { month, step, spentMicroUsd: spent, capMicroUsd }, at)
      })
    },

    async month(month) {
      const rows = await db
        .select({
          spentMicroUsd: modelSpend.spentMicroUsd,
          calls: modelSpend.calls,
          noticed: modelSpend.noticed,
        })
        .from(modelSpend)
        .where(sql`${modelSpend.month} = ${month}::date`)
      return rows[0] ?? null
    },
  }
}
