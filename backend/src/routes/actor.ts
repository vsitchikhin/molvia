import { ACTOR_HEADER, DomainError, ERROR, INVITE_HEADER } from '@molvia/model'
import type { Actor } from '@molvia/model'
import type { FastifyInstance, FastifyRequest } from 'fastify'

/** Turning an identifier into an owner, or refusing — the use case, already bound. */
export type ActorLookup = (id: string) => Promise<Actor>

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Both are set by `withActor` before anything else runs, and both come from the same
     * single read: `actorId` is what every later use case takes (MOL-12, MOL-21, MOL-27),
     * `actor` is there so the one route that returns the owner does not fetch it twice.
     */
    actorId: string
    actor: Actor | null
  }
}

/**
 * The one place a request is turned into an owner. A hook over a whole scope rather than a
 * line in each handler: a check that can be forgotten in one route out of ten is exactly
 * what IDOR is, and the repositories of MOL-7 already expect a trustworthy `actorId` in
 * every `WHERE`.
 *
 * On `onRequest`, which runs **before the body is read**. As a `preHandler` it ran after:
 * a stranger's megabyte was buffered and parsed before being refused, and a large enough
 * body answered 413 instead of 401 — so what an uninvited caller learned depended on what
 * it sent rather than on the door.
 */
export function withActor(app: FastifyInstance, lookup: ActorLookup): void {
  app.decorateRequest('actorId', '')
  app.decorateRequest('actor', null)

  app.addHook('onRequest', async (request: FastifyRequest) => {
    const sent = request.headers[ACTOR_HEADER]

    // No header at all, a header that is not a uuid, and a well-formed uuid with no row
    // behind it all answer the same way on purpose: a difference between them is how
    // someone else's identifiers get found by comparing replies.
    if (typeof sent !== 'string') throw new DomainError(ERROR.NO_ACTOR)

    const actor = await lookup(sent)
    request.actor = actor
    request.actorId = actor.id
  })
}

/**
 * The door of the first visit, over the scope that creates identities. Also `onRequest`:
 * refusing a stranger should cost nothing but a header comparison.
 *
 * «No code» and «wrong code» answer identically — a difference would confirm to a stranger
 * that a code is what they are missing.
 */
export function withInvite(app: FastifyInstance, expected: string): void {
  app.addHook('onRequest', (request: FastifyRequest) => {
    if (request.headers[INVITE_HEADER] !== expected) throw new DomainError(ERROR.NO_ACTOR)
    return Promise.resolve()
  })
}
