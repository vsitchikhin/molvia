import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { telegramUserIdSchema } from '@molvia/model'
import type { TelegramUserId } from '@molvia/model'
import { cursorAtOrBelow } from './broadcasts-repository'
import { silentErasable } from './silence-repository'
import type { Db } from './index'
import { lockTelegramAccount } from './telegram-lock'
import { yerevanWeek } from './yerevan-week'

/**
 * Every column in the schema that points at `actors`, as `table.column`. Erasure has to know
 * each of them, and a test compares this list with what `information_schema` says, so a new
 * table that references an owner cannot join the schema without joining erasure too.
 */
export const ACTOR_REFERENCES = [
  'account_transfers.actor_id',
  'budget_plans.actor_id',
  'catalogue_merge_moves.actor_id',
  'events.actor_id',
  'exchanges.actor_id',
  'feedback.actor_id',
  'incomes.actor_id',
  'item_barcodes.added_by',
  'items.created_by',
  'login_notices.actor_id',
  'money_account_checks.actor_id',
  'money_accounts.actor_id',
  'money_month_rates.actor_id',
  'rating_reminders.actor_id',
  'receipt_misses.actor_id',
  'receipts.actor_id',
  'search_picks.actor_id',
  'sessions.actor_id',
  'spending_categories.actor_id',
  'spendings.actor_id',
  'store_memory.actor_id',
  'trips.actor_id',
  'verdicts.actor_id',
] as const

/**
 * Every column in the schema that points at `items`, as `table.column` (MOL-374). The sweep deletes an
 * item whose author is gone only where nothing stands on it (`nobodyStandsOn`), so it has to know each of
 * them: a test compares this list with `information_schema`, and the test of the holders takes a case for
 * every key — a row of it that holds the item, or `cascade` — so a key added here without its `not exists`
 * fails it. One that does not cascade and is not asked would fail the sweep on its foreign key; one that
 * cascades would take somebody's rows in silence.
 */
export const ITEM_REFERENCES = [
  // held: someone else's
  'catalogue_merges.from_item',
  'catalogue_merges.into_item',
  'expenses.item_id',
  'items.merged_into',
  'receipt_lines.item_id',
  'search_picks.item_id',
  'verdicts.item_id',
  // held while their author lives; the erased person's own and the authorless go by the cascade
  'item_barcodes.item_id',
  'store_memory.item_id',
  // held: only the seed writes them (MOL-126)
  'item_hs.item_id',
  'item_names.item_id',
  // gone with the item by the cascade: nobody's
  'item_embeddings.item_id',
] as const

export type ItemReference = (typeof ITEM_REFERENCES)[number]

/**
 * What erasure removes, in the order it removes it. `items` is not among them: the person's items lose
 * their author and are marked, the sweep deletes those nothing stands on (MOL-374), and the copy holds
 * them all either way.
 */
export const ERASED_TABLES = [
  'login_notices',
  'sessions',
  'search_picks',
  'rating_reminders',
  'verdicts',
  'events',
  'feedback',
  'receipts',
  'expenses',
  'trips',
  'exchanges',
  'incomes',
  'spendings',
  'account_transfers',
  'budget_plans',
  'spending_categories',
  'money_month_rates',
  'money_account_checks',
  'money_accounts',
  'login_requests',
  'actors',
] as const

export type ErasedTable = (typeof ERASED_TABLES)[number]

export interface ErasureReport {
  /** Whether an owner with this Telegram id existed. Login requests are erased either way. */
  readonly found: boolean
  readonly erased: Readonly<Record<ErasedTable, number>>
  /**
   * Catalogue items the sweep takes once this erasure commits (MOL-374, В-7 «а»): this person's own that
   * no living person stands on, and items whose author was gone already that only this person still
   * stood on — with their vectors, the codes written to them and the words of the shops' memory.
   */
  readonly itemsLeaving: number
  /**
   * Catalogue items this person added that someone stands on: they stay, with `created_by` nulled and
   * marked `released_at`, until the last one standing on them goes.
   */
  readonly itemsReleased: number
  /** Codes this person wrote to items that stay (MOL-100): they stay too, with `added_by` nulled. */
  readonly barcodesReleased: number
  /** Words this person gave the shops' memory about items that stay (MOL-126): `actor_id` nulled. */
  readonly memoryReleased: number
  /**
   * Whether the person was added to `erasures`, the count by week of arrival the gates print
   * (MOL-91) — the one thing erasure leaves, and no more than a number.
   */
  readonly counted: boolean
}

