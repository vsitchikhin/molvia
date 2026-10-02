import { sql } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'
import { ADJECTIVE_WORD, NOUN_WORD, WORD_BREAK } from '@molvia/model'

/**
 * Where the word of the kind stands in a name: the first word that is not an adjective, by the
 * domain's own pattern — `kindKey` (MOL-45). The adjectives are plain words, so the n-th word of
 * the name is the n-th of the key. Past the end when every word describes — `split_part` then
 * answers ''. The one spelling of it in SQL, read by the search's synonyms and by «Тут дешевле»'s
 * other items of a kind (MOL-92), so the two cannot disagree about what a name is.
 */
export function kindAt(name: AnyColumn | SQL): SQL {
  return sql`coalesce((
    select min(u.n)::int
    from (
      -- Split by the domain's own class and counted over the words alone, as \`kindKey\`
      -- does: a no-break space is a break there, and \`\\s\` of Postgres does not see it.
      select w, row_number() over (order by at) as n
      from unnest(regexp_split_to_array(${name}, ${WORD_BREAK}))
           with ordinality as s(w, at)
      where w <> ''
    ) u
    where u.w !~ ${ADJECTIVE_WORD} or u.w ~ ${NOUN_WORD}
  ), 1000)`
}
