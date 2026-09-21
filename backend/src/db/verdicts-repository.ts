import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { DomainError, ERROR, verdictSchema } from '@molvia/model'
import type { AdviceScope, NewVerdict, Verdict, VerdictPatch } from '@molvia/model'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, rowLimit } from './rows'
import { items, verdicts } from './schema'

export interface RatedVerdict {
  readonly verdict: Verdict
  /**
   * `true` when the person had no verdict here before — none at all, or one they withdrew:
   * rating again after taking it back is a new opinion to them, whatever the row says.
   */
  readonly created: boolean
}

export interface VerdictRepository {
  /** Rating and re-rating are the same call: the second one replaces the first opinion. */
  put(actorId: string, input: NewVerdict): Promise<RatedVerdict>
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
  /**
   * The rated rows of «Что брать» (MOL-31), already reduced to the pair every product rule
   * takes: a sum of scores and how many people are behind it. `verdictLevel` and
   * `averageScore` read exactly that pair, so the query decides nothing — it is handed
   * `minContributions` rather than knowing it.
   *
   * In the own mode only this person's verdicts take part, so the pair is their own score
   * over one. In the shared mode everyone's do — but a row whose people are fewer than
   * `minContributions` falls back to this person's own figures (Р-16): showing an average
   * over two hands the other person's score to whoever knows their own, and showing a
   * stranger's lone verdict hands over all of it.
   *
   * Products only: a dish is rated where it was served, and 0.1 has no dishes.
   */
  adviceRowsFor(query: AdviceQuery): Promise<AdviceRows>
}

/**
 * The page of rows the screen gets, and how many there are in all. The total is counted over
 * the same rows in the same statement, before the limit applies: a second query could see a
 * verdict the first did not, and the counter would disagree with the page it came with.
 */
export interface AdviceRows {
  readonly rows: AdviceVerdictRow[]
  readonly total: number
}

/** What «Что брать» asks the verdicts for. */
export interface AdviceQuery {
  readonly actorId: string
  readonly scope: AdviceScope
  /** The domain's number (`AGGREGATE_MIN_CONTRIBUTIONS`), never this file's. */
  readonly minContributions: number
  /**
   * The domain's `NEVER_BELOW_TENTHS`: below this average, in tenths, a row is «не брать
   * нигде». The statement uses it for one thing only — to decide what the limit may not cut
   * (Р-23) — and holds no threshold of its own.
   */
  readonly neverBelowTenths: number
  readonly limit: number
}

/**
 * One item of «Что брать», before prices join it. Not a domain entity: an aggregate of
 * verdicts has no identity and is never written back.
 */
export interface AdviceVerdictRow {
  readonly itemId: string
  readonly name: string
  /** The sum of the scores the row is entitled to show, and how many of them there are. */
  readonly sum: number
  readonly count: number
  /**
   * This person's own review, and only ever theirs. A review is words, not an aggregate:
   * there is nothing in it to average and nothing to hide behind, so someone else's text
   * stays theirs until a release decides otherwise (MOL-31, Р-19).
   */
  readonly review: string | null
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
       * Raw SQL, and one write statement on purpose.
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
      const written = await translateFailures(async () =>
        db.transaction(async (tx) => {
          /*
           * The row as it stands *after* any withdrawal still in flight: `FOR UPDATE` waits
           * for its lock and then reads the latest version. Read from the statement's snapshot
           * instead — a CTE did that — a rating that queued behind an uncommitted withdrawal
           * brought the row back and answered «replaced», and two ratings over one withdrawn
           * row both answered «created» (adversarial pass, Б). Under the lock the second one
           * sees the row the first brought back.
           */
          const [prior] = await tx
            .select({ deletedAt: verdicts.deletedAt })
            .from(verdicts)
            .where(
              and(
                eq(verdicts.actorId, actorId),
                eq(verdicts.itemId, input.itemId),
                placeId === null ? isNull(verdicts.placeId) : eq(verdicts.placeId, placeId),
              ),
            )
            .for('update')

          const rows = await tx.execute<
            VerdictShape & { inserted: boolean } & Record<string, unknown>
          >(sql`
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
            xmax = 0 as inserted
        `)
          return { row: rows[0], withdrawn: prior !== undefined && prior.deletedAt !== null }
        }),
      )