export interface ErasureRepository {
  /**
   * Removes everything about the owner behind a Telegram id, in one transaction (MOL-58).
   *
   * **A dry run is the real run, rolled back.** Counting with separate `SELECT`s would be a
   * second description of what erasure does, and the one place the two could disagree is the
   * one place a person relies on the count: before saying yes.
   */
  erase(
    telegramUserId: TelegramUserId,
    options: {
      readonly dryRun: boolean
      /**
       * Erasure for two years of silence (MOL-239): only if the account is still due at this moment,
       * judged under its locks (Р-7) — a login takes the account's lock too, so one that came first has
       * moved the visit, and nothing is erased: `found: false`, not even the login requests. Counted in
       * `erasures.silent`.
       */
      readonly silentAt?: Date
    },
  ): Promise<ErasureReport>
}

class DryRun extends Error {
  constructor(readonly report: ErasureReport) {
    super('dry run')
  }
}

/** Every table at nought: the start of a count, and the whole report of an erasure that did not happen. */
function noneErased(): Record<ErasedTable, number> {
  return {
    login_notices: 0,
    sessions: 0,
    search_picks: 0,
    rating_reminders: 0,
    verdicts: 0,
    events: 0,
    feedback: 0,
    expenses: 0,
    trips: 0,
    exchanges: 0,
    incomes: 0,
    spendings: 0,
    account_transfers: 0,
    receipts: 0,
    budget_plans: 0,
    spending_categories: 0,
    money_month_rates: 0,
    money_account_checks: 0,
    money_accounts: 0,
    login_requests: 0,
    actors: 0,
  }
}

/** The report of nobody erased: no owner, or one whose silence a login ended (MOL-239). */
function nobody(): ErasureReport {
  return {
    found: false,
    erased: noneErased(),
    itemsLeaving: 0,
    itemsReleased: 0,
    barcodesReleased: 0,
    memoryReleased: 0,
    counted: false,
  }
}

/**
 * Nothing stands on the item `i` (MOL-374): no living person's purchase, verdict — a withdrawn one too,
 * the gate counts it — pick, line of a receipt not recorded yet (В-2 «а»: its «Записать» sends the item
 * by its id), code or word of the shops' memory; no merge either way, no «apart» of the owner, no name or
 * heading of the seed — the seed alone writes them, and every line of it has them. The rows of an erased
 * person are gone or have lost their author, so a code or a word with none holds nothing (adversarial
 * Р2-А7); `erasing` — the person erasure is taking, whose own codes and words lose their author only as
 * its transaction ends. `ITEM_REFERENCES` and the test of the holders keep it whole.
 */
function nobodyStandsOn(erasing: string | null): SQL {
  const notTheirs = (column: SQL) =>
    erasing === null
      ? sql`${column} is not null`
      : sql`${column} is not null and ${column} <> ${erasing}::uuid`
  return sql`i.merged_into is null
    and not exists (select 1 from items t where t.merged_into = i.id)
    and not exists (select 1 from catalogue_merges g where i.id in (g.from_item, g.into_item))
    and not exists (select 1 from catalogue_apart a where a.subject = 'item' and i.id in (a.a, a.b))
    and not exists (select 1 from expenses e where e.item_id = i.id)
    and not exists (select 1 from verdicts v where v.item_id = i.id)
    and not exists (select 1 from search_picks p where p.item_id = i.id)
    and not exists (select 1 from receipt_lines l where l.item_id = i.id)
    and not exists (
      select 1 from item_barcodes b where b.item_id = i.id and ${notTheirs(sql`b.added_by`)})
    and not exists (
      select 1 from store_memory m where m.item_id = i.id and ${notTheirs(sql`m.actor_id`)})
    and not exists (select 1 from item_names n where n.item_id = i.id)
    and not exists (select 1 from item_hs h where h.item_id = i.id)`
}

const uuids = (ids: readonly string[]): SQL =>
  sql`array[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]`

