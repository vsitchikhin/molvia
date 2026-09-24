import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { DomainError, ERROR, verdictSchema } from '@molvia/model'
import type { AdviceScope, NewVerdict, Verdict, VerdictPatch } from '@molvia/model'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, rowLimit } from './rows'
import { actors, items, verdicts } from './schema'

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
  /**
   * Gate 0.2: of those who appeared in `[from, to)`, how many gave `ratings` verdicts within
   * `windowHours` of appearing (MOL-49). A query over this table, never an event: the log
   * must not repeat what a domain table already knows.
   *
   * **The one reader that counts withdrawn verdicts.** The gate asks whether someone *gave*
   * five, and «rated five, took one back» is five (MOL-27, the owner's decision). Rating again
   * brings back the same row with its `rated_at`, so withdrawing and re-rating cannot move
   * anyone here, and one row per «actor + item + place» makes a re-rating one verdict.
   *
   * `from` is the release of 0.2, and the caller passes it: sign-in is open since 0.1, so the
   * people who arrived before there was anything of 0.2 to use would sit in the denominator
   * (MOL-51). And only those whose window has closed are counted — someone who came last week
   * has not failed to reach five, they have not had the time.
   *
   * **A verdict is dated by the server receiving it, and that bias is accepted** (adversarial
   * pass, А1; owner's decision 23.09.2026). «Сохранить» keeps it on the phone and the queue
   * sends it later — hours later with no signal or an expired session — so a fifth given in the
   * last hour of the second week can arrive in the third and not count. The error only ever
   * lowers the numerator, which is the gate erring towards «stop», the safe side, as with
   * Р-24. The device's clock is not an option: the plan keeps it out of the gates altogether.
   */
  reachedRatings(query: RatingsGateQuery): Promise<CohortReached>
}

/** What gate 0.2 asks: the domain's two numbers and the window of people it looks at. */
export interface RatingsGateQuery {
  readonly from: Date
  readonly to: Date
  /** The domain's `GATE_RATINGS`. */
  readonly ratings: number
  /** The domain's `GATE_RATINGS_WINDOW_HOURS`. */
  readonly windowHours: number
}

const INT4_MAX = 2 ** 31 - 1
const FIRST_READABLE = Date.parse('0001-01-01T00:00:00Z')
const PAST_READABLE = Date.parse('+010000-01-01T00:00:00Z')

export interface CohortReached {
  readonly cohortSize: number
  readonly reached: number
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
  /**
   * The domain's `ADVICE_WARNINGS_RESERVED`: how many of the rows are held for other people's
   * warnings (Р-25). Also only ever read by the cut.
   */
  readonly warningsReserved: number
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
  /**
   * Whether this person has a verdict of their own behind the row (MOL-32, А2). In the own
   * mode always true; in the shared one a row may be entirely other people's, and the screen
   * cannot tell — a review is empty there exactly as it is on one's own verdict without one.
   * Told apart, the sheet offers «Оценить» rather than «Изменить», and does not offer to
   * withdraw what was never given.
   */
  readonly isMine: boolean
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

    async adviceRowsFor({
      actorId,
      scope,
      minContributions,
      neverBelowTenths,
      warningsReserved,
      limit,
    }) {
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
        isMine: boolean
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
        ),
        ranked as (
          select
            scored.*,
            -- Where this row stands among other people's warnings, best first. Only the
            -- first warningsReserved of them are held back from the cut (Р-25); the rest
            -- take their chances on rating like everything else.
            row_number() over (
              partition by (tenths < ${neverBelowTenths} and not is_mine)
              order by score_sum::numeric / contributors desc, item_id
            ) as warning_rank
          from scored
        )
        select "itemId", name, sum, count, review, "isMine", total
        from (
          select
            item_id as "itemId",
            name,
            score_sum::text as sum,
            contributors::text as count,
            own_review as review,
            -- Already computed above for the warnings reserve; handed out since MOL-32 so the
            -- screen knows whose verdict it is looking at.
            is_mine as "isMine",
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
          from ranked
          /*
           * What the limit may not cut (Р-23). The list is ordered by rating, so the worst lie
           * at its end, and the limit used to eat exactly them — two hundred strangers' fives
           * deleted the one warning the screen exists for (adversarial round 1, F8).
           *
           * Three tiers, in this order (Р-25):
           *   1. other people's «не брать нигде», up to warningsReserved of them,
           *   2. this person's own rows,
           *   3. everything else, by rating.
           * The reserve goes first because tier 2 alone can fill the page, and then a
           * stranger's warning — the one thing the person could not have learnt themselves —
           * was the first row dropped (adversarial round 2, G2). It is a reserve and not a
           * reordering: warnings have no bound in the shared mode, and putting all of them
           * above tier 2 returned a page of two hundred warnings and no recommendation at all.
           */
          order by
            (tenths < ${neverBelowTenths} and not is_mine and warning_rank <= ${warningsReserved}) desc,
            is_mine desc,
            (tenths < ${neverBelowTenths}) desc,
            rating desc, sort_name asc, item_id asc
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
          isMine: row.isMine,
        })),
        total: Number(rows[0]?.total ?? 0),
      }
    },

    async reachedRatings({ from, to, ratings, windowHours }) {
      // Refused loudly rather than answered: a fractional window is a Postgres error, and zero
      // or a negative number gives a figure that looks true — nobody «reaches» zero through a
      // join, a negative window takes in people who have not come yet (adversarial pass, А2).
      // The domain's constants always pass; a first caller with input from outside may not.
      // So is what Postgres cannot read: past `int4`, or outside the years 1–9999 that
      // `toISOString` writes in the form a `timestamptz` accepts (adversarial round 2, Б1, Б2).
      const whole = (n: number) => Number.isInteger(n) && n > 0 && n <= INT4_MAX
      const readable = (d: Date) => d.getTime() >= FIRST_READABLE && d.getTime() < PAST_READABLE
      if (
        !whole(ratings) ||
        !whole(windowHours) ||
        !readable(from) ||
        !readable(to) ||
        !(from.getTime() < to.getTime())
      ) {
        throw new RangeError(
          `reachedRatings: ratings ${String(ratings)}, window ${String(windowHours)}h, [${String(from)}, ${String(to)})`,
        )
      }

      // Counted from `actors.created_at`, in hours, as gate 0.3 counts its weeks: both halves
      // of the gates stand on one axis, and hours mean the same in every time zone.
      const rows = await db.execute<{ cohort_size: number; reached: number }>(sql`
        with cohort as (
          select ${actors.id} as actor_id, ${actors.createdAt} as started
          from ${actors}
          where ${actors.createdAt} >= ${from.toISOString()}::timestamptz
            and ${actors.createdAt} <  ${to.toISOString()}::timestamptz
            -- A window still open is no answer yet: counted now, a person who came last week
            -- reads as one who failed, and the gate errs towards «stop» for no reason.
            and ${actors.createdAt} + make_interval(hours => ${windowHours}::int) <= now()
        ),
        reached as (
          select c.actor_id
          from cohort c
          join ${verdicts} v on v.actor_id = c.actor_id
          where v.rated_at < c.started + make_interval(hours => ${windowHours}::int)
            -- No deleted_at filter: the gate is the one reader that counts withdrawn
            -- verdicts (MOL-27). Every other reader of this table must have it.
          group by c.actor_id
          having count(*) >= ${ratings}::int
        )
        select
          (select count(*) from cohort)::int as cohort_size,
          (select count(*) from reached)::int as reached
      `)

      const row = rows[0]
      return { cohortSize: row?.cohort_size ?? 0, reached: row?.reached ?? 0 }
    },
  }
}
