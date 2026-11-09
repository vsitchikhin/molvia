import { sql } from 'drizzle-orm'
import { telegramUserIdSchema } from '@molvia/model'
import type { TelegramUserId } from '@molvia/model'
import type { Conn } from './index'
import { actors, loginNotices, sessions } from './schema'

/** A sign-in taken off the queue for the bot: whose chat, the session, the device and when. */
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
 * «not told yet» and nothing else, so handing it out is deleting it — at most once (MOL-101 Р-2).
 */
export interface LoginNoticeRepository {
  /**
   * The collection of a session puts its notice in the queue — in the collection's transaction, read
   * off the session's own row, so a session not written leaves no notice and the moment is the
   * database's. Only the collection calls it: the development seam signs in with no notice.
   */
  add(sessionId: string): Promise<void>

  /**
   * Hands over the oldest notices and deletes them in the same statement, `skip locked`, so two claims
   * never share one. The account is read in the same statement: a notice whose account is being
   * erased waits in that erasure's lock and goes with it.
   */
  claim(limit: number): Promise<readonly HandedLoginNotice[]>
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
        with handed as (
          delete from ${loginNotices}
          where session_id in (
            select session_id from ${loginNotices}
            order by signed_in_at, session_id
            limit ${limit}
            for update skip locked)
          returning *)
        select h.session_id, a.telegram_user_id::float8 as telegram_user_id, a.country,
          h.device_name, h.signed_in_at
        from handed h join ${actors} a on a.id = h.actor_id
        order by h.signed_in_at, h.session_id`)
      return rows.map((row) => ({
        sessionId: row.session_id,
        telegramUserId: telegramUserIdSchema.parse(row.telegram_user_id),
        country: row.country,
        deviceName: row.device_name,
        signedInAt: new Date(row.signed_in_at),
      }))
    },
  }
}