/** At most so many items a transaction of the sweep takes: a loop of the minute goes on while it is full. */
const SWEEP_BATCH = 200

/**
 * Deletes the items whose author is gone (`released_at`) and on which nothing stands any more (MOL-374,
 * owner's В-7 «а»), by the minute timer of the cleanups. A batch a transaction, each item `for update
 * skip locked` — one somebody is writing to is taken by a later minute — and asked again as it goes,
 * since a purchase may have come between the two statements. A candidate of the merge naming one goes
 * with it, its vector by the cascade. It holds no person's row, so it waits on nobody's erasure.
 */
export async function sweepReleasedItems(db: Db): Promise<number> {
  let swept = 0
  for (;;) {
    const { taken, gone } = await db.transaction(async (tx) => {
      const locked = await tx.execute<{ id: string }>(sql`
        select i.id from items i
        where i.released_at is not null and ${nobodyStandsOn(null)}
        order by i.id
        limit ${SWEEP_BATCH}
        for update skip locked`)
      if (locked.length === 0) return { taken: 0, gone: 0 }
      const ids = uuids(locked.map((row) => row.id))
      const [row] = await tx.execute<{ n: number }>(sql`
        with gone as (
          delete from items i
          where i.id = any(${ids}) and ${nobodyStandsOn(null)}
          returning i.id
        ), candidates as (
          delete from catalogue_merge_candidates c
          where c.subject = 'item' and (c.a in (select id from gone) or c.b in (select id from gone))
        )
        select count(*)::int as n from gone`)
      return { taken: locked.length, gone: row?.n ?? 0 }
    })
    swept += gone
    if (taken < SWEEP_BATCH) return swept
  }
}

