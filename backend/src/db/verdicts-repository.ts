import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { DomainError, ERROR, verdictSchema } from '@molvia/model'
import type { NewVerdict, Verdict, VerdictPatch } from '@molvia/model'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, rowLimit } from './rows'
import { items, verdicts } from './schema'

export interface Put {
  readonly verdict: Verdict
  /**
   * `true` when the person had no verdict here before — none at all, or one they withdrew:
   * rating again after taking it back is a new opinion to them, whatever the row says.
   */
  readonly created: boolean
}

export interface VerdictRepository {
  /** Rating and re-rating are the same call: the second one replaces the first opinion. */
  put(actorId: string, input: NewVerdict): Promise<Put>
  /**
   * Changes part of the person's verdict on a product; `review: null` erases the text, which
   * `put` cannot do. `null` when there is nothing of theirs to change — none, withdrawn, or
   * someone else's, answered alike.
   */
  amend(actorId: string, itemId: string, patch: VerdictPatch): Promise<Verdict | null>
  /**
   * Takes the person's verdict on a product back. The row stays, for the 0.2 gate only
   * (schema, `deleted_at`); the text goes. `false` when there was nothing of theirs to take.
   */
  withdraw(actorId: string, itemId: string): Promise<boolean>
  forItem(actorId: string, itemId: string, placeId: string | null): Promise<Verdict | null>
  /**
   * Everything this person has rated. «Что брать» groups these into three by `verdictLevel`
   * — the thresholds stay in the domain, so the query carries no product decision.
   */
  listFor(actorId: string, limit: number): Promise<Verdict[]>
}

/**
 * The shape both paths produce: the builder maps columns, and the raw statement aliases them.
 * `db.execute` is handed it intersected with `Record<string, unknown>`, which is the
 * constraint that method declares — an interface carries no implicit index signature of its
 * own, and giving it one would let a misspelled field through unnoticed.
 */
interface VerdictShape {
  id: string
  actorId: string
  itemId: string
  placeId: string | null
  score: number
  review: string | null
  ratedAt: Date | string
  updatedAt: Date | string
}

/**
 * Raw SQL bypasses drizzle's per-column mapping. The postgres-js client it configures hands
 * timestamps over as strings and lets each column definition turn them into dates, so the
 * builder path arrives with a `Date` and `db.execute` with a string. Normalised in one place
 * rather than in the statement, because no cast in SQL can produce a JavaScript date.
 */
function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function toVerdict(row: VerdictShape): Verdict {
  return verdictSchema.parse({
    ...row,
    ratedAt: asDate(row.ratedAt),
    updatedAt: asDate(row.updatedAt),
  })
}

