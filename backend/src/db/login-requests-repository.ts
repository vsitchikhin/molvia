import { and, eq, isNull, sql } from 'drizzle-orm'
import { loginRequestSchema } from '@molvia/model'
import type { LoginRequest, TelegramUserId } from '@molvia/model'
import { sha256Hex } from './digest'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, theRow } from './rows'
import { loginRequests } from './schema'

export interface LoginRequestRepository {
  /** Takes the browser's secret itself and writes only its digest, as sessions do (Р-6). */
  create(
    id: string,
    code: string,
    secret: string,
    deviceName: string | null,
    expiresAt: Date,
  ): Promise<LoginRequest>

  /** What the bot has in hand after `/start <code>`: a request still waiting for an answer. */
  byCode(code: string): Promise<LoginRequest | null>

  /** «Sign in» in the bot. Naming the account is the only thing the bot adds. */
  confirm(code: string, telegramUserId: TelegramUserId): Promise<LoginRequest | null>

  /** «This was not me». Puts the request out without confirming it — the fourth state (Р-9). */
  decline(code: string): Promise<LoginRequest | null>

  /** What the waiting browser is allowed to see: its own live request, confirmed or not. */
  byIdAndSecret(id: string, secret: string): Promise<LoginRequest | null>

  /**
   * The session being collected, handed over **once**.
   *
   * The check and the write are one statement, so two windows polling together cannot both
   * come away with a row: the second `UPDATE` matches nothing, because the first has already
   * set `consumed_at`. Anything weaker here is a login that can be spent twice — which is a
   * second session on a button somebody pressed once.
   */
  consume(id: string, secret: string): Promise<LoginRequest | null>
}

function toLoginRequest(row: typeof loginRequests.$inferSelect): LoginRequest {
  return loginRequestSchema.parse(row)
}

export function createLoginRequestRepository(db: Conn): LoginRequestRepository {
  /**
   * Alive: not spent, not put out, not run out. Every read below starts here, which is what
   * makes «expired», «already used» and «no such request» one and the same `null` rather than
   * three branches somebody has to keep in step (MOL-52, проверка 4).
   */
  const live = sql`${loginRequests.consumedAt} is null and ${loginRequests.expiresAt} > now()`

  return {
    async create(id, code, secret, deviceName, expiresAt) {
      return translateFailures(async () => {
        const [row] = await db
          .insert(loginRequests)
          .values({ id, code, secretHash: sha256Hex(secret), deviceName, expiresAt })
          .returning()
        return toLoginRequest(theRow(row, 'login_requests'))
      })
    },

    async byCode(code) {
      const [row] = await db
        .select()
        .from(loginRequests)
        .where(and(eq(loginRequests.code, code), live, isNull(loginRequests.telegramUserId)))
        .limit(1)
      return row ? toLoginRequest(row) : null
    },

    async confirm(code, telegramUserId) {
      // Only while unconfirmed: pressing the button twice must not move the account the
      // request names. The second press finds nothing and says so, which is what MOL-55 shows
      // as «this link has already been used».
      const [row] = await db
        .update(loginRequests)
        .set({ telegramUserId })
        .where(and(eq(loginRequests.code, code), live, isNull(loginRequests.telegramUserId)))
        .returning()
      return row ? toLoginRequest(row) : null
    },

    async decline(code) {
      // Put out by the same column that a spent login sets, and deliberately so: a refusal
      // and a collected session have one reader and one answer — «there is no such request».
      const [row] = await db
        .update(loginRequests)
        .set({ consumedAt: sql`now()` })
        .where(and(eq(loginRequests.code, code), live))
        .returning()
      return row ? toLoginRequest(row) : null
    },

    async byIdAndSecret(id, secret) {
      // A malformed identifier is an ordinary event rather than a defect — it matches no row,
      // which is exactly what `null` says. Without this it reached Postgres as `22P02`, a 500,
      // and a third distinguishable answer where there must be only one.
      if (idOrNull(id) === null) return null

      const [row] = await db
        .select()
        .from(loginRequests)
        .where(and(eq(loginRequests.id, id), eq(loginRequests.secretHash, sha256Hex(secret)), live))
        .limit(1)
      return row ? toLoginRequest(row) : null
    },

    async consume(id, secret) {
      if (idOrNull(id) === null) return null

      const [row] = await db
        .update(loginRequests)
        .set({ consumedAt: sql`now()` })
        .where(
          and(
            eq(loginRequests.id, id),
            eq(loginRequests.secretHash, sha256Hex(secret)),
            live,
            // Confirmed, or there is no session to hand over yet. The browser polls while the
            // person is still in the bot, and those polls must leave the request alone.
            sql`${loginRequests.telegramUserId} is not null`,
          ),
        )
        .returning()
      return row ? toLoginRequest(row) : null
    },
  }
}
