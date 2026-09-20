import { and, eq, gt, sql } from 'drizzle-orm'
import { deviceNameOrNull, newSessionSchema, sessionSchema } from '@molvia/model'
import type { Session } from '@molvia/model'
import { secretOrNull, sha256Hex } from './digest'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { theRow } from './rows'
import { sessions } from './schema'

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
   * The owner of a live session, or nothing.
   *
   * A token nobody issued, a token of a session that was revoked, and a token of one that ran
   * out all return `null` — not by agreement between three branches, but because there is one
   * `WHERE` and they all fail it. That is what lets MOL-53 answer every one of them with the
   * same 401 without having to remember to.
   */
  byToken(token: string): Promise<Session | null>

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

    async byToken(token) {
      // A token that could never have been minted here matches nothing, and says so as `null`
      // rather than by hashing something else: `sha256Hex` folds a lone surrogate into U+FFFD,
      // so two such strings share a digest (adversarial А6). Refusing the shape at the door
      // keeps the hash an identity of the token rather than almost one.
      if (secretOrNull(token) === null) return null

      // `now()` and not a Date from this process: the row's own clock decides whether it is
      // still alive, the same clock that wrote `created_at`. A server whose time drifted
      // would otherwise hand out minutes of life that the database does not agree exist.
      const [row] = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.tokenHash, sha256Hex(token)), gt(sessions.expiresAt, sql`now()`)))
        .limit(1)
      return row ? toSession(row) : null
    },
  }
}
