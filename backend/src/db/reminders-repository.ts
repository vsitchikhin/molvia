import { sql } from 'drizzle-orm'
import { PENDING_VERDICTS_LIMIT } from '@molvia/model'
import type { PendingVerdict, ReminderLadder, ReminderPlan, ReminderStep } from '@molvia/model'
import { createExpenseRepository } from './expenses-repository'
import type { Conn } from './index'
import { yerevanDay } from './yerevan-week'

/** A person who might be reminded, and where they stand on the ladder (MOL-101). */
export interface ReminderCandidate {
  readonly actorId: string
  readonly telegramUserId: number
  readonly country: string
  readonly ladder: ReminderLadder | null
  /** A live verdict of theirs written after their last reminder — the ladder starts over (Л-1). */
  readonly ratedSince: boolean
  /**
   * When their latest purchase of a product they have no live verdict on was made — the purchase's
   * moment as the reminder reads it, `least(entered, trip finished)`, not the entry (adversarial Е:
   * a purchase written into a trip closed the day before belongs to that day). A person whose latest
   * such purchase is older than step 1's day has nothing to be asked about and is not claimed,
   * rather than claimed empty every minute of every evening. Unrated products only (adversarial В):
   * whoever rated yesterday's milk at once, or bought only a dish, has nothing to be asked either.
   */
  readonly lastUnratedAt: Date | null
}

export interface ClaimRequest {
  readonly actorId: string
  readonly timeZone: string
  readonly plan: ReminderPlan
  readonly today: string
  /** The day of the reminder the plan was made from: the claim holds only if it is still that. */
  readonly previous: string | null
  readonly now: Date
}

export interface ClaimedReminder {
  readonly items: readonly PendingVerdict[]
  readonly total: number
}

export interface ReminderRepository {
  /**
   * Everyone who has a Telegram account to be reminded in, with their ladder. Every owner, every
   * minute of the evening: at 0.2 they are a few dozen, and the plan is the domain's to decide.
   */
  candidates(): Promise<ReminderCandidate[]>
  /**
   * Hands out one reminder, in one transaction: the items it asks about, and the ladder moved to
   * its step **only if it still stands where the plan found it** — a second claim of the same
   * evening, from a second bot or a retry, finds the day already taken and gets `null`. Marked on
   * handing out, not on sending (Р-2): a reminder lost in between is lost, never sent twice.
   *
   * `null` too when there is nothing to ask about. A step 2 or 3 with nothing left ends the ladder
   * (Л-2); a step 1 with nothing leaves it as it was.
   *
   * **Only what `sendable` accepts is asked about, and it is decided before anything is marked**
   * (adversarial А). A name stored before today's rule of visible text would fail the contract the
   * bot reads, and checked after the claims of a whole minute were committed it made the answer a
   * 500 — every person of that minute marked and none reminded. Such an item stays in «Оценки»;
   * the reminder skips it, the others of the day go.
   */
  claim(
    request: ClaimRequest,
    limit: number,
    sendable: (item: PendingVerdict) => boolean,
  ): Promise<ClaimedReminder | null>
  /** One more verdict given by a press under a reminder, on today's row of `reminder_days`. */
  countRated(): Promise<void>
}

const STEP_COLUMN: Readonly<Record<ReminderStep, string>> = {
  1: 'first_steps',
  2: 'second_steps',
  3: 'third_steps',
}

