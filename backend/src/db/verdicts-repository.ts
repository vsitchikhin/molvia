import { randomUUID } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { DomainError, ERROR, verdictSchema } from '@molvia/model'
import type { NewVerdict, Verdict } from '@molvia/model'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { items, verdicts } from './schema'

export interface VerdictRepository {
  /** Rating and re-rating are the same call: the second one replaces the first opinion. */
  put(actorId: string, input: NewVerdict): Promise<Verdict>
  forItem(actorId: string, itemId: string, placeId: string | null): Promise<Verdict | null>
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
        db.execute<VerdictShape & Record<string, unknown>>(sql`
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
            set score = excluded.score, review = excluded.review
          returning
            id,
            actor_id as "actorId",
            item_id as "itemId",
            place_id as "placeId",
            score,
            review,
            rated_at as "ratedAt",
            updated_at as "updatedAt"
        `),
      )

      const row = rows[0]
      // No rows means the catalogue has no such item — the select found nothing to copy the
      // kind from. A mismatch between kind and place is a different thing: the CHECK refuses
      // it, and that refusal is left untranslated on purpose (the use case must catch it
      // first, so reaching the database with it is a defect in this server).
      if (!row) throw new DomainError(ERROR.NOT_FOUND)
      return toVerdict(row)
    },

    async forItem(actorId, itemId, placeId) {
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
          ),
        )
        .limit(1)
      return row ? toVerdict(row) : null
    },
  }
}
