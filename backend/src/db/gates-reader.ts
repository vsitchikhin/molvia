import { sql } from 'drizzle-orm'
import { GATE_RATINGS, GATE_RATINGS_WINDOW_HOURS } from '@molvia/model'
import type { CohortReturn } from './events-repository'
import type { Db } from './index'
import type { CohortReached } from './verdicts-repository'
import { createEventRepository } from './events-repository'
import { createVerdictRepository } from './verdicts-repository'

/** People who appeared in `[from, to)` — the one window both gates are read over (MOL-91, Р-1). */
export interface GatesWindow {
  readonly from: Date
  readonly to: Date
}

export interface GatesReport {
  /** The database's `now()`: the moment every «window still open» of this report was judged by. */
  readonly readAt: Date
  readonly ratings: CohortReached
  readonly products: CohortReturn
  readonly venues: CohortReturn
}

export interface GatesReader {
  read(window: GatesWindow): Promise<GatesReport>
}

/**
 * Reads both gates for `dist/gates.js` (MOL-91) in one transaction, `repeatable read` and
 * `read only`: one snapshot and one `now()` for every line of the output — a person whose window
 * closed between two statements would otherwise be waiting in one half and counted in the other
 * — and a tool run on production by hand that cannot write even by mistake.
 */
export function createGatesReader(db: Db): GatesReader {
  return {
    async read({ from, to }) {
      return db.transaction(
        async (tx) => {
          const [clock] = await tx.execute<{ ms: number }>(
            sql`select (extract(epoch from now()) * 1000)::float8 as ms`,
          )
          const verdicts = createVerdictRepository(tx)
          const events = createEventRepository(tx)
          return {
            readAt: new Date(clock?.ms ?? Number.NaN),
            ratings: await verdicts.reachedRatings({
              from,
              to,
              ratings: GATE_RATINGS,
              windowHours: GATE_RATINGS_WINDOW_HOURS,
            }),
            products: await events.weekFourReturn('product', from, to),
            venues: await events.weekFourReturn('venue', from, to),
          }
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      )
    },
  }
}
