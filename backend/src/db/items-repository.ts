import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { itemSchema, nameIdentity, toSearchKey } from '@molvia/model'
import type { Item, NewItem } from '@molvia/model'
import { quantityFrom, quantityTo } from './columns'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, rowLimit, theRow } from './rows'
import { itemBarcodes, items, searchPicks } from './schema'

export interface ItemRepository {
  /** `createdBy` is null for a seeded item — it belongs to nobody. */
  create(input: NewItem, createdBy: string | null): Promise<Item>
  byId(id: string): Promise<Item | null>
  byIds(ids: readonly string[]): Promise<Item[]>
  /**
   * «Предложить товар»: the item of this kind with the same name (`nameIdentity` — case and
   * spacing aside), or a new one. Check and insert happen under one lock per name, so a double
   * tap — two requests at once — cannot put a second «Сыр чанах» beside the first.
   *
   * By the name, not by the search key: the key folds on purpose, and a false merge that costs
   * the search a candidate would cost this path the item itself — «Milo» would be answered
   * with the «Мыло» already there, and could never be added. Merging what is merely similar
   * is 0.2's.
   */
  createUnlessNamed(input: NewItem, createdBy: string): Promise<{ item: Item; created: boolean }>
  /**
   * The catalogue lookup behind «что взяли?». The catalogue is shared by everyone, so the
   * owner filters nothing: it only chooses whose remembered picks take part in the order.
   * Required rather than optional — a forgotten argument would switch the lift off silently,
   * and no test of the results would notice.
   */
  search(query: string, limit: number, actorId: string): Promise<Item[]>
}

/**
 * The lowest `word_similarity` a candidate may score. Not 0.3, which the plan once said: a
 * two-vowel typo — «малако» against «Молоко Ашхар» — scores 0.167 and at 0.3 never even
 * becomes a candidate, so ranking has nothing to rank. Measured in MOL-10 and kept by MOL-14:
 * 0.3 empties the false hits but loses that milk; 0.2 and 0.25 lose it too for one false hit
 * less.
 */
const CANDIDATE_THRESHOLD = 0.15

/**
 * The edit distance at which a name still counts as the one asked for. Kept by MOL-14: 1 loses
 * five typos of the MOL-5 corpus and «собачий корм», 3 wins one query of the owner's and finds
 * six more wrong items. A word wrong from end to end still fits in two — MOL-46.
 */
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

/**
 * A remembered query counts as the one being typed when every word but the last is equal and
 * one last word is the start of the other — the screen searches while the person types, so
 * the pick was made on «мол» and the next search may fire on «моло» — and the word being
 * typed is still the start of a word of the item taken. Below this many characters the
 * shorter one has to match exactly: «мо» starts half the catalogue. The same three MOL-10
 * holds the last word to an exact start. Typed letter by letter on MOL-14's shelf a pick lifts
 * its item 18 times at 2, 9 at 3, 5 at 4; at 2 it also harms 4 times — a pick for Coca-Cola
 * on «ко» tops «Колбаса» on «кол». Nothing harmed at 3; real picks measure it again (MOL-47).
 */
const REMEMBERED_PREFIX = 3

/**
 * A query as the search compares it — and as a remembered pick stores it. One function for
 * both, or a pick would be written under one key and looked up under another: the thirteenth
 * word would be kept on write and cut on read, and the pair would never match itself.
 *
 * `null` means nothing to look for. Not only the empty key: for punctuation `toSearchKey`
 * falls back to the punctuation itself, which has no trigrams and no words.
 */
