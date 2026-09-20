import { z } from 'zod'
import { DomainError, ERROR, actorCodec, actorViewSchema } from '@molvia/model'
import type { Actor } from '@molvia/model'
import type { FastifyInstance, FastifyReply } from 'fastify'

/**
 * The entity leaves through its codec rather than as the object the repository built: in the
 * domain the timestamps are `Date`, and JSON would turn them into strings silently — the
 * client would then parse a shape nothing promised it.
 *
 * Narrowed through `actorViewSchema` first, in one visible step (MOL-52): an `Actor` carries
 * `telegramUserId`, the view does not, and the wire schema is strict — so a narrowing that was
 * forgotten here fails loudly instead of leaking the identity to the screen.
 *
 * `no-store` travels with it. Until MOL-53 the identifier is still the proof of identity —
 * whoever reads it is the owner — so a shared cache or a disk cache holding this reply is the
 * whole account sitting in a file nobody meant to write.
 */
export function answerWithActor(reply: FastifyReply, actor: Actor): FastifyReply {
  return reply
    .header('cache-control', 'no-store')
    .send(z.encode(actorCodec, actorViewSchema.parse(actor)))
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
