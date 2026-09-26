import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import {
  ADJECTIVE_WORD,
  NOUN_WORD,
  WORD_BREAK,
  itemSchema,
  nameIdentity,
  synonymDescribes,
  synonymKeys,
  synonymPairedKinds,
  toSearchKey,
} from '@molvia/model'
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
  search(query: string, limit: number, actorId: string): Promise<SearchAnswer>
}

/**
 * The items found, in their order, and whether any of them is close to what was typed (MOL-46).
 * An empty answer is not near.
 */
export interface SearchAnswer {
  readonly items: Item[]
  readonly near: boolean
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
 * six more wrong items. A word wrong from end to end still fits in two, and the answer then
 * says it is not near rather than dropping it (MOL-46, `NEAR_DISTANCE`).
 */
const ACCEPTED_DISTANCE = 2

/**
 * How far a word of the query may be from its word in a name and the row still be close to what
 * was typed rather than merely inside the budget (MOL-46). Not a threshold of its own: «far» is
 * exactly what only grazed the budget. The budget cannot tell `malako` → `moloko` from `pelmeni` →
 * `zeleni` — both two edits — and every rule on the letters that was measured against it lost
 * typos to win false hits: vowels by sound lost 38 of 40 slips of the finger, the first letter
 * every typo that touched it, keyboard neighbours explained «овощи» too. So nothing is dropped,
 * and the answer says how sure it is.
 *
 * Measured per word, by the worst, and the size aside (adversarial review А, Б). By the mean one
 * exact word beside a wrong one made the row close — «мыло детское» over «Масло детское», three
 * edits over two exact words; and a size in another number made a one-edit typo far — «кефр 1 л»
 * over «Кефир 0,5 л» — where MOL-45 already calls that the kefir asked for in another size.
 */
const NEAR_DISTANCE = ACCEPTED_DISTANCE - 1

/**
 * A word grounds a match only if it has this many characters and no digit. Short words and
 * anything with a digit are the packaging size — «1 л», «1л», «500г», «3.2%» — they refine
 * the ranking but never ground it, otherwise «32» finds every name that carries those
 * digits, and «1л» measured against «moloko» alone costs six and loses «Молоко 1 л».
 */
const SHORT_WORD = 2

/**
 * A unit grounds nothing either, whatever its length — it is the size too, only spelled with
 * letters. The length alone stopped «л» and let «шт» through: `sht` is two edits from `sir`,
 * so «сыр» found every item sold by the piece, six of them on MOL-14's shelf (MOL-48). The
 * same on both sides, or «кефир 500 мл» would ask for a grounding pair of `ml` and lose
 * «Кефир 500 мл».
 *
 * Words as a label prints them, keyed by the function the name goes through, so the list
 * follows the alphabet by itself and nothing stored depends on it. Only what the length rule
 * misses, and only the forms written after a number: «таблетки» and «капсулы» begin the names
 * of the very goods, and as units «табл» lost «Таблетки для посудомоечной машины» on the way
 * there. The price, accepted: a counting word in another form — «чай пакетики», «бумага
 * рулоны» — is measured as a word and misses (owner's decision, 25.09.2026). So does a real
 * word that shares a unit's key, and not only when typed alone: `up` of «уп» is the «Up» of
 * «7 Up», which «7 ап» no longer reaches, and `hat` of «հատ» is the Latin «hat». Kept anyway —
 * without «уп» «суп» finds «Яйца 10 уп» at one edit, which is the defect itself.
 */
export const UNIT_WORDS = [
  'шт',
  'штук',
  'штуки',
  'мл',
  'кг',
  'гр',
  'мг',
  'см',
  'Вт',
  'уп',
  'упак',
  'пак',
  'рулон',
  'рулона',
  'рулонов',
  'пакетик',
  'пакетика',
  'пакетиков',
  'таблеток',
  'капсул',
  'հատ',
  'կգ',
  'գր',
  'մլ',
  'սմ',
  'տուփ',
  'pcs',
  'pc',
  'ml',
  'kg',
  'gr',
  'mg',
  'cm',
  'pack',
  'pk',
] as const

const UNIT_KEYS = [...new Set(UNIT_WORDS.map(toSearchKey))]
const UNIT_ARRAY = sql`array[${sql.join(
  UNIT_KEYS.map((unit) => sql`${unit}`),
  sql`, `,
)}]::text[]`

/**
 * How far a query word right after a number may stray from a unit and still be read as one.
 * The screen searches while the person types, so «батарейки 4 шту» is on its way to «штук», and
 * a finger slips to the key next door — «кефир 500 мд». Read as grounding, either looked for a
 * grounding pair the name no longer offers and lost the item on every keystroke up to the full
 * unit. Only after a number, where a size stands: «пакеты» alone still does not find the tea.
 * And only while another word still grounds the query — «2 суп», «2 кап» on the way to «2
 * капусты» are the goods themselves, and read as units they left nothing to find by.
 *
 * A transposition is two edits, and «тш» for «шт» is not even that in the key: the alphabet
 * folds `ts` into `ц`, so it is `цh`, two from `sht`. Not caught — the price, named.
 */
const UNIT_SLIP = 1

/**
 * Whether a query word may be that unit by a slip of the finger: one edit from it, or two letters
 * swapped — the commonest typo, and two edits to Levenshtein, so «кефир 500 лм» lost «мл». One
 * predicate for the query's own reading and for the name's unit it is set against.
 */
function slipsFromUnit(word: SQL, unit: SQL): SQL {
  return sql`(levenshtein(${word}, ${unit}) <= ${UNIT_SLIP}
          or exists (
            select 1
            from generate_series(1, length(${word}) - 1) as i
            where overlay(${word} placing substr(${word}, i + 1, 1) || substr(${word}, i, 1)
                          from i for 2) = ${unit}
          ))`
}

/**
 * How many words of a query are looked at. Every query word is compared with every word of
 * every candidate, so the cost grows with the query — 42 KB of it held a connection for
 * three seconds. No name on a shelf needs more words than this to be found.
 */
const MAX_QUERY_WORDS = 12

const HAS_CONTENT = /[\p{L}\p{N}]/u

/**
 * How many words the dictionary may add to one query, taken in the order the query names them.
 * Each is one more condition on the index and one more set of candidates to rank: twelve wide
 * words — «мясо рыба сыр хлеб…» — expand into fifty and held a connection for a second and a
 * half (MOL-45, adversarial Ж). A shelf query is one or two words, and «рыба», the widest, is
 * eight; sixteen leaves both untouched. Eight was measured too and wins little: what twelve wide
 * words cost now is ranking the names that carry the synonyms, not finding them (review Х).
 */
const MAX_SYNONYMS = 16

/**
 * A remembered query counts as the one being typed when every word but the last is equal and
 * one last word is the start of the other — the screen searches while the person types, so
 * the pick was made on «мол» and the next search may fire on «моло» — and the word being
 * typed is still the start of a word of the item taken. Below this many characters the
 * shorter one has to match exactly: «мо» starts half the catalogue. The same three MOL-10
 * holds the last word to an exact start. Typed letter by letter on MOL-14's shelf a pick lifts
 * its item 18 times at 2, 9 at 3, 5 at 4; at 2 it also harms 5 times — a pick for Coca-Cola
 * on «ко» tops «Колбаса» on «кол». Once at 3 too, but through the equal key, not this prefix:
 * a sausage picked on «кол» tops the cola the owner's «кол» means. Real picks decide (MOL-47).
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
  // What else each word of the query stands for (MOL-45): «картошка» is also «картофель». Two
  // parallel lists rather than an array parameter — words of a key never hold a space.
  const synonyms = key
    .split(' ')
    .flatMap((word, index) => synonymKeys(word).map((synonym) => [synonym, index + 1] as const))
    .slice(0, MAX_SYNONYMS)
  const synonymWords = synonyms.map(([synonym]) => synonym).join(' ')
  const synonymOf = synonyms.map(([, n]) => n).join(' ')
  // A synonym that describes — «минеральная» — is never the kind, and counts as any word.
  const synonymAnywhere = synonyms.map(([synonym]) => String(synonymDescribes(synonym))).join(' ')
  // An adjective of a group — «гречневая» — counts anywhere beside its own kinds: «Крупа
  // гречневая», «Гречневая крупа», never «Лапша гречневая». A list per synonym, `-` for none.
  const synonymKinds = synonyms
    .map(([synonym]) => synonymPairedKinds(synonym).join(',') || '-')
    .join(' ')
  const expanded = [...new Set(synonyms.map(([, n]) => n))].join(' ')
  // Without a synonym every candidate of the index was found by what was typed, and asking the
  // operator again per row is what «мо» over 20 000 names paid for.
  const typedHere =
    synonyms.length === 0
      ? sql`true`
      : sql`(${items.searchKey} %> ${key} or ${items.searchKey} = ${key})`
  // Measured only when there is a synonym at all, and only for a word that has one: the query
  // words of most searches have none, and a subquery per candidate and word to find that out
  // doubled the time of «малако» — and of twelve wide words, which the cap leaves two or three
  // words' worth of synonyms (review Х).
  const bySynonymWord =
    synonyms.length === 0
      ? sql`null::int`
      : sql`case when qw.expanded and exists (
                    select 1
                    from synonyms s
                    where s.n = qw.n
                      and (s.word = split_part(c.search_key, ' ', c.kind_at)
                           or s.anywhere
                              and s.word = any(string_to_array(c.search_key, ' '))
                           or split_part(c.search_key, ' ', c.kind_at)
                                = any(string_to_array(nullif(s.kinds, '-'), ','))
                              and s.word = any(string_to_array(c.search_key, ' ')))
                  ) then 0 end`
  // A synonym counts only as the word of the kind — the first word of a name that is not an
  // adjective, `kindKey` of the domain (owner's decisions on review, MOL-45 А and Н): «Вода
  // Джермук», «Молодой картофель», and not the tuna of a cat food. So its candidates are the
  // names that contain it, not those that resemble it: `%>` at 0.15 brought in half of 20 000
  // names for each of the eight fish of «рыба» and took six seconds. And from the start of a
  // word, not anywhere in one: `%lori%` brings every `kalorii` (review Х). `like` is served by the
  // same trigram index, two conditions per word — one regular expression for all of them was
  // measured slower still. The words are letters only (the dictionary's test), so nothing in them
  // is a wildcard.
  const bySynonym = [...new Set(synonyms.map(([synonym]) => synonym))].map(
    (synonym) =>
      sql` or ${items.searchKey} like ${`${synonym}%`} or ${items.searchKey} like ${`% ${synonym}%`}`,
  )
  // Where the kind stands: the first word of the name that is not an adjective, by the domain's
  // own pattern. The adjectives are plain words, so the n-th word of the name is the n-th of
  // the key. Past the end when every word describes — `split_part` then answers ''.
  const kindAt =
    synonyms.length === 0
      ? sql`1`
      : sql`coalesce((
          select min(u.n)::int
          from (
            -- Split by the domain's own class and counted over the words alone, as \`kindKey\`
            -- does: a no-break space is a break there, and \`\\s\` of Postgres does not see it.
            select w, row_number() over (order by at) as n
            from unnest(regexp_split_to_array(${items.name}, ${WORD_BREAK}))
                 with ordinality as s(w, at)
            where w <> ''
          ) u
          where u.w !~ ${ADJECTIVE_WORD} or u.w ~ ${NOUN_WORD}
        ), 1000)`

  // No word after a number, no slip — and then not even the empty scan of every candidate: on
  // «мо», which has no synonym, that alone was half the time.
  const words = key.split(' ')
  const slipped = words.some((_, index) => index > 0 && /[0-9]/u.test(words[index - 1] ?? ''))
    ? sql`select c.id, qw.n
      from query_words qw
      cross join candidates c
      where qw.slips
        and (exists (
               select 1
               from (
                 select unit, lag(unit) over (order by i) as number
                 from unnest(string_to_array(c.search_key, ' ')) with ordinality as t(unit, i)
               ) nw
               where nw.unit in ${UNIT_KEYS}
                 and nw.number = qw.number
                 and ${slipsFromUnit(sql`qw.q`, sql`nw.unit`)}
             )
             -- A size written together, «Ряженка 500мл», is one word of the key: \`500ml\`.
             or exists (
               select 1
               from unnest(string_to_array(c.search_key, ' ')) as nw(word)
               cross join unnest(${UNIT_ARRAY}) as u(unit)
               where nw.word = qw.number || u.unit
                 and ${slipsFromUnit(sql`qw.q`, sql`u.unit`)}
             ))`
    : sql`select null::uuid as id, null::int as n where false`

  return sql`
    with query_words as (
      -- Cut to 255 here, once: levenshtein refuses longer arguments, and the prefix arm below
      -- cuts the name to the length of the query word, not to 255.
      select n, left(word, 255) as q, number,
             -- A word is read as a unit by its place only while another word still grounds the
             -- query: in «2 суп» the soup is all there is, not two of «տուփ». A unit still being
             -- typed is a size against every name — the item must not blink out of the list on
             -- the way to «штук»; a slip only against the names in \`slipped\`.
             plain and not (anchored and unit_start) as grounds,
             plain and anchored and unit_like and not unit_start as slips,
             word ~ '[^0-9]' as lettered,
             last,
             n::int = any(string_to_array(${expanded}, ' ')::int[]) as expanded
      from (
        select *, bool_or(plain and not unit_like) over () as anchored
        from (
          select n, word, last, number,
                 length(word) >= ${SHORT_WORD} and word !~ '[0-9]' and word not in ${UNIT_KEYS}
                   as plain,
                 after_number and exists (
                   select 1
                   from unnest(${UNIT_ARRAY}) as u(unit)
                   where ${slipsFromUnit(sql`left(word, 255)`, sql`unit`)}
                      or (last and starts_with(unit, word))
                 ) as unit_like,
                 after_number and last and exists (
                   select 1 from unnest(${UNIT_ARRAY}) as u(unit) where starts_with(unit, word)
                 ) as unit_start
          from (
            select word, n,
                   n = max(n) over () as last,
                   lag(word) over (order by n) as number,
                   coalesce(lag(word) over (order by n) ~ '[0-9]', false) as after_number
            from unnest(string_to_array(${key}, ' ')) with ordinality as t(word, n)
          ) w
        ) u
      ) a
    ),
    synonyms as (
      select s.word, s.n, s.anywhere, s.kinds
      from unnest(string_to_array(${synonymWords}, ' '),
                  string_to_array(${synonymOf}, ' ')::int[],
                  string_to_array(${synonymAnywhere}, ' ')::boolean[],
                  string_to_array(${synonymKinds}, ' '))
           as s(word, n, anywhere, kinds)
    ),
    admitted as (
      -- The person's own synonyms for exactly this query (MOL-45): it found nothing, and they
      -- took the item by another word. The one exception to «memory never lets in what the
      -- search did not find» — and a personal one, so it never becomes a second search.
      select sp.item_id as id
      from ${searchPicks} sp
      where sp.actor_id = ${actorId} and sp.query_key = ${key} and sp.admits
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
             word_similarity(${key}, ${items.searchKey}) as ws,
             -- Found by what was typed, not only by a synonym. The typed word's edit budget
             -- applies to these alone: a name brought in by «лори» for «сыр» is no candidate
             -- of «сыр», and measured against it anyway, «Рис» passed as two edits from \`sir\`.
             ${typedHere} as typed,
             ${kindAt} as kind_at
      from ${items}
      where ${items.searchKey} %> ${key} or ${items.searchKey} = ${key}${sql.join(bySynonym)}
      -- Every candidate is ranked, with no ceiling. Any cut here is wrong in one of two ways:
      -- ordered by similarity it drops the typo the low threshold exists for (two hundred
      -- «Малина» pushed out the milk), unordered it drops by row age — the newest items, the
      -- very ones «Предложить товар» just added. \`order by id\` is worse still: the planner
      -- walks the primary key and filters every row. The cost is bounded by the catalogue and
      -- by MAX_QUERY_WORDS; measured in MOL-10, under 260 ms at every threshold in MOL-14.
      -- A branch of its own rather than an \`or\` above: \`id in (…)\` beside the trigram
      -- conditions is not something the GIN index can serve, and the whole scan would fall back.
      -- \`union all\`: an item both found and learnt comes twice, and the ranking does not mind —
      -- a repeated row changes neither a mean nor a worst — while \`union\` sorted thousands of
      -- candidates to find it, and doubled «малако» on 20 000 names.
      union all
      select ${items.id}, ${items.searchKey},
             word_similarity(${key}, ${items.searchKey}),
             (${items.searchKey} %> ${key} or ${items.searchKey} = ${key}),
             ${kindAt}
      from ${items}
      join admitted a on a.id = ${items.id}
    ),
    slipped as materialized (
      -- A slip is a size only against a name that prints the unit it slipped from, after the
      -- very number the query has; elsewhere the word is what it spells. In «2 сом замороженный»
      -- the catfish is not «см»: read as a size everywhere it let «Котлеты … замороженные» in
      -- beside the fish, and against any «см» it let in «Пицца замороженная 30 см». The number
      -- is what gives a slip away — «кефир 500 мд» and «Кефир 500 мл» share «500». The price:
      -- «кефир 1 мд» does not reach «Кефир 1000 мл». Apart and joined, not a subquery per row:
      -- a slip after a number is rare, so this is nearly always empty — and materialized, taken
      -- once: inlined into \`per_word\` beside the thousands of candidates a synonym brings,
      -- «мясо» over 20 000 names took 1.4 s where it takes 0.2 without (MOL-45, review Ш).
      ${slipped}
    ),
    -- Materialized, so each word distance is taken once per row: inlined, the planner copied the
    -- subquery into the select list, the filter and the order by — and with \`slipped\` joined
    -- in, 20 000 names answered half as fast again as before it. Kept, it beats both.
    per_word as materialized (
      select c.id, qw.grounds and s.id is null as grounds, qw.lettered,
             -- The typed spelling is measured unless the row came by a synonym of this very word:
             -- «сыр» is not measured against «Рис» that «лори» brought, but «хаггис» of
             -- «памперсы хаггис» is still measured against the «Huggies» that «подгузники» did.
             case when c.typed or not qw.expanded then (
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
               where not (qw.grounds and s.id is null)
                  or (length(w) >= ${SHORT_WORD} and w !~ '[0-9]' and w not in ${UNIT_KEYS})
             ) end as qd_typed,
             -- A synonym is a word, not a typo: it counts only as the whole word of the kind,
             -- and then costs nothing. With the edit budget on top, «мясо» expanded into five
             -- words would have five chances of the absolute budget's false hits (MOL-46).
             ${bySynonymWord} as qd_synonym
      from candidates c
      cross join query_words qw
      left join slipped s on s.id = c.id and s.n = qw.n
    ),
    per_word_best as (
      -- \`least\` skips a null, so a word found only by its synonym is still found. Not
      -- materialized: \`per_word\` is, so folding this into the aggregates below repeats a
      -- \`least\`, not the levenshtein subquery.
      select id, grounds, lettered, least(qd_typed, qd_synonym) as qd,
             coalesce(qd_synonym = 0 and coalesce(qd_typed, 255) > 0, false) as by_synonym
      from per_word
    ),
    ranked as (
      select c.id, c.ws,
             c.id in (select id from admitted) as admitted,
             case when c.search_key = ${key} then 0
                  -- Grounding words by their mean, rounded up: a correct extra word printed
                  -- on the package («пастеризованное») would cost 11 by the worst, 4 by the
                  -- mean. A name with no grounding word leaves qd null and never passes.
                  --
                  -- A word found only by its synonym stays out of the mean: free, it would lend
                  -- its budget to the next word, and «хлеб барадинский» found «Лаваш армянский»
                  -- by \`baradinskii\` four edits from \`armianskii\`. The others stand on their own.
                  when bool_or(pw.grounds)
                  then coalesce(ceil(avg(coalesce(pw.qd, 255))
                                       filter (where pw.grounds and not pw.by_synonym)), 0)
                       -- Short words by their worst, at most one edit: each has to find its
                       -- pair, so «1 л» against «2 л» costs one where «л» alone would hide it.
                       + least(coalesce(max(pw.qd) filter (where not pw.grounds), 0), 1)
                  -- No grounding word, but letters: «M&M's» is \`m m s\`, «m&m» is what the
                  -- screen sends halfway through typing it. Every word has to be found
                  -- exactly (the last one by its start). Digits alone never get here.
                  when bool_or(pw.lettered) and max(coalesce(pw.qd, 255)) = 0 then 0
             end as distance,
             -- The words alone, the size aside: «Кефир Ашхар 0,5 л» for «кефир 1 л» is the kefir
             -- asked for in another size, not a typo (review Т).
             coalesce(ceil(avg(coalesce(pw.qd, 255))
                             filter (where pw.grounds and not pw.by_synonym)), 0) as words_distance,
             -- The furthest of those words, for how near the row is (MOL-46).
             coalesce(max(coalesce(pw.qd, 255))
                        filter (where pw.grounds and not pw.by_synonym), 0) as words_worst
      from candidates c
      join per_word_best pw on pw.id = c.id
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
    -- Near: some row has every word within one edit, the size aside — or is the person's own,
    -- taken before on this query or their own word for the item: their choice says more than a
    -- typo metric, the same reason it is lifted. Over every row the filter accepts, before the
    -- limit: a near row with a size penalty ranks level with a far one, and twenty of those would
    -- cut it off.
    select r.id,
           bool_or(coalesce(r.words_worst <= ${NEAR_DISTANCE} or r.admitted
                            or m.item_id is not null, false)) over () as near
    from ranked r
    left join remembered m on m.item_id = r.id
    -- The filter stays on the distance: a pick lifts what the search found and never lets in
    -- what it did not, or memory would become a second search with rules of its own. The one
    -- exception is the person's own word (MOL-45), and it is let in, not lifted.
    where r.distance <= ${ACCEPTED_DISTANCE} or r.admitted
    -- What only a learnt word let in stands below what the search found by its words or the
    -- person took before, and above what it found by a typo (owner's decisions on review,
    -- MOL-45 И, О and Т): «кефир» learnt as the milk taken in its place stops standing above the
    -- kefir the day the catalogue has one — in any size, «кефир 1 л» against «0,5 л» — and the
    -- potato learnt for «овощи» stays above the flour the absolute budget finds there (MOL-46).
    -- Among what the search found, the words matched exactly now go before a typo in a word at
    -- the same distance; nothing else moves. Then what the person took before,
    -- above a closer spelling — their own choice says more than a typo metric does. Among
    -- several, the latest wins: after switching brands the new one is on top from the first
    -- trip. Then the order of MOL-10, where ties stay ties («moloko» names «Ашхар» and
    -- «Марианна» alike) and \`id\` only keeps two loads of one screen in one order.
    order by case when not coalesce(r.distance <= ${ACCEPTED_DISTANCE}, false) then 1
                  when m.item_id is not null or r.words_distance = 0 then 0
                  else 2
             end,
             m.item_id is null,
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
      if (key === null) return { items: [], near: false }

      const rows = await db.transaction(async (tx) => {
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

        const ranked = await tx.execute<{ id: string; near: boolean }>(
          rankedCandidates(key, rowLimit(limit), idOrNull(actorId)),
        )

        await tx.execute(
          sql`select set_config('pg_trgm.word_similarity_threshold', ${previous?.threshold ?? '0.6'}, true)`,
        )
        return ranked
      })

      // `load` answers in id order; the ranking is this query's, so it is restored here.
      const found = new Map((await load(rows.map((row) => row.id))).map((item) => [item.id, item]))
      const kept = rows.filter((row) => found.has(row.id))
      return {
        items: kept.flatMap((row) => found.get(row.id) ?? []),
        near: kept.length > 0 && rows.some((row) => row.near),
      }
    },
  }
}
