import { DomainError, ERROR } from '@molvia/model'
import type { Actor } from '@molvia/model'
import type { FastifyInstance, FastifyRequest } from 'fastify'

/**
 * The header a request names its owner with. Not the path and not a query parameter: both
 * land in Caddy's access log, in browser history and in `Referer`, and this identifier is a
 * bearer key — whoever reads it is the owner. Not a cookie either: a cookie travels on
 * requests started by other sites, which is CSRF, and the bot has no cookie jar at all.
 */
export const ACTOR_HEADER = 'x-molvia-actor'

/** Turning an identifier into an owner, or refusing — the use case, already bound. */
export type ActorLookup = (id: string) => Promise<Actor>

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Both are set by `withActor` before any handler runs, and both come from the same
     * single read: `actorId` is what every later use case takes (MOL-12, MOL-21, MOL-27),
     * `actor` is there so the one route that returns the owner does not fetch it twice.
     */
    actorId: string
    actor: Actor | null
  }
}

/**
 * The one place a request is turned into an owner. Written as a hook over a whole scope
 * rather than a line in each handler: a check that can be forgotten in one route out of ten
 * is exactly what IDOR is, and the repositories of MOL-7 already expect a trustworthy
 * `actorId` in every `WHERE`.
 *
 * The actor itself is loaded, not merely the string: an identifier that matches no row would
 * otherwise reach an `INSERT` and come back as a foreign key violation — «start the trip
 * again» instead of «your identity is gone».
 */
export function withActor(app: FastifyInstance, lookup: ActorLookup): void {
  app.decorateRequest('actorId', '')
  app.decorateRequest('actor', null)

  app.addHook('preHandler', async (request: FastifyRequest) => {
    const sent = request.headers[ACTOR_HEADER]

    // No header at all, a header that is not a uuid, and a well-formed uuid with no row
    // behind it all answer the same way on purpose: a difference between them is how
    // someone else's identifiers get found by comparing replies. The last two are the use
    // case's own refusal, and this one matches it deliberately.
    if (typeof sent !== 'string') throw new DomainError(ERROR.NO_ACTOR)

    const actor = await lookup(sent)
    request.actor = actor
    request.actorId = actor.id
  })
}
