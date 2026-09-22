import { DomainError, ERROR, SESSION_LIFETIME_DAYS, SESSION_TOUCH_AFTER_HOURS } from '@molvia/model'
import type { Actor } from '@molvia/model'
import type { SessionRepository } from '@/db/sessions-repository'

export interface Authenticated {
  readonly actor: Actor
  /**
   * The new expiry, when the session was slid forward just now — and `null` when it was not.
   * The route re-sets the cookie on exactly this, so the browser and the row never disagree
   * about when the way in runs out.
   */
  readonly refreshedUntil: Date | null
}

/**
 * Turning a token into the owner behind it — the one thing every request to the API does
 * before anything else (MOL-53).
 *
 * **Four refusals, one answer.** No cookie, a token nobody was issued, a token of a session
 * that was revoked, a token of one that ran out: all of them arrive here as `null` from a
 * single `WHERE`, and all of them leave as the same `NO_ACTOR`. There is no branch to keep in
 * step, which is what makes «a difference between them is how identifiers get guessed» a
 * property of the code rather than a rule somebody has to remember.
 *
 * **Why the due date is judged here and not only in SQL.** `touch` refuses to write a row that
 * was touched less than a day ago, and that guard is what makes two simultaneous requests write
 * once. But calling it unconditionally would mean an `UPDATE` — a round trip — on **every**
 * request, which is exactly what Р-5 spent a join to avoid. So the session already in hand
 * answers «is it due» for free, and the statement is sent only when it is. The two clocks
 * differ by the network and by drift; at the boundary that costs at most one postponed
 * extension, and the database's own clock stays the one that decides.
 */
export async function authenticate(
  sessions: SessionRepository,
  token: string,
): Promise<Authenticated> {
  const live = await sessions.liveByToken(token)
  if (!live) throw new DomainError(ERROR.NO_ACTOR)

  const due = live.session.lastSeenAt.getTime() < Date.now() - SESSION_TOUCH_AFTER_HOURS * 3_600_000
  const refreshedUntil = due
    ? await sessions.touch(live.session.id, SESSION_TOUCH_AFTER_HOURS, SESSION_LIFETIME_DAYS)
    : null

  return { actor: live.actor, refreshedUntil }
}
