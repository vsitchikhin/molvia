import { sql } from 'drizzle-orm'
import { telegramUserIdSchema } from '@molvia/model'
import type { TelegramUserId } from '@molvia/model'
import { cursorAtOrBelow } from './broadcasts-repository'
import { silentErasable } from './silence-repository'
import type { Conn, Db } from './index'
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
 * Every column in the schema that points at `items`, as `table.column` (MOL-374). Erasure deletes a
 * person's item only where nothing but their own rows stood on it, so it has to know each of them: a
 * test compares this list with `information_schema`, and a new table that points at an item cannot join
 * the schema without deciding here whether it holds the item — one that does not cascade and is not
 * asked would fail every erasure of the item's author on its foreign key.
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
  // held where not the person's own; their own go with the item by the cascade
  'item_barcodes.item_id',
  'store_memory.item_id',
  // held: only the seed writes them (MOL-126)
  'item_hs.item_id',
  'item_names.item_id',
  // gone with the item by the cascade: nobody's
  'item_embeddings.item_id',
] as const

/**
 * What erasure removes, in the order it removes it. `items` is not among them: the person's items nobody
 * else stands on go (MOL-374), the rest only lose their author, and the copy holds them all either way.
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
   * Catalogue items this person added that nothing else stood on (MOL-374): deleted, with their vector,
   * the codes the person wrote to them and the person's own words of the shops' memory about them.
   */
  readonly itemsErased: number
  /** Catalogue items this person added that someone else stands on: they stay, with `created_by` nulled. */
  readonly itemsReleased: number
  /** Codes this person wrote to items (MOL-100): they stay, with `added_by` nulled. */
  readonly barcodesReleased: number
  /** Words this person gave the shops' memory (MOL-126): they stay, with `actor_id` nulled. */
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
    itemsErased: 0,
    itemsReleased: 0,
    barcodesReleased: 0,
    memoryReleased: 0,
    counted: false,
  }
}

/**
 * The person's items nobody else stands on, deleted (MOL-374, owner's В-5 «б» of MOL-362): «Удалить мои
 * данные» left every one of them to the catalogue, so «60 → erase → sign in again» filled everybody's
 * search for good. Run after the person's own rows are gone and before their owner row, whose deletion
 * nulls `created_by` — so a row still pointing at an item here is somebody else's, and holds it: a
 * purchase, a verdict (a withdrawn one too — the gate counts it), a pick, a line of a receipt not recorded
 * yet (В-2 «а»: its «Записать» sends the item by its id), a code or a word of the shops' memory not the
 * person's own (В-1 «а»: their own go with the item, or a receipt's «Записать», which makes both, would
 * keep every name it made), a merge either way, the owner's «apart», and the seed's names or headings — the
 * seed alone writes them, on an item someone proposed first. A candidate of the merge that names a deleted
 * item goes with it; its vector by the cascade.
 *
 * **Never waited on** (Р-2): an item another transaction holds — a purchase being written takes a key
 * share of it — is skipped and stays without its author, as every item did before. So erasure waits on
 * nobody's transaction and cannot deadlock with the merge night, which holds items and moves people's rows.
 * Locked by id, after the owner, as the order of locks says.
 */
async function eraseItemsOf(
  tx: Conn,
  actorId: string,
): Promise<{ itemsErased: number; itemsReleased: number }> {
  const [all] = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from items where created_by = ${actorId}`,
  )
  const locked = await tx.execute<{ id: string }>(sql`
    select id from items where created_by = ${actorId} order by id for update skip locked`)
  const ids = locked.map((row) => row.id)
  if (ids.length === 0) return { itemsErased: 0, itemsReleased: all?.n ?? 0 }
  const lockedIds = sql`array[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]`
  const gone = await tx.execute<{ id: string }>(sql`
    select i.id from items i
    where i.id = any(${lockedIds})
      and i.merged_into is null
      and not exists (select 1 from items t where t.merged_into = i.id)
      and not exists (select 1 from catalogue_merges g where i.id in (g.from_item, g.into_item))
      and not exists (select 1 from catalogue_apart a where a.subject = 'item' and i.id in (a.a, a.b))
      and not exists (select 1 from expenses e where e.item_id = i.id)
      and not exists (select 1 from verdicts v where v.item_id = i.id)
      and not exists (select 1 from search_picks p where p.item_id = i.id)
      and not exists (select 1 from receipt_lines l where l.item_id = i.id)
      and not exists (
        select 1 from item_barcodes b where b.item_id = i.id and b.added_by is distinct from ${actorId})
      and not exists (
        select 1 from store_memory m where m.item_id = i.id and m.actor_id is distinct from ${actorId})
      and not exists (select 1 from item_names n where n.item_id = i.id)
      and not exists (select 1 from item_hs h where h.item_id = i.id)
    order by i.id`)
  if (gone.length > 0) {
    const goneIds = sql`array[${sql.join(
      gone.map((row) => sql`${row.id}::uuid`),
      sql`, `,
    )}]`
    await tx.execute(sql`
      delete from catalogue_merge_candidates
      where subject = 'item' and (a = any(${goneIds}) or b = any(${goneIds}))`)
    await tx.execute(sql`delete from items where id = any(${goneIds})`)
  }
  return { itemsErased: gone.length, itemsReleased: (all?.n ?? 0) - gone.length }
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
          let itemsErased = 0
          let itemsReleased = 0
          let barcodesReleased = 0
          let memoryReleased = 0

          if (actorId !== null) {
            const [codes] = await tx.execute<{ n: number }>(
              sql`select count(*)::int as n from item_barcodes where added_by = ${actorId}`,
            )
            barcodesReleased = codes?.n ?? 0
            const [words] = await tx.execute<{ n: number }>(
              sql`select count(*)::int as n from store_memory where actor_id = ${actorId}`,
            )
            memoryReleased = words?.n ?? 0
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
            ;({ itemsErased, itemsReleased } = await eraseItemsOf(tx, actorId))
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
            itemsErased,
            itemsReleased,
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
