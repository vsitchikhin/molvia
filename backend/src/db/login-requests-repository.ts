import { and, eq, isNull, or, sql } from 'drizzle-orm'
import {
  DomainError,
  ERROR,
  LOGIN_LIFETIME_SECONDS,
  LOGIN_WINDOW_LIMIT,
  LOGIN_WINDOW_SECONDS,
  deviceNameOrNull,
  loginCodeSchema,
  loginRequestSchema,
  newLoginRequestSchema,
  telegramUserIdSchema,
} from '@molvia/model'
import type { LoginRequest, NewLoginRequest, TelegramUserId } from '@molvia/model'
import { sha256Hex } from './digest'
import { secretOrNull } from '@/secret'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, theRow } from './rows'
import { loginRequests } from './schema'
import { lockTelegramAccount } from './telegram-lock'

export interface LoginRequestRepository {
  /** Lock before checking time: waiting for another write must not extend a login. */
  lock(id: string, secret: string): Promise<void>
  createLimited(
    id: string,
    code: string,
    secret: string,
    deviceName: string | null,
  ): Promise<LoginRequest>
  removeExpired(): Promise<void>

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

  /**
   * What the bot has in hand after `/start <code>`: a live request, **confirmed or not**.
   *
   * It used to exclude a confirmed one, and that is what made a lost answer read as a lie
   * (MOL-55, О-2): the person was told the link no longer worked while the session was being
   * collected. Who confirmed it stays here — the row carries `telegramUserId`, and by Р-11 that
   * number does not leave the server; what the bot is told is only *that* it is confirmed.
   */
  byCode(code: string): Promise<LoginRequest | null>

  /**
   * «Sign in» in the bot. Naming the account is the only thing the bot adds.
   *
   * Both arguments arrive from outside — the code is the payload of `/start`, the account is
   * `ctx.from.id` — so both are judged the same way and independently of each other: anything
   * no row could carry answers `null`, the same nothing an unknown code answers. It used to
   * depend on the order they were checked in, so one bad account id could be silence or a 500
   * depending on which code travelled beside it (adversarial Р2).
   *
   * **The same account confirming again is answered as a success** (MOL-55, О-2): a reply that
   * never arrived left the bot unable to tell «not written» from «written, answer lost», and it
   * chose the wrong one. Nothing moves on that second call — the account a request names is
   * still written exactly once — so it is idempotent rather than repeated. **Another** account
   * is still refused, which is the whole point of the button.
   */
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

async function insert(
  db: Conn,
  secret: string,
  fields: Omit<NewLoginRequest, 'deviceName'> & { readonly deviceName: string | null },
): Promise<LoginRequest> {
  // As in the session repository: a secret this server could not have minted means a caller
  // went around the path that mints one, and there is nothing to answer a client with.
  if (secretOrNull(secret) === null) {
    throw new Error('a secret this server could not have minted reached the login repository')
  }

  const input = newLoginRequestSchema.parse({
    ...fields,
    // Decoration: cut if too long, `null` if it draws nothing — the rule sessions apply.
    deviceName: deviceNameOrNull(fields.deviceName),
  })

  return translateFailures(async () => {
    const [row] = await db
      .insert(loginRequests)
      .values({ ...input, secretHash: sha256Hex(secret) })
      .returning()
    return toLoginRequest(theRow(row, 'login_requests'))
  })
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
  const live = sql`${loginRequests.consumedAt} is null and ${loginRequests.expiresAt} > clock_timestamp()`

  return {
    async removeExpired() {
      // `skip locked`: a row somebody holds is left for the next pass (MOL-58, adversarial Р-3).
      // Erasure holds every request of the person it erases, expired ones too, and this runs
      // under the one quota lock every start of a login takes — waiting here closed the door to
      // everybody for as long as one erasure, or one dry run of it, took.
      await db.delete(loginRequests).where(
        sql`${loginRequests.id} in (
          select ${loginRequests.id} from ${loginRequests}
          where ${loginRequests.expiresAt} <= clock_timestamp()
          for update skip locked)`,
      )
    },

    async createLimited(id, code, secret, deviceName) {
      return db.transaction(async (tx) => {
        // One quota for this database, including concurrent starts and process restarts.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended('molvia:login-quota', 0))`,
        )
        const repository = createLoginRequestRepository(tx)
        await repository.removeExpired()
        const [count] = await tx
          .select({ value: sql<number>`count(*)`.mapWith(Number) })
          .from(loginRequests)
          .where(
            sql`${loginRequests.createdAt} > clock_timestamp() - make_interval(secs => ${LOGIN_WINDOW_SECONDS})`,
          )
        if ((count?.value ?? 0) >= LOGIN_WINDOW_LIMIT)
          throw new DomainError(ERROR.LOGIN_RATE_LIMITED)
        // Read the clock after the quota lock, not at the transaction's earlier start, and
        // write it in the same statement: the quota above counts by this very column.
        const [clock] = await tx.execute<{ at: string }>(sql`select clock_timestamp()::text as at`)
        if (!clock) throw new Error('database returned no login clock')
        const createdAt = new Date(clock.at)
        return insert(tx, secret, {
          id,
          code,
          deviceName,
          createdAt,
          expiresAt: new Date(createdAt.getTime() + LOGIN_LIFETIME_SECONDS * 1000),
        })
      })
    },

    async lock(id, secret) {
      if (idOrNull(id) === null || secretOrNull(secret) === null) return
      await db
        .select({ id: loginRequests.id })
        .from(loginRequests)
        .where(and(eq(loginRequests.id, id), eq(loginRequests.secretHash, sha256Hex(secret))))
        .for('update')
    },

    async create(id, code, secret, deviceName, expiresAt) {
      return insert(db, secret, { id, code, deviceName, expiresAt })
    },

    async byCode(code) {
      if (codeOrNull(code) === null) return null

      const [row] = await db
        .select()
        .from(loginRequests)
        .where(and(eq(loginRequests.code, code), live))
        .limit(1)
      return row ? toLoginRequest(row) : null
    },

    async confirm(code, telegramUserId) {
      // Neither guard is allowed to shadow the other: both inputs come from the bot, and the
      // answer to a bad one must not depend on what was passed beside it (Р2). A number the
      // column could never hold is not this server's defect and not worth a 500 — it is a
      // confirmation that cannot happen, which is what `null` already means here.
      const named = telegramUserIdSchema.safeParse(telegramUserId).success
      if (codeOrNull(code) === null || !named) return null

      // Unconfirmed, or confirmed by this very account. Pressing the button twice must not
      // move the account a request names — and it cannot: the second press matches a row that
      // already holds this id and writes the same value over it. Another account matches
      // nothing, which is the refusal the button exists for.
      // Never inside an erasure of the same account: an erasure in progress holds this lock, and
      // the confirmation comes after it rather than making an owner it has already looked for.
      const [row] = await db.transaction(async (tx) => {
        await tx.execute(lockTelegramAccount(telegramUserId))
        return tx
          .update(loginRequests)
          .set({ telegramUserId })
          .where(
            and(
              eq(loginRequests.code, code),
              live,
              or(
                isNull(loginRequests.telegramUserId),
                eq(loginRequests.telegramUserId, telegramUserId),
              ),
            ),
          )
          .returning()
      })
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
