import { DomainError, ERROR, SESSIONS_LIMIT, resourceIdOf } from '@molvia/model'
import type { SessionsResponse } from '@molvia/model'
import type { SessionRepository } from '@/db/sessions-repository'

/**
 * «Устройства» (MOL-57): the owner's live sessions, the one this request came with first and
 * marked. Nothing here can name another owner — the owner is the authenticated one, and the
 * repository filters by them in the `WHERE`.
 */
export async function listSessions(
  sessions: SessionRepository,
  actorId: string,
  currentId: string,
): Promise<SessionsResponse> {
  const list = await sessions.listFor(actorId, currentId, SESSIONS_LIMIT)
  return {
    sessions: list.sessions.map((session) => ({
      id: session.id,
      deviceName: session.deviceName,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      current: session.id === currentId,
    })),
    total: list.total,
  }
}

/**
 * Ends one of the owner's sessions, and says whether it was the one the request came with.
 *
 * **The current one is allowed and is a way out like any other** (MOL-57: «the last session
 * leaves the same way as any») — the route then puts the cookie out, because the browser would
 * otherwise keep sending a token that opens nothing. The comparison is by the id as Postgres
 * spells it: `resource.ts` takes a path in either case (MOL-25, Р-3), and an upper-case id of the
 * current session must not end it while leaving its cookie on the disk.
 *
 * Someone else's, a missing one, an expired one and a malformed id are one `NOT_FOUND`.
 */
export async function endSession(
  sessions: SessionRepository,
  actorId: string,
  currentId: string,
  id: string,
): Promise<{ readonly endedCurrent: boolean }> {
  const removed = await sessions.removeFor(actorId, id)
  if (!removed) throw new DomainError(ERROR.NOT_FOUND)
  return { endedCurrent: resourceIdOf(id) === currentId }
}

/**
 * The way out of this device: deletes the session behind the token and nothing else.
 *
 * Answers nothing on purpose — a token of a session that is already gone is the outcome the
 * person asked for, so a repeat after a lost answer succeeds rather than refuses (the same shape
 * as `confirm` in MOL-55, О-2), and the route answers every call the same.
 */
export async function logout(sessions: SessionRepository, token: string): Promise<void> {
  await sessions.removeByToken(token)
}
