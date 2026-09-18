import { sql } from 'drizzle-orm'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { searchQueryKey } from './items-repository'
import { QUERY_KEY_MAX_OCTETS, searchPicks } from './schema'

export interface SearchPickRepository {
  /**
   * The item went into a trip after this query — MOL-21 calls it in the same transaction as
   * the expense. Not on a tap in the list: a tap the sheet then cancels is a changed mind, not
   * a pick, and as a label for anything smarter later it would be noise.
   *
   * Read back only by the search itself, inside `rankedCandidates`; nothing puts a pick on
   * the wire.
   */
  remember(actorId: string, query: string, itemId: string): Promise<void>
}

export function createSearchPickRepository(db: Conn): SearchPickRepository {
  return {
    async remember(actorId, query, itemId) {
      // Silent on purpose: a query with nothing in it, or one too long to index, is not
      // worth failing an item added to a trip over. The length is measured in octets, as
      // the CHECK measures it — twelve words of four-byte letters get there before 600
      // characters do.
      const key = searchQueryKey(query)
      if (key === null || Buffer.byteLength(key) > QUERY_KEY_MAX_OCTETS) return

      // Identifiers arrive validated, as on every other write path: the owner from the hook,
      // the item from the input the expense was written with. A missing item is a
      // foreign-key refusal and reaches the caller like everywhere else.
      await translateFailures(() =>
        db
          .insert(searchPicks)
          .values({ actorId, queryKey: key, itemId })
          .onConflictDoUpdate({
            target: [searchPicks.actorId, searchPicks.queryKey, searchPicks.itemId],
            set: { picks: sql`${searchPicks.picks} + 1`, lastPickedAt: sql`now()` },
          }),
      )
    },
  }
}
