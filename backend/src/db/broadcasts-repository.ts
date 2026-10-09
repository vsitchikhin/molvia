import { and, count, desc, inArray, isNull, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { BroadcastDone, BroadcastRecipient, TelegramUserId } from '@molvia/model'
import type { Conn } from './index'
import { rowLimit } from './rows'
import { BROADCAST_START, actors, broadcasts } from './schema'

/**
 * Whom a broadcast goes to (MOL-237, В-3): everybody, the people of some countries, or the owner
 * alone — a try before everybody.
 */
export type BroadcastAudience =
  | { readonly to: 'everybody' }
  | { readonly to: 'countries'; readonly countries: readonly string[] }
  | { readonly to: 'owner'; readonly owner: TelegramUserId }

/** One country of an audience: how many would get the message, and how many have the bot blocked. */
export interface AudienceCount {
  readonly country: string
  readonly recipients: number
  readonly blocked: number
}

export interface QueuedBroadcast {
  readonly id: number
  readonly total: number
  readonly blockedAtStart: number
}

/** The latest broadcast, as `make notify --status` prints it. Counts only — nobody in it. */
export interface BroadcastStatus {
  readonly id: number
  readonly ownerOnly: boolean
  readonly countries: readonly string[] | null
  readonly createdAt: Date
  readonly total: number
  readonly blockedAtStart: number
  readonly sent: number
  readonly blocked: number
  readonly failed: number
  /** Still to be written to: after the cursor, of the audience, the bot not blocked. */
  readonly left: number
  readonly finishedAt: Date | null
  readonly cancelledAt: Date | null
}

export interface ClaimedBatch {
  readonly id: number
  readonly text: string
  readonly recipients: readonly BroadcastRecipient[]
}

/**
 * How long a handed batch is not handed again (MOL-237): a batch of 25 goes in about a second, and
 * even every message of it waiting out a 429 to the cap of `deliver` is some four minutes. A bot
 * killed in the middle — a deploy past its grace period — leaves the batch to go again after this.
 */
export const BROADCAST_LEASE_SECONDS = 300

export interface BroadcastRepository {
  /** Per country of the audience, as of now: whom it would reach, whom the blocked bot would skip. */
  count(audience: BroadcastAudience): Promise<readonly AudienceCount[]>
  /**
   * Queues the message for the audience as of now: `going` while another broadcast to people is
   * under way (a second `--yes` would write to everybody twice), `nobody` when no one would get it.
   * The try on the owner alone is never `going`.
   */
  queue(text: string, audience: BroadcastAudience): Promise<QueuedBroadcast | 'going' | 'nobody'>
  /**
   * The next batch of the oldest broadcast going — the owner's try first — leased for
   * `BROADCAST_LEASE_SECONDS`: up to `limit` people after the cursor in the order of `actors.id`,
   * created before the broadcast, of its countries, the bot not blocked. A broadcast with nobody left
   * is finished here. `owner` is whom the try on the owner goes to; without one it reaches nobody.
   */
  claim(owner: TelegramUserId | null, limit: number): Promise<ClaimedBatch | null>
  /**
   * The bot's word on a batch: everybody up to `through` is done, with these outcomes. Moves the
   * cursor only forwards, so a late or repeated word changes nothing; lets the lease go — and only
   * that when nothing of the batch went (`through: null`), so it goes again the next minute.
   */
  done(report: BroadcastDone): Promise<void>
  /**
   * The latest broadcast to people, and the owner's try after it when there is a newer one — a try
   * queued while people are written to must not hide how far that got. Empty when there never was one.
   */
  status(owner: TelegramUserId | null): Promise<readonly BroadcastStatus[]>
  /** Stops every broadcast going: nothing more is handed. How many were stopped. */
  cancel(): Promise<number>
}

/**
 * The nearest live `actors.id` at or below `at`, or `BROADCAST_START`: the same people stand after
 * it as after `at`, and it never names someone erased (MOL-237). Erasure puts a cursor here too.
 */
export function cursorAtOrBelow(at: SQL): SQL {
  return sql`coalesce(
    (select a.id from actors a where a.id <= ${at} order by a.id desc limit 1),
    ${BROADCAST_START}::uuid)`
}

/** One lock for queueing: the check for a broadcast going and the insert must not interleave. */
const QUEUE_LOCK = sql`select pg_advisory_xact_lock(hashtextextended('molvia:broadcasts', 0))`

function audienceWhere(audience: BroadcastAudience): SQL | undefined {
  switch (audience.to) {
    case 'everybody':
      return undefined
    case 'countries':
      return inArray(actors.country, [...audience.countries])
    case 'owner':
      return sql`${actors.telegramUserId} = ${audience.owner}`
  }
}

/**
 * Who of `actors a` a stored broadcast `b` still goes to: after its cursor, created before it, of its
 * audience, the bot not blocked. Read from the broadcast's own row, so the claim and the count of
 * what is left are one rule.
 */
function stillDue(owner: TelegramUserId | null): SQL {
  return sql`a.id > b.cursor
    and a.created_at <= b.created_at
    and (b.countries is null or a.country = any(b.countries))
    and (not b.owner_only or a.telegram_user_id = ${owner ?? 0})
    and a.bot_blocked_at is null`
}

export function createBroadcastRepository(db: Conn): BroadcastRepository {
  async function countOf(conn: Conn, audience: BroadcastAudience) {
    const rows = await conn
      .select({
        country: actors.country,
        recipients: sql<number>`count(*) filter (where ${actors.botBlockedAt} is null)::int`,
        blocked: sql<number>`count(*) filter (where ${actors.botBlockedAt} is not null)::int`,
      })
      .from(actors)
      .where(audienceWhere(audience))
      .groupBy(actors.country)
      .orderBy(actors.country)
    // A country asked for and holding nobody is said as nobody, not left out.
    const named = audience.to === 'countries' ? audience.countries : []
    const missing = named
      .filter((country) => !rows.some((row) => row.country === country))
      .map((country) => ({ country, recipients: 0, blocked: 0 }))
    return [...rows, ...missing].sort((a, b) => a.country.localeCompare(b.country))
  }

  return {
    async count(audience) {
      return countOf(db, audience)
    },

    async queue(text, audience) {
      return db.transaction(async (tx) => {
        await tx.execute(QUEUE_LOCK)
        if (audience.to !== 'owner') {
          const [going] = await tx
            .select({ n: count() })
            .from(broadcasts)
            .where(
              and(
                isNull(broadcasts.finishedAt),
                isNull(broadcasts.cancelledAt),
                sql`not ${broadcasts.ownerOnly}`,
              ),
            )
          if ((going?.n ?? 0) > 0) return 'going'
        }
        const counts = await countOf(tx, audience)
        const total = counts.reduce((sum, row) => sum + row.recipients, 0)
        if (total === 0) return 'nobody'
        const [row] = await tx
          .insert(broadcasts)
          .values({
            text,
            countries: audience.to === 'countries' ? [...audience.countries] : null,
            ownerOnly: audience.to === 'owner',
            // the database's clock, which `actors.created_at` is written by
            createdAt: sql`clock_timestamp()`,
            total,
            blockedAtStart: counts.reduce((sum, count) => sum + count.blocked, 0),
          })
          .returning({
            id: broadcasts.id,
            total: broadcasts.total,
            blocked: broadcasts.blockedAtStart,
          })
        if (!row) throw new Error('a write to broadcasts returned no row')
        return { id: row.id, total: row.total, blockedAtStart: row.blocked }
      })
    },

    async claim(owner, limit) {
      return db.transaction(async (tx) => {
        // A broadcast with nobody left is finished and the next one looked at; two is enough for
        // the owner's try and one to people, and the next minute takes what is left.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const [broadcast] = await tx.execute<{ id: string; text: string }>(sql`
            select id, text from broadcasts
            where finished_at is null and cancelled_at is null
              and (lease_until is null or lease_until < clock_timestamp())
            order by owner_only desc, id
            limit 1
            for update skip locked`)
          if (!broadcast) return null
          const id = Number(broadcast.id)
          const people = await tx.execute<{ id: string; telegram_user_id: string }>(sql`
            select a.id, a.telegram_user_id from actors a, broadcasts b
            where b.id = ${id} and ${stillDue(owner)}
            order by a.id
            limit ${rowLimit(limit)}`)
          if (people.length === 0) {
            await tx.execute(sql`
              update broadcasts set finished_at = clock_timestamp(), lease_until = null
              where id = ${id}`)
            continue
          }
          await tx.execute(sql`
            update broadcasts
            set lease_until = clock_timestamp() + make_interval(secs => ${BROADCAST_LEASE_SECONDS})
            where id = ${id}`)
          return {
            id,
            text: broadcast.text,
            recipients: [...people].map((person) => ({
              // `bigint` comes back as text from a statement drizzle does not map.
              telegramUserId: Number(person.telegram_user_id),
              position: person.id,
            })),
          }
        }
        return null
      })
    },

    async done({ id, through, sent, blocked, failed }) {
      if (through === null) {
        await db.execute(sql`update broadcasts set lease_until = null where id = ${id}`)
        return
      }
      // The row first, then the cursor in a statement of its own (adversarial А2): erasure locks the
      // row before it deletes the person, so whichever comes second sees the other committed — an
      // `update` waiting for the row would have computed the cursor from before the erasure and
      // written the erased id back. Read committed: the second statement takes a fresh snapshot.
      await db.transaction(async (tx) => {
        await tx.execute(sql`select 1 from broadcasts where id = ${id} for update`)
        await tx.execute(sql`
          update broadcasts
          set cursor = ${cursorAtOrBelow(sql`${through}::uuid`)},
              sent = sent + ${sent}, blocked = blocked + ${blocked}, failed = failed + ${failed},
              lease_until = null
          where id = ${id} and cursor < ${through}::uuid`)
      })
    },

    async status(owner) {
      const [people] = await db
        .select()
        .from(broadcasts)
        .where(sql`not ${broadcasts.ownerOnly}`)
        .orderBy(desc(broadcasts.id))
        .limit(1)
      const [tried] = await db
        .select()
        .from(broadcasts)
        .where(sql`${broadcasts.ownerOnly}`)
        .orderBy(desc(broadcasts.id))
        .limit(1)
      const rows = [people, tried && (!people || tried.id > people.id) ? tried : undefined].filter(
        (row) => row !== undefined,
      )
      return Promise.all(
        rows.map(async (row) => {
          const [left] = await db.execute<{ n: number }>(sql`
            select count(*)::int as n from actors a, broadcasts b
            where b.id = ${row.id} and ${stillDue(owner)}`)
          return {
            id: row.id,
            ownerOnly: row.ownerOnly,
            countries: row.countries,
            createdAt: row.createdAt,
            total: row.total,
            blockedAtStart: row.blockedAtStart,
            sent: row.sent,
            blocked: row.blocked,
            failed: row.failed,
            left: row.finishedAt === null ? (left?.n ?? 0) : 0,
            finishedAt: row.finishedAt,
            cancelledAt: row.cancelledAt,
          }
        }),
      )
    },

    async cancel() {
      const stopped = await db
        .update(broadcasts)
        .set({ cancelledAt: sql`clock_timestamp()`, leaseUntil: null })
        .where(and(isNull(broadcasts.finishedAt), isNull(broadcasts.cancelledAt)))
        .returning({ id: broadcasts.id })
      return stopped.length
    },
  }
}