export function searchQueryKey(query: string): string | null {
  // The same function the name went through on write: the key is compared with itself.
  const key = toSearchKey(query).split(' ').slice(0, MAX_QUERY_WORDS).join(' ')
  return HAS_CONTENT.test(key) ? key : null
}

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
export function rankedCandidates(key: string, limit: number, actorId: string | null): SQL {
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
      -- by MAX_QUERY_WORDS; measured in MOL-10, under 260 ms at every threshold in MOL-14.
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
    ),
    remembered as (
      -- The owner's own picks for this query, folded per item. Personal on purpose: a sum
      -- across owners would be popularity in the results, which nobody could tell apart
      -- from a paid placement. A null owner — a malformed identifier — matches no row.
      select sp.item_id,
             max(sp.last_picked_at) as last_picked_at,
             sum(sp.picks) as picks
      from ${searchPicks} sp
      join ${items} i on i.id = sp.item_id
      cross join lateral (
        select string_to_array(sp.query_key, ' ') as s,
               string_to_array(${key}, ' ') as q
      ) k
      where sp.actor_id = ${actorId}
        and cardinality(k.s) = cardinality(k.q)
        and k.s[1 : cardinality(k.s) - 1] = k.q[1 : cardinality(k.q) - 1]
        and (sp.query_key = ${key}
             or least(length(k.s[cardinality(k.s)]), length(k.q[cardinality(k.q)]))
                  >= ${REMEMBERED_PREFIX}
                and (starts_with(k.s[cardinality(k.s)], k.q[cardinality(k.q)])
                     or starts_with(k.q[cardinality(k.q)], k.s[cardinality(k.s)]))
                -- And what is being typed still leads to the item that was taken: its last
                -- word is the start of a word of that name. Without this a pick made on
                -- «мол» for milk stood above «Молоток» typed in full, and one made on the
                -- finished «сыр» above «Сырок» — another word, not the same query.
                and exists (
                  select 1
                  from unnest(string_to_array(i.search_key, ' ')) as w(word)
                  where starts_with(w.word, k.q[cardinality(k.q)])
                ))
      group by sp.item_id
    )
    select r.id
    from ranked r
    left join remembered m on m.item_id = r.id
    -- The filter stays on the distance alone: a pick lifts what the search found and never
    -- lets in what it did not, or memory would become a second search with rules of its own.
    where r.distance <= ${ACCEPTED_DISTANCE}
    -- What the person took before comes first, above a closer spelling — their own choice
    -- says more than a typo metric does. Among several, the latest wins: after switching
    -- brands the new one is on top from the first trip. Then the order of MOL-10, where ties
    -- stay ties («moloko» names «Ашхар» and «Марианна» alike) and \`id\` only keeps two loads
    -- of one screen in one order.
    order by m.item_id is null,
             m.last_picked_at desc nulls last,
             m.picks desc nulls last,
             r.distance, r.ws desc, r.id
    limit ${limit}
  `
}

export function createItemRepository(db: Conn): ItemRepository {
  /** One query for the items and one for every barcode of them — never one per item. */
  async function load(ids: readonly string[], conn: Conn = db): Promise<Item[]> {
    // A malformed identifier matches nothing and would meet `22P02` — a 500 where «nothing
    // found» is the honest answer — so it is dropped before the query rather than sent.
    const known = ids.map(idOrNull).filter((id): id is string => id !== null)
    if (known.length === 0) return []

    // Ordered by id rather than left to the planner: a read whose order depends on the
    // physical layout is a test that passes until it does not.
    const rows = await conn
      .select()
      .from(items)
      .where(inArray(items.id, known))
      .orderBy(asc(items.id))
    if (rows.length === 0) return []

    const codes = await conn
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

  /** The one insert of an item, inside the caller's transaction. */
  async function insert(tx: Conn, input: NewItem, createdBy: string | null): Promise<Item> {
    const typical = quantityTo(input.typicalQuantity)
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
      await tx.insert(itemBarcodes).values(input.barcodes.map((code) => ({ code, itemId: id })))
    }

    // Sorted the way a later read returns them, so create and read agree.
    return toItem(theRow(row, 'items'), [...input.barcodes].sort())
  }

  return {
    create(input, createdBy) {
      // Both tables or neither: an item whose barcodes failed to land is an item nobody can
      // scan, and it would look exactly like one that never had any.
      return translateFailures(async () => db.transaction((tx) => insert(tx, input, createdBy)))
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

    createUnlessNamed(input, createdBy) {
      const key = toSearchKey(input.name)
      const wanted = nameIdentity(input.name)

      return translateFailures(async () =>
        db.transaction(async (tx) => {
          // Per kind and key rather than per name: every name that is the same by
          // `nameIdentity` has the same key — built so, and held by a property test — so they
          // all meet at this lock, and the lookup below is an equality the GIN index serves.
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext('items'), hashtext(${`${input.kind} ${key}`}))`,
          )
          const rows = await tx
            .select({ id: items.id, name: items.name })
            .from(items)
            .where(and(eq(items.kind, input.kind), eq(items.searchKey, key)))
            .orderBy(asc(items.createdAt), asc(items.id))

          const same = rows.find((row) => nameIdentity(row.name) === wanted)
          if (same) {
            const [item] = await load([same.id], tx)
            if (item) return { item, created: false }
          }

          return { item: await insert(tx, input, createdBy), created: true }
        }),
      )
    },

    async search(query, limit, actorId) {
      const key = searchQueryKey(query)
      if (key === null) return []

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
         *
         * Read with `missing_ok`: the setting exists in a session only once the pg_trgm
         * library is loaded there — by the first trigram operator, not by CREATE EXTENSION in
         * another session. On a fresh pooled connection the plain read raised, and every
         * search answered 500 until an insert happened to touch the index (MOL-12). A value
         * set before the library loads is a placeholder the library adopts, so the local
         * threshold still holds for the query below, and 0.6 — its default — is put back.
         */
        const [previous] = await tx.execute<{ threshold: string | null }>(
          sql`select current_setting('pg_trgm.word_similarity_threshold', true) as threshold`,
        )
        await tx.execute(
          sql`select set_config('pg_trgm.word_similarity_threshold', ${String(CANDIDATE_THRESHOLD)}, true)`,
        )

        const rows = await tx.execute<{ id: string }>(
          rankedCandidates(key, rowLimit(limit), idOrNull(actorId)),
        )

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