export function createVerdictRepository(db: Conn): VerdictRepository {
  return {
    async put(actorId, input) {
      const placeId = input.placeId ?? null

      /*
       * Raw SQL, and one statement on purpose.
       *
       * `item_kind` is a copy of the item's kind held true by a composite foreign key. The
       * client cannot name it — `newVerdictSchema` is shape only — and fetching it first
       * would leave a window in which the kind has already changed, so it is selected from
       * the catalogue inside the very statement that writes the verdict. An item that is not
       * there yields no rows, which is the only reason this can come back empty.
       *
       * `ON CONFLICT (actor_id, item_id, place_id)` lands on `NULLS NOT DISTINCT` even when
       * the place is empty — verified in MOL-6 — so a re-rating replaces the opinion instead
       * of adding a second vote. `rated_at` is deliberately left alone and `updated_at` is
       * not mentioned at all: the trigger moves it, which is what leaves the trace.
       */
      const rows = await translateFailures(async () =>
        db.execute<VerdictShape & { created: boolean } & Record<string, unknown>>(sql`
          with prior as (
            select deleted_at
            from ${verdicts}
            where actor_id = ${actorId}::uuid
              and item_id = ${input.itemId}::uuid
              and place_id is not distinct from ${placeId}::uuid
          )
          insert into ${verdicts} (id, actor_id, item_id, item_kind, place_id, score, review)
          select
            ${randomUUID()}::uuid,
            ${actorId}::uuid,
            ${input.itemId}::uuid,
            ${items.kind},
            ${placeId}::uuid,
            ${input.score}::smallint,
            ${input.review ?? null}::varchar
          from ${items}
          where ${items.id} = ${input.itemId}::uuid
          on conflict (actor_id, item_id, place_id) do update
            set score = excluded.score,
                review = coalesce(excluded.review, ${verdicts}.review),
                deleted_at = null
          returning
            id,
            actor_id as "actorId",
            item_id as "itemId",
            place_id as "placeId",
            score,
            review,
            rated_at as "ratedAt",
            updated_at as "updatedAt",
            (xmax = 0 or (select deleted_at from prior) is not null) as created
        `),
      )

      /*
       * Rating again after a withdrawal lands on the same row — the uniqueness holds withdrawn
       * rows too — and brings it back: `deleted_at` is cleared, `rated_at` stays, because
       * taking a verdict back and giving it again must not move anyone in the 0.2 gate. The old
       * text cannot return through `coalesce`: a withdrawn row has none (CHECK).
       *
       * `created` needs the row as it was, and Postgres 17 has no `OLD` in `RETURNING`, so
       * `prior` reads it in the same statement. `xmax = 0` is the insert: an update through
       * `ON CONFLICT` leaves the locking transaction there. Two ratings racing over one
       * withdrawn row may both say «created» — the row is one either way.
       *
       * `coalesce` above, and not `excluded.review`, because `review` is optional in the
       * input: a person who changes the score and says nothing about the text sends no
       * review at all, and `excluded.review` is then NULL. Overwriting with it erased what
       * they had written — silently, with no error and nothing to restore it from.
       *
       * The cost is that `put` cannot clear a review, only replace it. That is the truth of
       * the input rather than a limitation invented here: `NewVerdict.review` is optional,
       * not nullable, so «no text» and «erase the text» are the same message. Clearing needs
       * a patch method, and 0.1 has no screen that asks for one.
       */
      const row = rows[0]
      // No rows means the catalogue has no such item — the select found nothing to copy the
      // kind from. A mismatch between kind and place is a different thing: the CHECK refuses
      // it, and that refusal is left untranslated on purpose (the use case must catch it
      // first, so reaching the database with it is a defect in this server).
      if (!row) throw new DomainError(ERROR.NOT_FOUND)
      const { created, ...verdict } = row
      return { verdict: toVerdict(verdict), created }
    },

    async amend(actorId, itemId, patch) {
      if (idOrNull(actorId) === null || idOrNull(itemId) === null) return null

      // `review` is changed only when the patch names it: absent keeps the text, `null`
      // erases it. The domain refuses an empty patch, so `set` is never empty here.
      const set: Partial<typeof verdicts.$inferInsert> = {}
      if (patch.score !== undefined) set.score = patch.score
      if (patch.review !== undefined) set.review = patch.review

      const [row] = await db
        .update(verdicts)
        .set(set)
        .where(
          and(
            eq(verdicts.actorId, actorId),
            eq(verdicts.itemId, itemId),
            // Products only until 0.3 — the path names an item, and a product has no place.
            isNull(verdicts.placeId),
            isNull(verdicts.deletedAt),
          ),
        )
        .returning()
      return row ? toVerdict(row) : null
    },

    async withdraw(actorId, itemId) {
      if (idOrNull(actorId) === null || idOrNull(itemId) === null) return false

      const withdrawn = await db
        .update(verdicts)
        // The text is erased with the withdrawal: whoever deletes a review expects it gone,
        // and the gate needs only that the row existed and when. A CHECK holds the pair.
        .set({ deletedAt: sql`clock_timestamp()`, review: null })
        .where(
          and(
            eq(verdicts.actorId, actorId),
            eq(verdicts.itemId, itemId),
            isNull(verdicts.placeId),
            // A second withdrawal finds nothing: the first one's time is the one that stands.
            isNull(verdicts.deletedAt),
          ),
        )
        .returning({ id: verdicts.id })
      return withdrawn.length > 0
    },

    async forItem(actorId, itemId, placeId) {
      // A malformed identifier can match no row, and Postgres would answer `22P02` — a 500
      // for what is plainly «nothing found», and a third distinct reply where the whole
      // point is that a stranger's row and a missing row look the same.
      if (idOrNull(actorId) === null || idOrNull(itemId) === null) return null
      if (placeId !== null && idOrNull(placeId) === null) return null

      const [row] = await db
        .select()
        .from(verdicts)
        .where(
          and(
            eq(verdicts.actorId, actorId),
            eq(verdicts.itemId, itemId),
            // A product is rated as itself and carries no place, so the empty place is a
            // value here, not a missing filter.
            placeId === null ? isNull(verdicts.placeId) : eq(verdicts.placeId, placeId),
            isNull(verdicts.deletedAt),
          ),
        )
        .limit(1)
      return row ? toVerdict(row) : null
    },

    async listFor(actorId, limit) {
      if (idOrNull(actorId) === null) return []
      const rows = await db
        .select()
        .from(verdicts)
        // A withdrawn verdict is kept for the gate only (schema, `deleted_at`).
        .where(and(eq(verdicts.actorId, actorId), isNull(verdicts.deletedAt)))
        .orderBy(desc(verdicts.updatedAt), desc(verdicts.id))
        .limit(rowLimit(limit))
      return rows.map(toVerdict)
    },
  }
}
