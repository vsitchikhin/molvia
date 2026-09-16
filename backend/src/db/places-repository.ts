import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, max, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { placeSchema } from '@molvia/model'
import type { NewPlace, Place } from '@molvia/model'
import type { Conn } from './index'
import { idOrNull, rowLimit } from './rows'
import { placeIdentity, places, trips } from './schema'

export interface PlaceRepository {
  /** The place that is already there, or a new one — never a second card for one shop. */
  ensure(input: NewPlace): Promise<Place>
  byId(id: string): Promise<Place | null>
  byIds(ids: readonly string[]): Promise<Place[]>
  /** Places this person has already shopped in, the most recent first. */
  recentFor(actorId: string, limit: number): Promise<Place[]>
}

type PlaceRow = typeof places.$inferSelect

function toPlace(row: PlaceRow): Place {
  return placeSchema.parse(row)
}

/** The fold the index applies to a column, applied to a value instead. */
function identityOf(value: string): SQL {
  // `::text` on purpose: `normalize()` takes text, and a bare parameter arrives as unknown.
  return placeIdentity(sql`${value}::text`)
}

export function createPlaceRepository(db: Conn): PlaceRepository {
  return {
    async ensure(input) {
      return db.transaction(async (tx) => {
        // Written, then read, rather than `DO UPDATE ... RETURNING`: an update would rewrite
        // the spelling of a place someone else already created — «SAS» would become «sas»
        // because the next person typed it in lower case.
        //
        // Raw SQL because the builder cannot express this. In drizzle 0.45.2 the conflict
        // target is `IndexColumn = PgColumn` — columns only — and this uniqueness lives in
        // an index over expressions, so naming the columns answers `42P10` on the first
        // duplicate. Inside `ON CONFLICT` the column names stay unqualified: Postgres infers
        // the index by matching these expressions, and a table-qualified reference is not
        // allowed there.
        await tx.execute(sql`
          insert into ${places} (id, kind, name, country, city)
          values (${randomUUID()}, ${input.kind}, ${input.name}, ${input.country}, ${input.city})
          on conflict (kind, country, ${placeIdentity(sql.raw('city'))}, ${placeIdentity(sql.raw('name'))})
          do nothing
        `)

        const [row] = await tx
          .select()
          .from(places)
          .where(
            and(
              eq(places.kind, input.kind),
              eq(places.country, input.country),
              eq(placeIdentity(places.city), identityOf(input.city)),
              eq(placeIdentity(places.name), identityOf(input.name)),
            ),
          )
          .limit(1)

        if (!row) throw new Error('ensure(place) neither wrote a place nor found one')
        return toPlace(row)
      })
    },

    async byId(id) {
      if (idOrNull(id) === null) return null

      const [row] = await db.select().from(places).where(eq(places.id, id)).limit(1)
      return row ? toPlace(row) : null
    },

    async byIds(ids) {
      const known = ids.map(idOrNull).filter((id): id is string => id !== null)
      if (known.length === 0) return []

      const rows = await db
        .select()
        .from(places)
        .where(inArray(places.id, known))
        .orderBy(asc(places.id))
      return rows.map(toPlace)
    },

    async recentFor(actorId, limit) {
      if (idOrNull(actorId) === null) return []

      // Grouped by place rather than listing trips: a person who shops in the same three
      // places wants those three, not the same name four times. The tie-break by id keeps
      // two places last visited in the same second from swapping between two loads.
      const rows = await db
        .select({ place: places })
        .from(places)
        .innerJoin(trips, eq(trips.placeId, places.id))
        .where(eq(trips.actorId, actorId))
        .groupBy(places.id)
        .orderBy(desc(max(trips.startedAt)), asc(places.id))
        .limit(rowLimit(limit))
      return rows.map((row) => toPlace(row.place))
    },
  }
}
