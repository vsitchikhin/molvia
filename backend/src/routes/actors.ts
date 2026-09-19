import { ZodError, z } from 'zod'
import { DomainError, ERROR, ISSUE, actorCodec } from '@molvia/model'
import type { Actor } from '@molvia/model'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { withInvite } from '@/routes/actor'
import { InvalidBody } from '@/parse'

/**
 * The entity leaves through its codec rather than as the object the repository built: in the
 * domain the timestamps are `Date`, and JSON would turn them into strings silently — the
 * client would then parse a shape nothing promised it.
 *
 * `no-store` travels with it. In 0.1 the identifier *is* the proof of identity — whoever
 * reads it is the owner — so a shared cache or a disk cache holding this reply is the whole
 * account sitting in a file nobody meant to write.
 */
function answer(reply: FastifyReply, actor: Actor) {
  return reply.header('cache-control', 'no-store').send(z.encode(actorCodec, actor))
}

/**
 * The first visit. Registered in its own scope because that scope carries the door, and
 * because an identity cannot be required of a request whose whole purpose is to get one.
 */
export function firstVisitRoute(
  app: FastifyInstance,
  api: { create(): Promise<Actor>; signupCode: string },
): void {
  void app.register((scope, _options, done) => {
    withInvite(scope, api.signupCode)

    scope.post('/actors', async (request, reply) => {
      // Documented as having no body, so a body is refused rather than dropped in silence:
      // accepting `{"country":"RU"}` and answering «AM» tells the caller their input was
      // understood when it was discarded. Refused through the body seam, which is what
      // turns it into a 400 naming the field — the route assigns no status itself.
      if (request.body !== undefined && request.body !== null) {
        throw new InvalidBody(
          new ZodError([
            { code: 'custom', path: ['body'], message: ISSUE.BODY_INVALID, input: request.body },
          ]),
        )
      }

      return answer(reply.code(201), await api.create())
    })

    done()
  })
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

    return answer(reply, actor)
  })
}
