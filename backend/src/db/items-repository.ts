import { randomUUID } from 'node:crypto'
import { asc, eq, inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { itemSchema, toSearchKey } from '@molvia/model'
import type { Item, NewItem } from '@molvia/model'
import { quantityFrom, quantityTo } from './columns'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, rowLimit, theRow } from './rows'
import { itemBarcodes, items } from './schema'

export interface ItemRepository {
  /** `createdBy` is null for a seeded item — it belongs to nobody. */
  create(input: NewItem, createdBy: string | null): Promise<Item>
  byId(id: string): Promise<Item | null>
  byIds(ids: readonly string[]): Promise<Item[]>
  /**
   * The catalogue lookup behind «что взяли?». No owner in the signature on purpose: the
   * catalogue is shared by everyone, so this is the one listing of 0.1 without an `actorId`.
   */
  search(query: string, limit: number): Promise<Item[]>
}

/**
 * The lowest `word_similarity` a candidate may score. Not 0.3, which the plan once said: a
 * two-vowel typo — «малако» against «Молоко Ашхар» — scores 0.167 and at 0.3 never even
 * becomes a candidate, so ranking has nothing to rank. Measured in MOL-10; tuning it on a
 * real catalogue is MOL-14's.
 */
const CANDIDATE_THRESHOLD = 0.15

/** The edit distance at which a name still counts as the one asked for. MOL-14 retunes it. */
const ACCEPTED_DISTANCE = 2

/**
 * A word grounds a match only if it has this many characters and no digit. Short words and
 * anything with a digit are the packaging size — «1 л», «1л», «500г», «3.2%» — they refine
 * the ranking but never ground it, otherwise «32» finds every name that carries those
 * digits, and «1л» measured against «moloko» alone costs six and loses «Молоко 1 л».
 */
const SHORT_WORD = 2

/**
 * How many words of a query are looked at. Every query word is compared with every word of
 * every candidate, so the cost grows with the query — 42 KB of it held a connection for
 * three seconds. No name on a shelf needs more words than this to be found.
 */
const MAX_QUERY_WORDS = 12

const HAS_CONTENT = /[\p{L}\p{N}]/u

type ItemRow = typeof items.$inferSelect

/**
 * The only place a name is written — and the key is taken right here, not by the caller.
 * MOL-5 left this to the repository because the column does not fill itself, and MOL-6
 * found the wider hole: on a *rename* the key goes stale silently, with no error and no log
 * line. There is deliberately no method that takes a name past this function, so a rename
 * would have to come through it too.
 */
function nameColumns(name: string) {
  return { name, searchKey: toSearchKey(name) }
}

function toItem(row: ItemRow, barcodes: readonly string[]): Item {
  return itemSchema.parse({
    ...row,
    barcodes,
    typicalQuantity: quantityFrom(row.typicalQtyMilli, row.typicalQtyUnit),
  })
}

/**
 * The ranking query, apart from the method so the test that reads its plan runs this very
 * statement and not a copy that could drift from it.
 */
