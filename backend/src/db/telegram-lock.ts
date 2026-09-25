import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { TelegramUserId } from '@molvia/model'

/**
 * A transaction-long lock on one Telegram account, taken by the two things that must not
 * interleave for it: erasing the person and confirming a login in their name (MOL-58,
 * adversarial П-2).
 *
 * The rows cannot carry this. A login started in the browser and not yet confirmed has no
 * Telegram id at all, so erasure has no row of it to lock — and one press of «Войти» landing
 * inside the erasure made an owner the erasure had already decided was not there. The bot
 * orders one chat's presses (`sequentialize`), but that is another module's promise, and the
 * two routes of the API have no order between them. With this lock a confirmation waits for an
 * erasure in progress and comes after it: a sign-in made after the person asked to be erased.
 *
 * Taken **first** by both, before any row: erasure then locks the requests and the owner,
 * confirmation one request row, and collection its request row before the owner — one order
 * everywhere, so no two of them can wait on each other.
 */
export function lockTelegramAccount(telegramUserId: TelegramUserId): SQL {
  return sql`select pg_advisory_xact_lock(hashtextextended(${`molvia:telegram:${String(telegramUserId)}`}, 0))`
}
