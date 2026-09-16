import { eq } from 'drizzle-orm'
import { actorSchema } from '@molvia/model'
import type { Actor, ActorPatch, NewActor } from '@molvia/model'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, theRow } from './rows'
import { actors } from './schema'

export interface ActorRepository {
  /** The identifier comes from the device (MOL-8); `actors.id` has no default on purpose. */
  create(id: string, input: NewActor): Promise<Actor>
  byId(id: string): Promise<Actor | null>
  update(id: string, patch: ActorPatch): Promise<Actor | null>
}

/**
 * A row becomes an entity only by passing the domain's own schema. The cost is that a row
 * written by an older version can stop parsing and fail the read — which is the point: the
 * error handler already treats a ZodError that did not come from a request body as this
 * server's fault, logs it and answers 500, instead of serving a shape nobody can rely on.
 */
function toActor(row: typeof actors.$inferSelect): Actor {
  return actorSchema.parse(row)
}

// A repository is a function over a connection, not a module-level singleton: the
// integration tests point it at their own database, and the composition point in
// server.ts points it at the real one.
export function createActorRepository(db: Conn): ActorRepository {
  return {
    async create(id, input) {
      // The identifier comes from the device, so a repeat is an ordinary day rather than a
      // defect: a retry after a timeout, a second tab, a restart carrying the same id.
      // Unwrapped, `23505` went up untouched and became a 500.
      return translateFailures(async () => {
        const [row] = await db
          .insert(actors)
          .values({ id, ...input })
          .returning()
        return toActor(theRow(row, 'actors'))
      })
    },

    async byId(id) {
      // The identifier arrives from a device, so a malformed one is an ordinary event, not a
      // defect: it matches no actor, and that is exactly what `null` says. Without this it
      // reached Postgres and came back as `22P02`, a 500.
      if (idOrNull(id) === null) return null

      const [row] = await db.select().from(actors).where(eq(actors.id, id)).limit(1)
      return row ? toActor(row) : null
    },

    async update(id, patch) {
      if (idOrNull(id) === null) return null

      // A parsed patch is never empty — `actorPatchSchema` refuses one, because it would only
      // bump `updated_at` — so an empty one here means a caller went around the domain. Left
      // as a defect (Р-11), but named: drizzle answers «No values to set», which says neither
      // the table nor who called it.
      if (Object.keys(patch).length === 0) {
        throw new Error('an actor patch with no fields reached the repository')
      }

      // `updated_at` is deliberately absent: `actors_touch_updated_at` moves it, so every
      // write path moves it — including the ones that never go through this file.
      const [row] = await db.update(actors).set(patch).where(eq(actors.id, id)).returning()
      return row ? toActor(row) : null
    },
  }
}