export function rankedCandidates(key: string, limit: number): SQL {
  return sql`
    with query_words as (
      -- Cut to 255 here, once: levenshtein refuses longer arguments, and the prefix arm below
      -- cuts the name to the length of the query word, not to 255.
      select left(word, 255) as q,
             length(word) >= ${SHORT_WORD} and word !~ '[0-9]' as grounds,
             word ~ '[^0-9]' as lettered,
             n = max(n) over () as last
      from unnest(string_to_array(${key}, ' ')) with ordinality as t(word, n)
    ),
    candidates as (
      -- The column goes first, and that is not style: \`search_key %> $1\` is the only form
      -- the GIN index serves. \`$1 %> search_key\`, \`search_key <% $1\` and
      -- \`word_similarity($1, search_key) > t\` mean the same and all fall back to a Seq Scan
      -- — invisible on a test's handful of rows, fatal on a catalogue. The equality arm is
      -- served by the same index and finds a name made of short words only («M&M's» is
      -- \`m m s\`), which has no word to ground a match by distance.
      select ${items.id} as id,
             ${items.searchKey} as search_key,
             word_similarity(${key}, ${items.searchKey}) as ws
      from ${items}
      where ${items.searchKey} %> ${key} or ${items.searchKey} = ${key}
      -- Every candidate is ranked, with no ceiling. Any cut here is wrong in one of two ways:
      -- ordered by similarity it drops the typo the low threshold exists for (two hundred
      -- «Малина» pushed out the milk), unordered it drops by row age — the newest items, the
      -- very ones «Предложить товар» just added. \`order by id\` is worse still: the planner
      -- walks the primary key and filters every row. The cost is bounded by the catalogue and
      -- by MAX_QUERY_WORDS; measured in MOL-10, retuned on a real catalogue in MOL-14.
    ),
    per_word as (
      select c.id, qw.grounds, qw.lettered,
             (
               select min(
                 -- The screen searches while the person types, so the last word is usually
                 -- unfinished: it may also match the start of a name word. Exactly at two or
                 -- three letters, one edit from four, two from seven — a looser prefix of
                 -- two letters would match every word there is.
                 case when qw.last
                        and length(w) > length(qw.q)
                        and levenshtein(qw.q, left(w, length(qw.q))) <= (length(qw.q) - 1) / 3
                      then levenshtein(qw.q, left(w, length(qw.q)))
                      -- One word of a key can reach 600 characters. Cut, not skipped: such a
                      -- name is still an item.
                      else levenshtein(qw.q, left(w, 255))
                 end)
               from unnest(string_to_array(c.search_key, ' ')) as w
               -- A grounding word is measured against grounding words only: against «л» or
               -- «1» of a size every two-letter word is two edits away, inside the budget.
               where not qw.grounds or (length(w) >= ${SHORT_WORD} and w !~ '[0-9]')
             ) as qd
      from candidates c
      cross join query_words qw
    ),
    ranked as (
      select c.id, c.ws,
             case when c.search_key = ${key} then 0
                  -- Grounding words by their mean, rounded up: a correct extra word printed
                  -- on the package («пастеризованное») would cost 11 by the worst, 4 by the
                  -- mean. A name with no grounding word leaves qd null and never passes.
                  when bool_or(pw.grounds)
                  then ceil(avg(coalesce(pw.qd, 255)) filter (where pw.grounds))
                       -- Short words by their worst, at most one edit: each has to find its
                       -- pair, so «1 л» against «2 л» costs one where «л» alone would hide it.
                       + least(coalesce(max(pw.qd) filter (where not pw.grounds), 0), 1)
                  -- No grounding word, but letters: «M&M's» is \`m m s\`, «m&m» is what the
                  -- screen sends halfway through typing it. Every word has to be found
                  -- exactly (the last one by its start). Digits alone never get here.
                  when bool_or(pw.lettered) and max(coalesce(pw.qd, 255)) = 0 then 0
             end as distance
      from candidates c
      join per_word pw on pw.id = c.id
      group by c.id, c.ws, c.search_key
    )
    select id
    from ranked
    where distance <= ${ACCEPTED_DISTANCE}
    -- Ties stay ties («moloko» names «Ашхар» and «Марианна» alike); \`id\` only keeps two
    -- loads of one screen in one order. MOL-11 lifts a remembered pick before \`ws\`.
    order by distance, ws desc, id
    limit ${limit}
  `
}

