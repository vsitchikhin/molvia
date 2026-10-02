import type { QueryMeaning } from '@/db/items-repository'
import type { Embedder } from '@/embeddings/embedder'

/**
 * How many letters a query needs before it is asked by meaning (MOL-105). Typed letter by letter,
 * a cut of a shelf word finds names by meaning that are not of the shelf: on the seed, near two
 * rows a cut from two to four letters, one from five — the model reads «мол» as anything that
 * looks like it. The letters already answer a start of a word.
 */
export const MEANING_MIN_LETTERS = 4

/**
 * The vector of a query for the search by meaning, or `null` — too short, or no model, or not in
 * time: then the search is by letters alone, as it always was.
 */
export async function queryMeaning(
  embedder: Pick<Embedder, 'model' | 'query'>,
  query: string,
): Promise<QueryMeaning | null> {
  if ((query.match(/\p{L}/gu)?.length ?? 0) < MEANING_MIN_LETTERS) return null
  const vector = await embedder.query(query)
  return vector === null ? null : { model: embedder.model, vector }
}
