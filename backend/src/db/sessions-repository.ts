import { and, eq, gt, sql } from 'drizzle-orm'
import { actorSchema, deviceNameOrNull, newSessionSchema, sessionSchema } from '@molvia/model'
import type { Actor, Session } from '@molvia/model'
import { sha256Hex } from './digest'
import { secretOrNull } from '@/secret'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, theRow } from './rows'
import { actors, sessions } from './schema'

/** A live session and the owner behind it — what every request to the API needs at once. */
export interface LiveSession {
  readonly session: Session
  readonly actor: Actor
}

export interface SessionRepository {
  /**
   * Takes the token itself and writes only its digest.
   *
   * The interface speaks in raw tokens on purpose (MOL-52, Р-6): «the token is in the database
   * only as a hash» then holds in one place, and no later caller can put the token in the
   * column by mistake, because there is no method that would take it.
   *
   * The input is judged **before** the row exists (`newSessionSchema`). It used to be judged
   * after, on the way back through `sessionSchema`, and that was a defect of its own: an
   * unusable device name left a session written, unreadable and holding its token's unique
   * index, while the caller got a ZodError — a 500 *with* a row rather than instead of one
   * (adversarial А1).
   */
  create(
    id: string,
    actorId: string,
    token: string,
    deviceName: string | null,
    expiresAt: Date,
  ): Promise<Session>

  /**
   * The live session behind a token **and the owner behind it**, or nothing.
   *
   * A token nobody issued, a token of a session that was revoked, and a token of one that ran
   * out all return `null` — not by agreement between three branches, but because there is one
   * `WHERE` and they all fail it. That is what lets MOL-53 answer every one of them with the
   * same 401 without having to remember to.
   *
   * **One statement, with a join** (MOL-53, Р-5). It was `byToken`, returning the session alone,
   * and then the owner had to be read separately — two trips to the database on **every**
   * request to the API. There is no second method beside this one for the same reason there was
   * no reason to keep the old shape: two places that answer «whose request is this» are two
   * places that can drift.
   */
  liveByToken(token: string): Promise<LiveSession | null>

  /**
   * Moves `last_seen_at` and slides `expires_at` — but only if the row has not been touched for
   * `afterHours`. Answers the new expiry when it wrote, and `null` when it did not.
   *
   * **The «is it due» test is inside the `WHERE` and not in the caller**, although the caller
   * checks it too (to avoid a pointless round trip). Two requests arriving together would
   * otherwise both decide it is time and both write; here the second matches no row, answers
   * nothing, and simply does not re-set the cookie — which is the right outcome rather than a
   * failure.
   *
   * `now()` throughout, never a `Date` from this process: the same clock that wrote
   * `created_at` and the same one `liveByToken` judges life by.
   *
   * **Known limit, named rather than met later** (MOL-53, А6): the new expiry is
   * `now() + lifetimeDays` whatever the row was issued with, so a session deliberately given a
   * short life becomes a full one the first time it is used. Nothing in 0.1 issues a short
   * session except the fixtures, and there it is harmless. If MOL-54 or MOL-57 want one — «sign
   * in on this device for a day» — this method has to learn the term the row was issued with,
   * and that is a column, not a line.
   */
  touch(id: string, afterHours: number, lifetimeDays: number): Promise<Date | null>

  /**
   * **Two methods this table needs and does not have here: removing a session and listing an
   * owner's.** Both are decisions of MOL-52 — «revoking is deleting the row», «the device list
   * is what is left of the table», and `sessions_actor_idx` is in the schema for the second —
   * but their callers are MOL-57, and a method with no caller is a method no test exercises
   * for real. Said out loud rather than left to be noticed: the repository is delivered for
   * the login of MOL-53 and MOL-54, not for the settings screen (adversarial А2).
   */
}

function toSession(row: typeof sessions.$inferSelect): Session {
  return sessionSchema.parse(row)
}

export function createSessionRepository(db: Conn): SessionRepository {
  return {
    async create(id, actorId, token, deviceName, expiresAt) {
      // A plain Error, as `actors-repository` does for an empty patch: a token this server
      // could not have minted means a caller went around the only path that mints one, and
      // there is no answer to give a client — only a 500 with a log line. Left as a defect,
      // but named, and refused before a row exists (adversarial А6).
      if (secretOrNull(token) === null) {
        throw new Error('a token this server could not have minted reached the session repository')
      }

      const input = newSessionSchema.parse({
        id,
        actorId,
        // The one input here that is pure decoration, so it is brought to a usable shape
        // rather than refused: too long is cut, drawing nothing is `null`. Everything else in
        // `newSessionSchema` is refused outright, because everything else is either this
        // server's own doing or a fact about the account.
        deviceName: deviceNameOrNull(deviceName),
        expiresAt,
      })

      // An actor that is not there is an ordinary answer rather than a defect — an account
      // deleted between reading the login request and issuing the session — so the foreign
      // key comes back as NOT_FOUND instead of a 500.
      return translateFailures(async () => {
        const [row] = await db
          .insert(sessions)
          .values({ ...input, tokenHash: sha256Hex(token) })
          .returning()
        return toSession(theRow(row, 'sessions'))
      })
    },

    async liveByToken(token) {
      // A token that could never have been minted here matches nothing, and says so as `null`
      // rather than by hashing something else: `sha256Hex` folds a lone surrogate into U+FFFD,
      // so two such strings share a digest (adversarial А6). Refusing the shape at the door
      // keeps the hash an identity of the token rather than almost one.
      if (secretOrNull(token) === null) return null

      // `now()` and not a Date from this process: the row's own clock decides whether it is
      // still alive, the same clock that wrote `created_at`. A server whose time drifted
      // would otherwise hand out minutes of life that the database does not agree exist.
      const [row] = await db
        .select({ session: sessions, actor: actors })
        .from(sessions)
        .innerJoin(actors, eq(actors.id, sessions.actorId))
        .where(and(eq(sessions.tokenHash, sha256Hex(token)), gt(sessions.expiresAt, sql`now()`)))
        .limit(1)
      return row ? { session: toSession(row.session), actor: actorSchema.parse(row.actor) } : null
    },

    async touch(id, afterHours, lifetimeDays) {
      // A malformed identifier is not this server's defect to raise a `22P02` over — it matches
      // no row, which is what `null` already says. The same guard the login repository applies.
      if (idOrNull(id) === null) return null

      const [row] = await db
        .update(sessions)
        .set({
          lastSeenAt: sql`now()`,
          expiresAt: sql`now() + make_interval(days => ${lifetimeDays}::int)`,
        })
        .where(
          and(
            eq(sessions.id, id),
            sql`${sessions.lastSeenAt} < now() - make_interval(hours => ${afterHours}::int)`,
            // A session that ran out between being read and being touched must not be brought
            // back to life by the very statement that extends it.
            gt(sessions.expiresAt, sql`now()`),
          ),
        )
        .returning({ expiresAt: sessions.expiresAt })
      return row?.expiresAt ?? null
    },
  }
}
