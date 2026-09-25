import { sql } from 'drizzle-orm'
import { telegramUserIdSchema } from '@molvia/model'
import type { TelegramUserId } from '@molvia/model'
import type { Db } from './index'

/**
 * Every column in the schema that points at `actors`, as `table.column`. Erasure has to know
 * each of them, and a test compares this list with what `information_schema` says, so a new
 * table that references an owner cannot join the schema without joining erasure too.
 */
export const ACTOR_REFERENCES = [
  'events.actor_id',
  'items.created_by',
  'search_picks.actor_id',
  'sessions.actor_id',
  'trips.actor_id',
  'verdicts.actor_id',
] as const

/** What erasure removes, in the order it removes it. `items` is kept and only loses its author. */
export const ERASED_TABLES = [
  'sessions',
  'search_picks',
  'verdicts',
  'events',
  'expenses',
  'trips',
  'login_requests',
  'actors',
] as const

export type ErasedTable = (typeof ERASED_TABLES)[number]

export interface ErasureReport {
  /** Whether an owner with this Telegram id existed. Login requests are erased either way. */
  readonly found: boolean
  readonly erased: Readonly<Record<ErasedTable, number>>
  /** Catalogue items this person added: they stay, with `created_by` nulled. */
  readonly itemsReleased: number
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
    options: { readonly dryRun: boolean },
  ): Promise<ErasureReport>
}

class DryRun extends Error {
  constructor(readonly report: ErasureReport) {
    super('dry run')
  }
}

export function createErasureRepository(db: Db): ErasureRepository {
  return {
    async erase(telegramUserId, { dryRun }) {
      // Checked here and not only by the callers: the id is interpolated into a DELETE, and a
      // value no owner could have must never reach one.
      const id = telegramUserIdSchema.parse(telegramUserId)
      try {
        return await db.transaction(async (tx) => {
          const count = async (statement: ReturnType<typeof sql>): Promise<number> =>
            (await tx.execute(statement)).length

          // The login requests first, and not only to count them (adversarial О-3). `for update`
          // on an owner who does not exist yet locks nothing, and a confirmed login collected in
          // the meantime created one this transaction had already decided was not there — it
          // reported «nobody to erase» over a live account. Collection locks its request row
          // before it creates the owner, so holding these rows makes the two take turns: a
          // collection already under way finishes first and its owner is found below; one that
          // comes after finds its request gone. A login confirmed *after* this line is a new
          // sign-in, made after the person asked to be erased.
          await tx.execute(
            sql`select 1 from login_requests where telegram_user_id = ${id} for update`,
          )
          // The owner's row: a concurrent write by the same person waits and then fails on its
          // foreign key, rather than land a row beside an owner that is going away.
          const owner = await tx.execute<{ id: string }>(
            sql`select id from actors where telegram_user_id = ${id} for update`,
          )
          const actorId = owner[0]?.id ?? null

          const erased: Record<ErasedTable, number> = {
            sessions: 0,
            search_picks: 0,
            verdicts: 0,
            events: 0,
            expenses: 0,
            trips: 0,
            login_requests: 0,
            actors: 0,
          }
          let itemsReleased = 0

          if (actorId !== null) {
            itemsReleased = (
              await tx.execute(sql`select 1 from items where created_by = ${actorId}`)
            ).length
            erased.sessions = await count(
              sql`delete from sessions where actor_id = ${actorId} returning 1`,
            )
            erased.search_picks = await count(
              sql`delete from search_picks where actor_id = ${actorId} returning 1`,
            )
            // Withdrawn verdicts too: a row kept for the 0.2 gate is still this person's opinion.
            erased.verdicts = await count(
              sql`delete from verdicts where actor_id = ${actorId} returning 1`,
            )
            // The one written exception to «nothing deletes from events» (MOL-58): the right to
            // be erased outweighs a gate, and a lost row there is the lesser harm.
            erased.events = await count(
              sql`delete from events where actor_id = ${actorId} returning 1`,
            )
            // The cascade from `trips` would take these anyway; deleted first so they are counted.
            erased.expenses = await count(sql`
              delete from expenses
              where trip_id in (select id from trips where actor_id = ${actorId})
              returning 1`)
            erased.trips = await count(
              sql`delete from trips where actor_id = ${actorId} returning 1`,
            )
          }
          // No foreign key reaches these — on a first login the owner does not exist yet — so
          // no cascade does either. A person who began a login and never finished has only this.
          erased.login_requests = await count(
            sql`delete from login_requests where telegram_user_id = ${id} returning 1`,
          )
          if (actorId !== null) {
            // `items.created_by` is `ON DELETE SET NULL`: the catalogue keeps what was added.
            erased.actors = await count(sql`delete from actors where id = ${actorId} returning 1`)
          }

          const report: ErasureReport = { found: actorId !== null, erased, itemsReleased }
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
