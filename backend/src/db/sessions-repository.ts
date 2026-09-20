import { and, eq, gt, sql } from 'drizzle-orm'
import { sessionSchema } from '@molvia/model'
import type { Session } from '@molvia/model'
import { sha256Hex } from './digest'
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
}

function toSession(row: typeof sessions.$inferSelect): Session {
  return sessionSchema.parse(row)
}

export function createSessionRepository(db: Conn): SessionRepository {
  return {
    async create(id, actorId, token, deviceName, expiresAt) {
      // An actor that is not there is an ordinary answer rather than a defect — an account
      // deleted between reading the login request and issuing the session — so the foreign
      // key comes back as NOT_FOUND instead of a 500.
      return translateFailures(async () => {
        const [row] = await db
          .insert(sessions)
          .values({ id, actorId, tokenHash: sha256Hex(token), deviceName, expiresAt })
          .returning()
        return toSession(theRow(row, 'sessions'))
      })
    },

    async byToken(token) {
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
