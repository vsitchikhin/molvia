import { z } from 'zod'
import { DomainError, ERROR, actorCodec } from '@molvia/model'
import type { Actor } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { INVITE_HEADER, withActor } from '@/routes/actor'
import type { ActorLookup } from '@/routes/actor'

/**
 * What these routes need, not where it comes from — the same shape `HealthProbe` has, and
 * the reason is the same: a route reaches the database through a use case or not at all.
 * The composition point binds the repository into both of these.
 */
export interface ActorApi {
  /** The first visit: the server issues the identifier and the four defaults. */
  create(): Promise<Actor>
  /** An identifier presented by a device, or a refusal. */
  byId: ActorLookup
  /**
   * What the invite header has to match. Handed in rather than read from the environment
   * here, so a test can stand the server up with a code it knows without touching
   * `process.env`.
   */
  signupCode: string
}

/**
 * The entity leaves through its codec rather than as the object the repository built: in the
 * domain the timestamps are `Date`, and JSON would turn them into strings silently — the
 * client would then parse a shape nothing promised it.
 */
function answer(actor: Actor) {
  return z.encode(actorCodec, actor)
}

export function actorRoutes(app: FastifyInstance, api: ActorApi): void {
  // The first visit has no owner by definition, so it is registered outside the scope that
  // demands one. `/health` stays outside for the same reason.
  app.post('/actors', async (request, reply) => {
    // Checked before the use case runs: a refusal should not cost a trip to the database,
    // and this route is the one thing in the product the whole internet can reach.
    // «No code» and «wrong code» answer identically — a difference would confirm to a
    // stranger that a code is what they are missing.
    if (request.headers[INVITE_HEADER] !== api.signupCode) throw new DomainError(ERROR.NO_ACTOR)

    return reply.code(201).send(answer(await api.create()))
  })

  // Everything below is inside a scope whose every request has already been turned into an
  // owner. New routes land here by default, which is the point: the safe place is the one
  // that needs no remembering.
  void app.register((scope, _options, done) => {
    withActor(scope, api.byId)

    scope.get('/actors/me', (request) => {
      // The row the hook already read: asking for it again would be a second trip to the
      // database for an answer this request is already holding. Checked rather than
      // asserted — the hook guarantees it, and a reader should not have to know that to
      // trust this line.
      const actor = request.actor
      if (!actor) throw new DomainError(ERROR.NO_ACTOR)

      return answer(actor)
    })

    done()
  })
}