export function createItemRepository(db: Conn): ItemRepository {
  /** One query for the items and one for every barcode of them — never one per item. */
  async function load(ids: readonly string[]): Promise<Item[]> {
    // A malformed identifier matches nothing and would meet `22P02` — a 500 where «nothing
    // found» is the honest answer — so it is dropped before the query rather than sent.
    const known = ids.map(idOrNull).filter((id): id is string => id !== null)
    if (known.length === 0) return []

    // Ordered by id rather than left to the planner: a read whose order depends on the
    // physical layout is a test that passes until it does not.
    const rows = await db
      .select()
      .from(items)
      .where(inArray(items.id, known))
      .orderBy(asc(items.id))
    if (rows.length === 0) return []

    const codes = await db
      .select()
      .from(itemBarcodes)
      .where(
        inArray(
          itemBarcodes.itemId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(itemBarcodes.code))

    const byItem = new Map<string, string[]>()
    for (const { itemId, code } of codes) {
      const known = byItem.get(itemId)
      if (known) known.push(code)
      else byItem.set(itemId, [code])
    }

    return rows.map((row) => toItem(row, byItem.get(row.id) ?? []))
  }

  return {
    async create(input, createdBy) {
      const typical = quantityTo(input.typicalQuantity)

      // Both tables or neither: an item whose barcodes failed to land is an item nobody can
      // scan, and it would look exactly like one that never had any.
      return translateFailures(async () =>
        db.transaction(async (tx) => {
          const id = randomUUID()
          const [row] = await tx
            .insert(items)
            .values({
              id,
              kind: input.kind,
              ...nameColumns(input.name),
              note: input.note ?? null,
              defaultUnit: input.defaultUnit,
              typicalQtyMilli: typical.milli,
              typicalQtyUnit: typical.unit,
              createdBy,
            })
            .returning()

          if (input.barcodes.length > 0) {
            await tx
              .insert(itemBarcodes)
              .values(input.barcodes.map((code) => ({ code, itemId: id })))
          }

          // Sorted the way a later read returns them, so create and read agree.
          return toItem(theRow(row, 'items'), [...input.barcodes].sort())
        }),
      )
    },

    async byId(id) {
      if (idOrNull(id) === null) return null

      const [row] = await db.select().from(items).where(eq(items.id, id)).limit(1)
      if (!row) return null

      const codes = await db
        .select()
        .from(itemBarcodes)
        .where(eq(itemBarcodes.itemId, id))
        .orderBy(asc(itemBarcodes.code))

      return toItem(
        row,
        codes.map((code) => code.code),
      )
    },

    byIds: load,

    async search(query, limit) {
      // The same function the name went through on write: the key is compared with itself.
      const key = toSearchKey(query).split(' ').slice(0, MAX_QUERY_WORDS).join(' ')
      // Not only the empty key: for punctuation `toSearchKey` falls back to the punctuation
      // itself, which has no trigrams and no words — nothing to look for, so no round trip.
      if (!HAS_CONTENT.test(key)) return []

      const ids = await db.transaction(async (tx) => {
        /*
         * The threshold of `%>` is a setting of the connection, not a value in the query —
         * `set_limit()` governs `%` and leaves this one at its default of 0.6. Connections
         * live in a pool, so a plain SET would leak into whatever runs on this connection
         * next. `set_config(…, true)` is SET LOCAL in a form that takes a bound parameter.
         *
         * Local to the *transaction*, though, not to this block: handed a caller's
         * transaction, `db.transaction` is a savepoint, and the setting would outlive it and
         * change the caller's own `%>`. So the previous value is read first and put back.
         */
        const [previous] = await tx.execute<{ threshold: string }>(
          sql`select current_setting('pg_trgm.word_similarity_threshold') as threshold`,
        )
        await tx.execute(
          sql`select set_config('pg_trgm.word_similarity_threshold', ${String(CANDIDATE_THRESHOLD)}, true)`,
        )

        const rows = await tx.execute<{ id: string }>(rankedCandidates(key, rowLimit(limit)))

        await tx.execute(
          sql`select set_config('pg_trgm.word_similarity_threshold', ${previous?.threshold ?? '0.6'}, true)`,
        )
        return rows.map((row) => row.id)
      })

      // `load` answers in id order; the ranking is this query's, so it is restored here.
      const found = new Map((await load(ids)).map((item) => [item.id, item]))
      return ids.flatMap((id) => found.get(id) ?? [])
    },
  }
}
