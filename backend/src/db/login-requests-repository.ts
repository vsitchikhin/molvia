import { and, eq, isNull, sql } from 'drizzle-orm'
import {
  deviceNameSchema,
  loginCodeSchema,
  loginRequestSchema,
  newLoginRequestSchema,
  telegramUserIdSchema,
} from '@molvia/model'
import type { LoginRequest, TelegramUserId } from '@molvia/model'
import { secretOrNull, sha256Hex } from './digest'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, theRow } from './rows'
import { loginRequests } from './schema'

export interface LoginRequestRepository {
  /**
   * Takes the browser's secret itself and writes only its digest, as sessions do (Р-6), and
   * judges what it was given **before** a row exists (`newLoginRequestSchema`) — a code the
   * database would refuse used to leave nothing but an untranslated `22001`, and an unusable
   * device name left a row whose own schema would not read it back (adversarial А1, А5).
   */
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

  /**
   * What the **server** may read on a poll: the browser's own live request, confirmed or not.
   *
   * Not «what the browser is allowed to see», which is what this used to say: the row carries
   * `telegramUserId`, and by Р-11 that number does not leave the server. What MOL-54 answers a
   * poll with is its own decision, and this method is not a licence to pass the row through
   * (selfreview С-6).
   */
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

/** Decoration, so an unusable one becomes «no name» — the same rule sessions apply. */
const usableDeviceName = deviceNameSchema.nullable().catch(null)

/**
 * A code as it reached us, or `null` when no row could ever carry it.
 *
 * The same guard `idOrNull` is for `id`, and for the same reason: a code arrives from outside
 * — it is the payload of `/start` in the bot, and MOL-55 will look one up on every «this link
 * has already been used». A `code` with a NUL byte reached Postgres and came back `22021`,
 * that is a 500, which is a *third* distinguishable answer where the whole point is that there
 * is one (adversarial А3).
 */
function codeOrNull(code: string): string | null {
  return loginCodeSchema.safeParse(code).success ? code : null
}

export function createLoginRequestRepository(db: Conn): LoginRequestRepository {
  /**
   * Alive: not spent, not put out, not run out. Every read below starts here, which is what
   * makes «expired», «already used» and «no such request» one and the same `null` rather than
   * three branches somebody has to keep in step (MOL-52, проверка 4).
   *
   * The guards above it — `codeOrNull`, `idOrNull`, `secretOrNull` — are the rest of that same
   * promise: a value no row could carry has to answer with the same nothing, not with an error
   * from Postgres about its shape.
   */
  const live = sql`${loginRequests.consumedAt} is null and ${loginRequests.expiresAt} > now()`

  return {
    async create(id, code, secret, deviceName, expiresAt) {
      // As in the session repository: a secret this server could not have minted means a caller
      // went around the path that mints one, and there is nothing to answer a client with.
      if (secretOrNull(secret) === null) {
        throw new Error('a secret this server could not have minted reached the login repository')
      }

      const input = newLoginRequestSchema.parse({
        id,
        code,
        deviceName: usableDeviceName.parse(deviceName),
        expiresAt,
      })

      return translateFailures(async () => {
        const [row] = await db
          .insert(loginRequests)
          .values({ ...input, secretHash: sha256Hex(secret) })
          .returning()
        return toLoginRequest(theRow(row, 'login_requests'))
      })
    },

    async byCode(code) {
      if (codeOrNull(code) === null) return null

      const [row] = await db
        .select()
        .from(loginRequests)
        .where(and(eq(loginRequests.code, code), live, isNull(loginRequests.telegramUserId)))
        .limit(1)
      return row ? toLoginRequest(row) : null
    },

    async confirm(code, telegramUserId) {
      if (codeOrNull(code) === null) return null
      // The account the bot names comes from Telegram, so its bounds are checked where the
      // value arrives rather than by the CHECK at the end of the journey: `23514` is a 500
      // for what is plainly a caller's mistake (А5).
      telegramUserIdSchema.parse(telegramUserId)

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
      if (codeOrNull(code) === null) return null

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
      // and a third distinguishable answer where there must be only one. The secret is held to
      // the shape this server mints for the reason given in `digest.ts`.
      if (idOrNull(id) === null || secretOrNull(secret) === null) return null

      const [row] = await db
        .select()
        .from(loginRequests)
        .where(and(eq(loginRequests.id, id), eq(loginRequests.secretHash, sha256Hex(secret)), live))
        .limit(1)
      return row ? toLoginRequest(row) : null
    },

    async consume(id, secret) {
      if (idOrNull(id) === null || secretOrNull(secret) === null) return null

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
