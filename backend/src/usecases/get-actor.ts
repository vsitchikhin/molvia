import { DomainError, ERROR } from '@molvia/model'
import type { Actor } from '@molvia/model'
import type { ActorRepository } from '@/db/actors-repository'

/**
 * Whoever presents the identifier is the owner, so a miss is not «no such row» — it is a
 * request that failed to name a subject at all, and it answers 401 rather than 404 (Р-4).
 * A malformed identifier arrives here as `null` from the repository and takes the same path:
 * telling the two apart is how someone else's identifiers get guessed from the replies.
 */
export async function getActor(actors: ActorRepository, id: string): Promise<Actor> {
  const actor = await actors.byId(id)
  if (!actor) throw new DomainError(ERROR.NO_ACTOR)
  return actor
}