export function createReminderRepository(db: Conn): ReminderRepository {
  return {
    async candidates() {
      const rows = await db.execute<{
        actor_id: string
        telegram_user_id: number
        country: string
        step: ReminderStep | null
        reminded_on: string | null
        window_from: string | null
        rated_since: boolean
        last_unrated_at: string | null
      }>(sql`
        select
          a.id as actor_id,
          a.telegram_user_id::float8 as telegram_user_id,
          a.country,
          r.step,
          to_char(r.reminded_on, 'YYYY-MM-DD') as reminded_on,
          to_char(r.window_from, 'YYYY-MM-DD') as window_from,
          -- Withdrawn is not rated, and a repeat of the same score does not move \`updated_at\`.
          coalesce(exists (
            select 1 from verdicts v
            where v.actor_id = a.id and v.deleted_at is null and v.updated_at > r.reminded_at
          ), false) as rated_since,
          (
            select max(least(e.created_at, t.finished_at))::text from expenses e
            join trips t on t.id = e.trip_id
            join items i on i.id = e.item_id and i.kind = 'product'
            where t.actor_id = a.id and t.deleted_at is null
              and not exists (
                select 1 from verdicts v
                where v.actor_id = a.id and v.item_id = e.item_id and v.deleted_at is null
              )
          ) as last_unrated_at
        from actors a
        left join rating_reminders r on r.actor_id = a.id
        order by a.id
      `)
      return rows.map((row) => ({
        actorId: row.actor_id,
        telegramUserId: row.telegram_user_id,
        country: row.country.trim(),
        ladder:
          row.step !== null && row.reminded_on !== null && row.window_from !== null
            ? { step: row.step, remindedOn: row.reminded_on, windowFrom: row.window_from }
            : null,
        ratedSince: row.rated_since,
        lastUnratedAt: row.last_unrated_at === null ? null : new Date(row.last_unrated_at),
      }))
    },

    async claim({ actorId, timeZone, plan, today, previous, now }, limit, sendable) {
      return db.transaction(async (tx) => {
        // The owner first, as erasure takes it (privacy.md): an erasure under way is waited for,
        // and then the owner is gone and there is no one to remind.
        const owner = await tx.execute(
          sql`select 1 from actors where id = ${actorId}::uuid for key share`,
        )
        if (owner.length === 0) return null

        // The person's days as instants, by Postgres, which knows the zone's history.
        const [bounds] = await tx.execute<{ from_at: string; to_at: string }>(sql`
          select
            ((${plan.from}::date)::timestamp at time zone ${timeZone})::text as from_at,
            ((${plan.to}::date + 1)::timestamp at time zone ${timeZone})::text as to_at`)
        if (!bounds) return null
        // A page of the screen's size, then the ones that can be sent: an item skipped must not
        // take the place of one behind it.
        const pending = await createExpenseRepository(tx).pendingVerdictsFor(
          actorId,
          PENDING_VERDICTS_LIMIT,
          { from: new Date(bounds.from_at), to: new Date(bounds.to_at) },
        )
        const items = pending.items.filter(sendable).slice(0, limit)

        if (items.length === 0) {
          if (plan.step > 1 && previous !== null) {
            await tx.execute(sql`
              delete from rating_reminders
              where actor_id = ${actorId}::uuid and reminded_on = ${previous}::date`)
          }
          return null
        }

        const moved = await tx.execute(sql`
          insert into rating_reminders (actor_id, step, reminded_on, reminded_at, window_from)
          values (
            ${actorId}::uuid,
            ${plan.step},
            ${today}::date,
            ${now.toISOString()}::timestamptz,
            ${plan.from}::date
          )
          on conflict (actor_id) do update set
            step = excluded.step,
            reminded_on = excluded.reminded_on,
            reminded_at = excluded.reminded_at,
            window_from = excluded.window_from
          where rating_reminders.reminded_on is not distinct from ${previous}::date
          returning 1`)
        if (moved.length === 0) return null

        const column = sql.raw(STEP_COLUMN[plan.step])
        await tx.execute(sql`
          insert into reminder_days (day, ${column}, items)
          values (${yerevanDay(sql`${now.toISOString()}::timestamptz`)}, 1, ${items.length})
          on conflict (day) do update set
            ${column} = reminder_days.${column} + 1,
            items = reminder_days.items + excluded.items`)
        return { items, total: pending.total }
      })
    },

    async countRated() {
      await db.execute(sql`
        insert into reminder_days (day, rated) values (${yerevanDay(sql`now()`)}, 1)
        on conflict (day) do update set rated = reminder_days.rated + 1`)
    },
  }
}
