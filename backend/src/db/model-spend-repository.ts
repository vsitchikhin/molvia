import { eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { modelSpendStep, trialCapMicroUsd } from '@molvia/model'
import type { ModelShareNotice, ModelSpendNotice, ModelSpendStep } from '@molvia/model'
import { PAID_BY_MODEL, readsByModel } from './actors-repository'
import type { Conn, Db } from './index'
import { idOrNull } from './rows'
import { actors, modelSpend, ownerNotices } from './schema'

/** A month's spending as the table holds it. */
export interface MonthSpend {
  readonly spentMicroUsd: number
  readonly calls: number
  readonly noticed: number
}

/** Whose call it is and what holds it (MOL-367): the month's cap and the person's share of it. */
export interface ModelCall {
  readonly actorId: string
  readonly capMicroUsd: number
  readonly shareMicroUsd: number
}

/**
 * A call reserved, or refused by the person's share, by the month's cap — or, on the trial, by the trial's part of the
 * cap (MOL-275, `trialCapMicroUsd`).
 */
export type ModelReserved = 'reserved' | 'share' | 'cap' | 'trial'

/** Where a person stands with the model (MOL-275): the figures of `receiptsAccess` on `/actors/me`. */
export interface ModelAccess {
  /** Until when it is paid; none where nothing is, a moment gone included. */
  readonly until: Date | null
  readonly trialLeft: number
  /** Read of `month` — the person's count, where it is that month's. */
  readonly read: number
}

/**
 * The month's spending on the model that reads receipts (MOL-272): the cap is held here, in one statement
 * a call, and the owner's notices are queued in the same transaction as the step they tell of. `owner` says
 * whether anybody is there to tell (`OWNER_TELEGRAM_ID`): without it nothing is queued, as for failures.
 * **Each person's share is held beside it** (MOL-367): their row's count of the month, the account's lock first.
 */
export interface ModelSpendRepository {
  /**
   * Counts a call's worst price into the person's share and its month if both stay within their bounds, and
   * says which refused it: the share leaves the month untouched, the cap gives the share back. The owner hears
   * of the stop once a month, and of a person's share reached once a person a month. **A person on the trial is held
   * to the trial's part of the cap** (MOL-275, owner's В-3 «а»): refused there, `'trial'`, the share given back and
   * no stop told — the month still takes the paid.
   */
  reserve(month: string, worstMicroUsd: number, call: ModelCall, at: Date): Promise<ModelReserved>
  /**
   * Puts what the call cost in place of its worst — in the person's share while it still counts that month — and
   * tells the owner of a share of the cap passed. A request that never left settles at nought; a cost not known — a
   * time out, a connection lost — is never settled: it may have been paid and is asked again every minute, so the
   * worst stays in both (MOL-367, В-6 «а» on adversarial Б1).
   */
  settle(
    month: string,
    worstMicroUsd: number,
    costMicroUsd: number,
    call: ModelCall,
    at: Date,
  ): Promise<void>
  /**
   * A fault of ours, whether paid not known (MOL-367, owner's В-4 «а»): the worst stays in the month, which holds the
   * money, and goes back to the share, which holds the people apart — it is once a receipt, and the owner hears of it.
   */
  keepInMonth(month: string, worstMicroUsd: number, call: ModelCall): Promise<void>
  month(month: string): Promise<MonthSpend | null>
  /**
   * Whether the model reads for the person now (MOL-408, adversarial А3, Р2-А1; MOL-275): `readsByModel` of the
   * phone's month `receiptsMonth` — edition 5, paid or on the trial, the hundred not read — and a call of
   * `worstMicroUsd` would fit their share of the month and the month's cap, the trial's part of it on the trial — by
   * `reserve`'s own inequality, `fits`, over the same spending. What `/actors/me` offers Georgia's camera by.
   */
  readsFor(
    month: string,
    worstMicroUsd: number,
    call: ModelCall,
    receiptsMonth: string,
  ): Promise<boolean>
  /** Where the person stands with the model in the phone's month `receiptsMonth` (MOL-275); none for nobody. */
  access(actorId: string, receiptsMonth: string): Promise<ModelAccess | null>
}

/** What the person has spent of `month`, as their share counts it: a month gone is nought. */
const spentOf = (month: string) =>
  sql`(case when ${actors.modelMonth} >= ${month}::date then ${actors.modelSpentMicroUsd} else 0 end)`

/** A call of `worst` on top of `spent` within `bound`: what the share and the cap refuse by, and the camera reads. */
const fits = (spent: SQL, worstMicroUsd: number, bound: number) =>
  sql`${spent} + ${worstMicroUsd}::bigint <= ${bound}::bigint`

/** What the month has spent of the cap. */
const monthSpentOf = (month: string) =>
  sql`coalesce((select ${modelSpend.spentMicroUsd} from ${modelSpend} where ${modelSpend.month} = ${month}::date), 0)`

async function tell(
  tx: Conn,
  owner: boolean,
  payload: ModelSpendNotice | ModelShareNotice,
  at: Date,
): Promise<void> {
  if (!owner) return
  await tx.insert(ownerNotices).values({ kind: payload.kind, payload, createdAt: at })
}

/**
 * The person's share of the month taken, in one statement under their row's lock: a new month starts it at nought —
 * and whether their reading is paid (MOL-275, `PAID_BY_MODEL`), read in the same statement.
 * **The month only moves on** (adversarial А4): a call whose month was taken before midnight, reserved after a call of
 * the new one — two processes at a rollout, a clock stepped back — counts in the new month's share, never sets it back
 * to the old one and its spending to nought. `null` where the call would not fit — or the person is gone, erased while
 * their receipt was read.
 */
async function takeShare(
  tx: Conn,
  month: string,
  worstMicroUsd: number,
  { actorId, shareMicroUsd }: ModelCall,
): Promise<boolean | null> {
  const spent = spentOf(month)
  const [taken] = await tx.execute<{ paid: boolean }>(sql`
    update ${actors}
    set model_month = greatest(${actors.modelMonth}, ${month}::date),
        model_spent_micro_usd = ${spent} + ${worstMicroUsd}::bigint
    where ${actors.id} = ${actorId} and ${fits(spent, worstMicroUsd, shareMicroUsd)}
    returning ${PAID_BY_MODEL} as paid`)
  return taken === undefined ? null : taken.paid
}

export function createModelSpendRepository(db: Db, owner: boolean): ModelSpendRepository {
  return {
    async readsFor(month, worstMicroUsd, { actorId, capMicroUsd, shareMicroUsd }, receiptsMonth) {
      if (idOrNull(actorId) === null) return false
      const [row] = await db
        .select({
          reads: sql<boolean>`${readsByModel(sql`${receiptsMonth}::date`)}
            and ${fits(spentOf(month), worstMicroUsd, shareMicroUsd)}
            and ${fits(monthSpentOf(month), worstMicroUsd, capMicroUsd)}
            and (${PAID_BY_MODEL} or ${fits(monthSpentOf(month), worstMicroUsd, trialCapMicroUsd(capMicroUsd))})`,
        })
        .from(actors)
        .where(eq(actors.id, actorId))
      return row?.reads ?? false
    },

    async reserve(month, worstMicroUsd, call, at) {
      const { actorId, capMicroUsd, shareMicroUsd } = call
      return db.transaction(async (tx) => {
        // the account first, as every lock is taken (privacy.md)
        const paid = await takeShare(tx, month, worstMicroUsd, call)
        if (paid === null) {
          // once a month, and never again for a month told before a later one (adversarial А4б)
          const reached = await tx.execute(sql`
            update ${actors} set model_share_told = ${month}::date
            where ${actors.id} = ${actorId}
              and (${actors.modelShareTold} is null or ${actors.modelShareTold} < ${month}::date)
            returning 1`)
          if (reached.length > 0) {
            await tell(tx, owner, { kind: 'model_share', month, shareMicroUsd }, at)
          }
          return 'share'
        }
        // one statement takes the month's row and holds the cap — the trial's part of it on the trial (MOL-275): no
        // second call fits between a read and a write, whatever runs beside it
        const bound = paid ? capMicroUsd : Math.min(capMicroUsd, trialCapMicroUsd(capMicroUsd))
        const counted = await tx.execute<{ spent: string }>(sql`
          insert into ${modelSpend} (month, spent_micro_usd, calls)
          select ${month}::date, ${worstMicroUsd}::bigint, 1 where ${fits(sql`0`, worstMicroUsd, bound)}
          on conflict (month) do update
            set spent_micro_usd = ${modelSpend.spentMicroUsd} + excluded.spent_micro_usd,
                calls = ${modelSpend.calls} + 1
            where ${fits(sql`${modelSpend.spentMicroUsd}`, worstMicroUsd, bound)}
          returning spent_micro_usd as spent`)
        if (counted.length > 0) return 'reserved'
        // the share given back: the call is not made
        await tx.execute(sql`
          update ${actors} set model_spent_micro_usd = ${actors.modelSpentMicroUsd} - ${worstMicroUsd}::bigint
          where ${actors.id} = ${actorId}`)
        // refused by the trial's part alone, the cap still takes the paid: no stop to tell
        if (!paid) {
          const [fitsCap] = await tx.execute<{ fits: boolean }>(
            sql`select ${fits(monthSpentOf(month), worstMicroUsd, capMicroUsd)} as fits`,
          )
          if (fitsCap?.fits === true) return 'trial'
        }
        const stopped = await tx.execute<{ spent: string }>(sql`
          insert into ${modelSpend} (month, noticed) values (${month}::date, 100)
          on conflict (month) do update set noticed = 100 where ${modelSpend.noticed} < 100
          returning spent_micro_usd as spent`)
        const [row] = stopped
        if (row !== undefined) {
          await tell(
            tx,
            owner,
            {
              kind: 'model_spend',
              month,
              step: 100,
              spentMicroUsd: Number(row.spent),
              capMicroUsd,
            },
            at,
          )
        }
        return 'cap'
      })
    },

    async settle(month, worstMicroUsd, costMicroUsd, { actorId, capMicroUsd }, at) {
      await db.transaction(async (tx) => {
        // the account first. A share whose month moved on is left: what it holds of the old month's call is either
        // nothing — the new month began at nought — or the worst of a call reserved after it began, kept (А4)
        await tx.execute(sql`
          update ${actors}
          set model_spent_micro_usd = greatest(${actors.modelSpentMicroUsd} - ${worstMicroUsd}::bigint + ${costMicroUsd}::bigint, 0)
          where ${actors.id} = ${actorId} and ${actors.modelMonth} = ${month}::date`)
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
        await tell(
          tx,
          owner,
          { kind: 'model_spend', month, step, spentMicroUsd: spent, capMicroUsd },
          at,
        )
      })
    },

    async keepInMonth(month, worstMicroUsd, { actorId }) {
      // the share alone, as `settle` takes it: a month moved on keeps what it holds (А4)
      await db.execute(sql`
        update ${actors}
        set model_spent_micro_usd = greatest(${actors.modelSpentMicroUsd} - ${worstMicroUsd}::bigint, 0)
        where ${actors.id} = ${actorId} and ${actors.modelMonth} = ${month}::date`)
    },

    async access(actorId, receiptsMonth) {
      if (idOrNull(actorId) === null) return null
      const [row] = await db
        .select({
          // empty and past are one answer, as `shared_until`'s: nothing paid
          until:
            sql<Date | null>`case when ${PAID_BY_MODEL} then ${actors.receiptsModelUntil} end`.mapWith(
              actors.receiptsModelUntil,
            ),
          trialLeft: actors.trialReceiptsLeft,
          read: sql<number>`(case when ${actors.modelReceiptsMonth} >= ${receiptsMonth}::date
            then ${actors.modelReceiptsRead} else 0 end)::int`,
        })
        .from(actors)
        .where(eq(actors.id, actorId))
      return row ?? null
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
