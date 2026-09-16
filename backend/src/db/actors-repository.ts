import { eq } from 'drizzle-orm'
import { actorSchema } from '@molvia/model'
import type { Actor, ActorPatch, NewActor } from '@molvia/model'
import type { Conn } from './index'
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

/** `RETURNING` on a successful write always yields the row; its absence is a defect here. */
function theRow(row: typeof actors.$inferSelect | undefined): typeof actors.$inferSelect {
  if (row === undefined) throw new Error('a write to actors returned no row')
  return row
}

// A repository is a function over a connection, not a module-level singleton: the
// integration tests point it at their own database, and the composition point in
// server.ts points it at the real one.
export function createActorRepository(db: Conn): ActorRepository {
  return {
    async create(id, input) {
      const [row] = await db
        .insert(actors)
        .values({ id, ...input })
        .returning()
      return toActor(theRow(row))
    },

    async byId(id) {
      const [row] = await db.select().from(actors).where(eq(actors.id, id)).limit(1)
      return row ? toActor(row) : null
    },

    async update(id, patch) {
      // `updated_at` is deliberately absent: `actors_touch_updated_at` moves it, so every
      // write path moves it — including the ones that never go through this file.
      const [row] = await db.update(actors).set(patch).where(eq(actors.id, id)).returning()
      return row ? toActor(row) : null
    },
  }
}