      /*
       * Rating again after a withdrawal lands on the same row — the uniqueness holds withdrawn
       * rows too — and brings it back: `deleted_at` is cleared, `rated_at` stays, because
       * taking a verdict back and giving it again must not move anyone in the 0.2 gate. The old
       * text cannot return through `coalesce`: a withdrawn row has none (CHECK).
       *
       * `created` needs the row as it was, and Postgres 17 has no `OLD` in `RETURNING`, so
       * it is read under the lock above. `xmax = 0` is the insert: an update through
       * `ON CONFLICT` leaves the locking transaction there. With no row yet there is nothing
       * to lock, and two first ratings are settled by the conflict itself — one inserts.
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
      const { row, withdrawn } = written
      // No rows means the catalogue has no such item — the select found nothing to copy the
      // kind from. A mismatch between kind and place is a different thing: the CHECK refuses
      // it, and that refusal is left untranslated on purpose (the use case must catch it
      // first, so reaching the database with it is a defect in this server).
      if (!row) throw new DomainError(ERROR.NOT_FOUND)
      const { inserted, ...verdict } = row
      return { verdict: toVerdict(verdict), created: inserted || withdrawn }
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

    async adviceRowsFor({ actorId, scope, minContributions, neverBelowTenths, limit }) {
      if (idOrNull(actorId) === null) return { rows: [], total: 0 }

      /*
       * Raw SQL, and one statement: the choice between «everyone's figures» and «my own»
       * (Р-16) has to be made before the rows are ordered and cut, or the limit would drop
       * items by a rating they are not going to be shown with.
       *
       * The choice lives here rather than in the use case for the same reason the unit price
       * does in `expenses-repository`: made once, over the columns it is made of. What the
       * domain owns is the *numbers* — they arrive as parameters — and what it then does with
       * the pair: `verdictLevel` and `averageScore` read `sum` and `count` and nothing else.
       *
       * `count(distinct actor_id)`, not `count(*)`: a contribution is a person. One verdict
       * per person per product is already the uniqueness of the table, but the shape of this
       * aggregate must not depend on that — 0.3 adds dishes, where a place is part of the key.
       */
      const mine = sql`${verdicts.actorId} = ${actorId}::uuid`
      const rows = await db.execute<{
        itemId: string
        name: string
        sum: string
        count: string
        review: string | null
        total: string
      }>(sql`
        with rated as (
          select
            ${verdicts.itemId} as item_id,
            sum(${verdicts.score}) as score_sum,
            count(distinct ${verdicts.actorId}) as contributors,
            max(${verdicts.score}) filter (where ${mine}) as own_score,
            max(${verdicts.review}) filter (where ${mine}) as own_review
          from ${verdicts}
          -- A withdrawn verdict is kept for the 0.2 gate alone: it is nobody's opinion, so
          -- it is neither a score nor a contribution here.
          where ${verdicts.deletedAt} is null
            ${scope === 'own' ? sql`and ${mine}` : sql``}
          group by ${verdicts.itemId}
        ),
        shown as (
          select
            r.item_id,
            ${items.name} as name,
            case when r.contributors >= ${minContributions} then r.score_sum else r.own_score end
              as score_sum,
            case when r.contributors >= ${minContributions} then r.contributors else 1 end
              as contributors,
            r.own_review,
            r.own_score is not null as is_mine
          from rated r
          -- Not aliased: the column references above are written by drizzle and carry the
          -- table's own name, so an alias here would leave them pointing at nothing.
          join ${items} on ${items.id} = r.item_id and ${items.kind} = 'product'
          where r.contributors >= ${minContributions} or r.own_score is not null
        ),
        scored as (
          select
            shown.*,
            -- The same rounding the domain prints and groups by: half away from zero.
            round(score_sum * 10.0 / contributors) as tenths,
            count(*) over () as total
          from shown
        )
        select "itemId", name, sum, count, review, total
        from (
          select
            item_id as "itemId",
            name,
            score_sum::text as sum,
            contributors::text as count,
            own_review as review,
            total::text as total,
            -- ::numeric rather than a float: the order of a product decision must not depend
            -- on how two doubles compare.
            score_sum::numeric / contributors as rating,
            -- The name is compared in the root ICU collation, not the database's own. The
            -- database is created with en_US.utf8, where «Ёжик» lands before «Ежевика» and a
            -- name typed in lower case falls below every capitalised one — and the places
            -- inside a row were ordered by yet another alphabet, so one answer came back in
            -- two orders (adversarial round 1, F7). The root locale rather than ru-RU: this
            -- catalogue holds Russian, Armenian and Latin names, and no single language
            -- should decide for all three.
            name collate "und-x-icu" as sort_name
          from scored
          -- What the limit may not cut (Р-23): this person's own rows first, then «не брать
          -- нигде». The list is ordered by rating, so the worst lie at its end, and the limit
          -- used to eat exactly them — two hundred strangers' fives deleted the one warning
          -- the screen exists for (adversarial round 1, F8, and С-4 of the self-review).
          order by is_mine desc, (tenths < ${neverBelowTenths}) desc, rating desc, sort_name asc, item_id asc
          limit ${rowLimit(limit)}
        ) page
        -- And the page is shown by rating down, then by name (Р-6). Two orders on purpose:
        -- what must survive the cut is not what must stand at the top of the screen.
        order by rating desc, sort_name asc, "itemId" asc
      `)

      return {
        rows: rows.map((row) => ({
          itemId: row.itemId,
          name: row.name,
          // `sum` and `count` arrive as text: `sum()` over a smallint is a bigint, and the
          // driver hands those over as strings rather than risking a double.
          sum: Number(row.sum),
          count: Number(row.count),
          review: row.review,
        })),
        total: Number(rows[0]?.total ?? 0),
      }
    },
  }
}
