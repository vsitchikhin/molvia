import { sql } from 'drizzle-orm'
import { LOGIN_NOTICE_LEASE_SECONDS } from '@molvia/model'
import type { LoginNoticesTold, TelegramUserId } from '@molvia/model'
import type { Conn } from './index'
import { actors, loginNotices, sessions } from './schema'

/** A sign-in handed to the bot: whose chat, the session, the device and when. */
export interface HandedLoginNotice {
  readonly sessionId: string
  readonly telegramUserId: TelegramUserId
  /** The account's country, the zone its clock is read in. */
  readonly country: string
  readonly deviceName: string | null
  readonly signedInAt: Date
}

/**
 * «В ваш аккаунт вошло новое устройство» (MOL-361): the sign-ins the bot has yet to tell of. A row is
 * «not told yet»; handed to the bot it is marked, and the bot's word lets it go or gives it back.
 */
export interface LoginNoticeRepository {
  /**
   * The collection of a session puts its notice in the queue — in the collection's transaction, read
   * off the session's own row, so a session not written leaves no notice and the moment is the
   * database's. Only the collection calls it: the development seam signs in with no notice.
   */
  add(sessionId: string): Promise<void>

  /**
   * Hands over the oldest notice of each account, up to `limit` accounts, and marks them in the same
   * statement (adversarial А2: one person's sign-ins never hold another's back). **The account is
   * locked first, `for key share skip locked`** (adversarial А3): one an erasure holds is passed over,
   * and its notice goes with the erasure; the notices are marked after it, the order erasure takes
   * them in. A notice given back is due again at `not_before`, and ordered by it.
   */
  claim(limit: number): Promise<readonly HandedLoginNotice[]>

  /**
   * The bot's word on what it was handed: `told` let go, `back` handed again — after `afterSeconds`, or,
   * with `null`, as it stood. Only a notice still handed moves: a word that came after the lease let it
   * go changes nothing.
   */
  told(word: LoginNoticesTold): Promise<void>

  /** Lets go of what was handed and never spoken of past the lease — unsent: at most once. */
  removeLost(): Promise<void>
}

export function createLoginNoticeRepository(db: Conn): LoginNoticeRepository {
  return {
    async add(sessionId) {
      await db.execute(sql`
        insert into ${loginNotices} (session_id, actor_id, device_name, signed_in_at)
        select ${sessions.id}, ${sessions.actorId}, ${sessions.deviceName}, ${sessions.createdAt}
        from ${sessions} where ${sessions.id} = ${sessionId}`)
    },

    async claim(limit) {
      const rows = await db.execute<{
        session_id: string
        telegram_user_id: number
        country: string
        device_name: string | null
        signed_in_at: string
      }>(sql`
        with due as (
          select session_id, actor_id, coalesce(not_before, signed_in_at) as due_at,
            row_number() over (
              partition by actor_id order by coalesce(not_before, signed_in_at), session_id
            ) as place
          from ${loginNotices}
          where handed_at is null and (not_before is null or not_before <= clock_timestamp())
        ), firsts as (
          select d.session_id, d.due_at from due d join ${actors} a on a.id = d.actor_id
          where d.place = 1
          order by d.due_at, d.session_id
          limit ${limit}
          for key share of a skip locked
        ), handed as (
          update ${loginNotices} n set handed_at = clock_timestamp()
          from firsts f
          where n.session_id = f.session_id and n.handed_at is null
          returning n.session_id, n.actor_id, n.device_name, n.signed_in_at,
            coalesce(n.not_before, n.signed_in_at) as due_at
        )
        select h.session_id, a.telegram_user_id::float8 as telegram_user_id, a.country,
          h.device_name, h.signed_in_at
        from handed h join ${actors} a on a.id = h.actor_id
        order by h.due_at, h.session_id`)
      return rows.map((row) => ({
        sessionId: row.session_id,
        telegramUserId: row.telegram_user_id,
        country: row.country,
        deviceName: row.device_name,
        signedInAt: new Date(row.signed_in_at),
      }))
    },

    async told({ told, back }) {
      if (told.length > 0) {
        await db.execute(sql`
          delete from ${loginNotices}
          where handed_at is not null and session_id in (${sql.join(
            told.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`)
      }
      for (const { sessionId, afterSeconds } of back) {
        await db.execute(sql`
          update ${loginNotices}
          set handed_at = null,
            not_before = ${
              afterSeconds === null
                ? sql`not_before`
                : sql`clock_timestamp() + make_interval(secs => ${afterSeconds})`
            }
          where session_id = ${sessionId}::uuid and handed_at is not null`)
      }
    },

    async removeLost() {
      await db.execute(sql`
        delete from ${loginNotices}
        where handed_at <= clock_timestamp() - make_interval(secs => ${LOGIN_NOTICE_LEASE_SECONDS})`)
    },
  }
}
