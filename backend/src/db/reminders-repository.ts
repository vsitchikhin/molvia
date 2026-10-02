import { sql } from 'drizzle-orm'
import { PENDING_VERDICTS_LIMIT, localClock, switchReminders, timeZoneOf } from '@molvia/model'
import type {
  PendingVerdict,
  ReminderLadder,
  ReminderPlan,
  ReminderStep,
  ReminderSwitch,
  RemindersOff,
} from '@molvia/model'
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
  /**
   * When the latest of those purchases was **entered** — any new entry moves it, one written into a
   * trip closed the day before included, where `lastUnratedAt` stands still. The memory of settled
   * evenings is opened again by it (adversarial И).
   */
  readonly lastUnratedEnteredAt: Date | null
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
  /** Why the person's reminders are off (MOL-103); null — they are on. */
  remindersOff(actorId: string): Promise<RemindersOff | null>
  /**
   * Moves the switch (MOL-103) as `switchReminders` says, in one transaction under the owner's row,
   * and answers where it stands now — `undefined` when there is no such owner. **Turned on, the
   * ladder starts over** (Р-3): its row goes, so the next reminder is a step 1 about yesterday, never
   * a step 2 «overdue» since the switch went off, asking about months of purchases — **unless it was
   * reminded on the person's today** (`now` in their zone, adversarial А): then it stays, or a slip
   * of the finger on «Не напоминать» and «Вернуть» brought the same questions again the next minute.
   * **Turned off from on, it is counted** on today's row of `reminder_days` (В-4), by how: `blocked`
   * for a blocked bot, otherwise the settings or the bot's button, as `via` says.
   */
  switchReminders(
    owner: { readonly actorId: string } | { readonly telegramUserId: number },
    change: ReminderSwitch,
    via: 'settings' | 'bot',
    now: Date,
  ): Promise<RemindersOff | null | undefined>
}

const STEP_COLUMN: Readonly<Record<ReminderStep, string>> = {
  1: 'first_steps',
  2: 'second_steps',
  3: 'third_steps',
}

/** Where a turning off is counted (В-4): by how it came. */
const OFF_COLUMN: Readonly<Record<'blocked' | 'settings' | 'bot', string>> = {
  blocked: 'off_blocked',
  settings: 'off_settings',
  bot: 'off_button',
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
        last_unrated_entered_at: string | null
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
          unrated.last_at as last_unrated_at,
          unrated.last_entered_at as last_unrated_entered_at
        from actors a
        left join rating_reminders r on r.actor_id = a.id
        left join lateral (
          select
            max(least(e.created_at, t.finished_at))::text as last_at,
            max(e.created_at)::text as last_entered_at
          from expenses e
          join trips t on t.id = e.trip_id
          join items i on i.id = e.item_id and i.kind = 'product'
          where t.actor_id = a.id and t.deleted_at is null
            and not exists (
              select 1 from verdicts v
              where v.actor_id = a.id and v.item_id = e.item_id and v.deleted_at is null
            )
        ) unrated on true
        -- Off is off, whoever turned it (MOL-103): nothing is planned, marked or counted for them.
        where a.reminders_off is null
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
        lastUnratedEnteredAt:
          row.last_unrated_entered_at === null ? null : new Date(row.last_unrated_entered_at),
      }))
    },

    async claim({ actorId, timeZone, plan, today, previous, now }, limit, sendable) {
      return db.transaction(async (tx) => {
        // The owner first, as erasure takes it (privacy.md): an erasure under way is waited for,
        // and then the owner is gone and there is no one to remind. Reminders turned off since
        // the candidates were read are off here too (MOL-103); a switch committed after this read
        // lets this one evening go — the lock does not wait for it, and that is the named price.
        const owner = await tx.execute(
          sql`select 1 from actors where id = ${actorId}::uuid and reminders_off is null for key share`,
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

    async remindersOff(actorId) {
      const [row] = await db.execute<{ reminders_off: RemindersOff | null }>(
        sql`select reminders_off from actors where id = ${actorId}::uuid`,
      )
      return row?.reminders_off ?? null
    },

    async switchReminders(owner, change, via, now) {
      return db.transaction(async (tx) => {
        const where =
          'actorId' in owner
            ? sql`id = ${owner.actorId}::uuid`
            : sql`telegram_user_id = ${owner.telegramUserId}`
        // The owner's row first, as erasure locks it (privacy.md), and the ladder after it.
        const [row] = await tx.execute<{
          id: string
          country: string
          reminders_off: RemindersOff | null
        }>(sql`select id, country, reminders_off from actors where ${where} for no key update`)
        if (!row) return undefined
        const next = switchReminders(row.reminders_off, change, via)
        if (next === row.reminders_off) return next

        await tx.execute(sql`update actors set reminders_off = ${next} where id = ${row.id}::uuid`)
        if (next === null) {
          // A country with no zone is never reminded, so it has no today to keep.
          const zone = timeZoneOf(row.country.trim())
          const today = zone === null ? null : localClock(now, zone).day
          await tx.execute(sql`
            delete from rating_reminders
            where actor_id = ${row.id}::uuid
              and (${today}::date is null or reminded_on < ${today}::date)`)
        } else if (row.reminders_off === null) {
          const column = sql.raw(OFF_COLUMN[change === 'blocked' ? 'blocked' : via])
          await tx.execute(sql`
            insert into reminder_days (day, ${column}) values (${yerevanDay(sql`now()`)}, 1)
            on conflict (day) do update set ${column} = reminder_days.${column} + 1`)
        }
        return next
      })
    },
  }
}