export function createErasureRepository(db: Db): ErasureRepository {
  return {
    async erase(telegramUserId, { dryRun, silentAt }) {
      // Checked here and not only by the callers: the id is interpolated into a DELETE, and a
      // value no owner could have must never reach one.
      const id = telegramUserIdSchema.parse(telegramUserId)
      try {
        return await db.transaction(async (tx) => {
          // Counted in the database: `returning 1` alone brought every erased row over the wire
          // just to take its length, and a long history made the dry run cost more than it said.
          const count = async (statement: ReturnType<typeof sql>): Promise<number> => {
            const [row] = await tx.execute<{ n: number }>(
              sql`with erased as (${statement}) select count(*)::int as n from erased`,
            )
            return row?.n ?? 0
          }

          // The login requests first, and not only to count them (adversarial О-3). `for update`
          // on an owner who does not exist yet locks nothing, and a confirmed login collected in
          // the meantime created one this transaction had already decided was not there — it
          // reported «nobody to erase» over a live account. Collection locks its request row
          // before it creates the owner, so holding these rows makes the two take turns: a
          // collection already under way finishes first and its owner is found below; one that
          // comes after finds its request gone. A request not yet confirmed has no Telegram id to
          // be found by, and that is what the account lock above is for.
          // A confirmation in this person's name waits until this commits (П-2, see the lock).
          await tx.execute(lockTelegramAccount(id))
          await tx.execute(
            sql`select 1 from login_requests where telegram_user_id = ${id} for update`,
          )
          // The owner's row: a concurrent write by the same person waits and then fails on its
          // foreign key, rather than land a row beside an owner that is going away.
          const owner = await tx.execute<{ id: string; silent: boolean }>(sql`
            select id, ${silentAt === undefined ? sql`false` : silentErasable('actors', silentAt)} as silent
            from actors where telegram_user_id = ${id} for update`)
          const actorId = owner[0]?.id ?? null
          if (silentAt !== undefined && owner[0]?.silent !== true) return nobody()

          const erased = noneErased()
          let items = { itemsLeaving: 0, itemsReleased: 0 }
          let barcodesReleased = 0
          let memoryReleased = 0
          if (actorId !== null) {
            // The items released before on which this person still stands (MOL-374, adversarial А1):
            // read before their rows go, so the report can say which the sweep will take.
            const stoodOn = (
              await tx.execute<{ id: string }>(sql`
                select id from items
                where released_at is not null and id in (
                  select e.item_id from expenses e join trips t on t.id = e.trip_id
                  where t.actor_id = ${actorId}
                  union select item_id from verdicts where actor_id = ${actorId}
                  union select item_id from search_picks where actor_id = ${actorId}
                  union select item_id from item_barcodes where added_by = ${actorId}
                  union select item_id from store_memory where actor_id = ${actorId}
                  union select l.item_id from receipt_lines l join receipts r on r.id = l.receipt_id
                        where r.actor_id = ${actorId})
                order by id`)
            ).map((row) => row.id)
            // The person's items marked as their author leaving (В-7 «а»), right after the owner and in
            // the order of their ids, before anything of theirs is deleted: the merge night holding one
            // finishes first — moving the person's pick, a row not deleted yet — and a reading of their
            // receipt holding a key share of one passes, since this lock is no key update. A trace is
            // marked last, with the cascade that updates it anyway: the night moves a trace while it
            // holds the trace's survivor (adversarial Р2-А9).
            await tx.execute(sql`
              update items set released_at = now()
              where id in (
                select id from items where created_by = ${actorId} and merged_into is null
                order by id for no key update)`)
            // A sign-in the bot has not told of yet (MOL-361): which device, and when.
            erased.login_notices = await count(
              sql`delete from login_notices where actor_id = ${actorId} returning 1`,
            )
            erased.sessions = await count(
              sql`delete from sessions where actor_id = ${actorId} returning 1`,
            )
            erased.search_picks = await count(
              sql`delete from search_picks where actor_id = ${actorId} returning 1`,
            )
            // Where the person stood on the ladder of reminders (MOL-101): the day of their last
            // reminder, nothing more — but it is theirs, and it points at the owner.
            erased.rating_reminders = await count(
              sql`delete from rating_reminders where actor_id = ${actorId} returning 1`,
            )
            // Withdrawn verdicts too: a row kept for the gate and the reminder is still this
            // person's.
            erased.verdicts = await count(
              sql`delete from verdicts where actor_id = ${actorId} returning 1`,
            )
            // The one written exception to «nothing deletes from events» (MOL-58): the right to
            // be erased outweighs a gate, and a lost row there is the lesser harm.
            erased.events = await count(
              sql`delete from events where actor_id = ${actorId} returning 1`,
            )
            // What the person wrote to the developer (MOL-147), continuations of a thread too; the
            // owner's replies go by the cascade from `feedback`, part of the message they answer.
            erased.feedback = await count(
              sql`delete from feedback where actor_id = ${actorId} returning 1`,
            )
            // Receipts photographed (MOL-125), removed ones too: the photo, the lines read and the
            // lines cut out for the reader's training go by the cascade — part of a receipt. Before
            // the trips, whose cascade takes a recorded one uncounted (MOL-240).
            erased.receipts = await count(
              sql`delete from receipts where actor_id = ${actorId} returning 1`,
            )
            // The cascade from `trips` would take these anyway; deleted first so they are counted.
            erased.expenses = await count(sql`
              delete from expenses
              where trip_id in (select id from trips where actor_id = ${actorId})
              returning 1`)
            erased.trips = await count(
              sql`delete from trips where actor_id = ${actorId} returning 1`,
            )
            // The cascade from `actors` would take these too (MOL-40); deleted here so they are
            // counted — they are the person's own money, and the dry run has to say so. Their
            // earlier versions go by the cascade from `exchanges` (MOL-42): part of an exchange,
            // counted with it.
            erased.exchanges = await count(
              sql`delete from exchanges where actor_id = ${actorId} returning 1`,
            )
            // The same for incomes (MOL-66), their versions going by the cascade from `incomes`.
            erased.incomes = await count(
              sql`delete from incomes where actor_id = ${actorId} returning 1`,
            )
            // Spendings outside trips (MOL-73), removed ones too — then the categories they
            // pointed at, and the rates the person's closed months were frozen at.
            erased.spendings = await count(
              sql`delete from spendings where actor_id = ${actorId} returning 1`,
            )
            // Transfers between the person's accounts (MOL-253), after the spendings that were their
            // fees, so those are counted as spendings; their versions go by the cascade.
            erased.account_transfers = await count(
              sql`delete from account_transfers where actor_id = ${actorId} returning 1`,
            )
            // The plans of «Бюджет» (MOL-117) point at the categories, so they go before them.
            erased.budget_plans = await count(
              sql`delete from budget_plans where actor_id = ${actorId} returning 1`,
            )
            erased.spending_categories = await count(
              sql`delete from spending_categories where actor_id = ${actorId} returning 1`,
            )
            erased.money_month_rates = await count(
              sql`delete from money_month_rates where actor_id = ${actorId} returning 1`,
            )
            // Where the money lay (MOL-115): the checks, then the accounts — after every operation
            // that named one, so no key still points at them.
            erased.money_account_checks = await count(
              sql`delete from money_account_checks where actor_id = ${actorId} returning 1`,
            )
            erased.money_accounts = await count(
              sql`delete from money_accounts where actor_id = ${actorId} returning 1`,
            )
            await tx.execute(sql`
              update items set released_at = now()
              where created_by = ${actorId} and released_at is null`)
            // What the sweep will take once this commits, and what stays: a code or a word on an item
            // that goes goes with it (review 1, №1).
            const [counts] = await tx.execute<{
              leaving: number
              ownLeaving: number
              own: number
              codes: number
              words: number
            }>(sql`
              with going as (
                select i.id, i.created_by from items i
                where (i.created_by = ${actorId} or i.id = any(${uuids(stoodOn)}))
                  and ${nobodyStandsOn(actorId)}
              )
              select
                (select count(*) from going)::int as leaving,
                (select count(*) from going where created_by = ${actorId})::int as "ownLeaving",
                (select count(*) from items where created_by = ${actorId})::int as own,
                (select count(*) from item_barcodes
                  where added_by = ${actorId} and item_id not in (select id from going))::int as codes,
                (select count(*) from store_memory
                  where actor_id = ${actorId} and item_id not in (select id from going))::int as words`)
            items = {
              itemsLeaving: counts?.leaving ?? 0,
              itemsReleased: (counts?.own ?? 0) - (counts?.ownLeaving ?? 0),
            }
            barcodesReleased = counts?.codes ?? 0
            memoryReleased = counts?.words ?? 0
          }
          // No foreign key reaches these — on a first login the owner does not exist yet — so
          // no cascade does either. A person who began a login and never finished has only this.
          erased.login_requests = await count(
            sql`delete from login_requests where telegram_user_id = ${id} returning 1`,
          )
          let counted = false
          if (actorId !== null) {
            // One more among those who appeared that week (MOL-91), before the row it is read
            // from goes: without it the gates lose the person with no trace.
            counted =
              (await count(sql`
                insert into erasures (appeared_week, erased, silent)
                select ${yerevanWeek(sql`created_at`)}, 1, ${silentAt === undefined ? 0 : 1}
                from actors where id = ${actorId}
                on conflict (appeared_week) do update set erased = erasures.erased + 1,
                  silent = erasures.silent + excluded.silent
                returning 1`)) > 0
            // The broadcasts whose cursor may come to this person, locked before the person goes
            // (MOL-237, adversarial А2): a word of the bot in flight then either lands first and is
            // moved below, or comes after and no longer sees them. Their cursor only moves forwards,
            // so one past this person never comes back to them.
            await tx.execute(
              sql`select 1 from broadcasts where cursor <= ${actorId}::uuid order by id for update`,
            )
            // `items.created_by`, `item_barcodes.added_by` and `store_memory.actor_id` are `ON DELETE
            // SET NULL`: the catalogue keeps what was added and someone stands on (MOL-374), the codes
            // written to it, and the shops' memory the words it was given (MOL-126).
            erased.actors = await count(sql`delete from actors where id = ${actorId} returning 1`)
            // A broadcast that has got to this person keeps its place without their id (MOL-237):
            // the nearest live id below leaves the same people after it.
            await tx.execute(sql`
              update broadcasts set cursor = ${cursorAtOrBelow(sql`${actorId}::uuid`)}
              where cursor = ${actorId}::uuid`)
          }

          const report: ErasureReport = {
            found: actorId !== null,
            erased,
            ...items,
            barcodesReleased,
            memoryReleased,
            counted,
          }
          if (dryRun) throw new DryRun(report)
          return report
        })
      } catch (error) {
        if (error instanceof DryRun) return error.report
        throw error
      }
    },
  }
}
