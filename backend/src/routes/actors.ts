import { z } from 'zod'
import { DomainError, ERROR, actorCodec } from '@molvia/model'
import type { Actor } from '@molvia/model'
import type { FastifyInstance, FastifyReply } from 'fastify'

/**
 * The entity leaves through its codec rather than as the object the repository built: in the
 * domain the timestamps are `Date`, and JSON would turn them into strings silently — the
 * client would then parse a shape nothing promised it.
 *
 * What keeps the Telegram id off the wire is not this function but `actorViewSchema` itself,
 * which the codec decodes to: `z.encode` parses its input through that schema first, so a field
 * the view does not name is gone before `encode` runs. An earlier version called
 * `actorViewSchema.parse(actor)` here and claimed in this very comment that forgetting it would
 * «fail loudly» — measured, it did nothing at all, because the codec had already done it
 * (adversarial Б2). The safeguard that does work is that the view is an allowlist.
 *
 * `no-store` travels with it, and the reason changed with MOL-53 rather than going away. The
 * identifier is no longer a password — a session token is — so a cached copy of this reply is
 * not the account itself any more. It is still one person's settings sitting in a file a shared
 * cache may hand to the next reader, which is reason enough on a reply that names somebody.
 */
export function answerWithActor(reply: FastifyReply, actor: Actor): FastifyReply {
  return reply.header('cache-control', 'no-store').send(z.encode(actorCodec, actor))
}

/**
 * «Who am I». Registered by the composition point **inside the guarded scope**, next to
 * every other route that needs an owner — which is the point: the safe place has to be the
 * one routes are added to anyway, not one hidden inside another module.
 */
export function actorMeRoute(app: FastifyInstance): void {
  app.get('/actors/me', (request, reply) => {
    // The row the hook already read: asking for it again would be a second trip to the
    // database for an answer this request is already holding. Checked rather than asserted
    // — the hook guarantees it, and a reader should not have to know that to trust this.
    const actor = request.actor
    if (!actor) throw new DomainError(ERROR.NO_ACTOR)

    return answerWithActor(reply, actor)
  })
}
