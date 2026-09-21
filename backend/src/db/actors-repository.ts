import { eq } from 'drizzle-orm'
import { actorSchema, telegramUserIdSchema } from '@molvia/model'
import type { Actor, ActorPatch, NewActor, TelegramUserId } from '@molvia/model'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, theRow } from './rows'
import { actors } from './schema'

export interface ActorRepository {
  /**
   * The identifier is issued by the use case, not by this file and not by the device
   * (MOL-8): it is the only proof of identity the release has, so a client allowed to name
   * its own could name someone else's. `actors.id` has no default for the same reason —
   * a database default would be a second place that decides.
   */
  create(id: string, telegramUserId: TelegramUserId, input: NewActor): Promise<Actor>
  byId(id: string): Promise<Actor | null>

  /**
   * The owner behind a Telegram account, or nothing — «the person came back», which is the
   * only scenario the column exists for (MOL-52).
   *
   * It is here rather than in MOL-54 with its caller, against this task's own rule of shipping
   * no method without one, and the adversarial pass is why: without it a second login is a
   * dead end. `create` answers CONFLICT, the refusal carries no identifier, and `byId` wants a
   * uuid that a person arriving from Telegram does not have. A promise the schema makes aloud
   * and nothing can read is not delivered (А2).
   */
  byTelegramUserId(telegramUserId: TelegramUserId): Promise<Actor | null>
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
    async create(id, telegramUserId, input) {
      // Judged before the row exists, as everywhere else on a write path (MOL-52, А1). The
      // guard was in `byTelegramUserId` and in `confirm` and not here — so of the three places
      // that judge one number, two answered «nothing found» and the third let `23514` through
      // as a 500 (adversarial С1). `confirm` answers `null` because it reads a row and «no such
      // confirmation» is in its vocabulary; this method writes one and has no such word, so it
      // refuses the way the session and login schemas do: a caller's mistake, named, no row.
      telegramUserIdSchema.parse(telegramUserId)

      // Two ways to collide now, and only the second is an ordinary day. The identifier is a
      // fresh `randomUUID()`, so a primary-key collision is vanishingly unlikely;
      // `telegram_user_id` is unique too, and a second actor for the same Telegram account is
      // exactly what that constraint exists to refuse (MOL-52). Both arrive as `23505`, which
      // the wrapper turns into CONFLICT — unwrapped it went up untouched and a refused write
      // looked like a broken server.
      return translateFailures(async () => {
        const [row] = await db
          .insert(actors)
          .values({ id, telegramUserId, ...input })
          .returning()
        return toActor(theRow(row, 'actors'))
      })
    },

    async byTelegramUserId(telegramUserId) {
      // Judged before it reaches Postgres: a number outside the column's two bounds is not a
      // row that is missing, it is a value that could never have been written, and `bigint`
      // would answer with an error rather than with nothing found.
      if (!telegramUserIdSchema.safeParse(telegramUserId).success) return null

      const [row] = await db
        .select()
        .from(actors)
        .where(eq(actors.telegramUserId, telegramUserId))
        .limit(1)
      return row ? toActor(row) : null
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
