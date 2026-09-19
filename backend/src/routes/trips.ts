import { z } from 'zod'
import {
  DomainError,
  ERROR,
  currentTripResponseSchema,
  startTripBodySchema,
  tripViewCodec,
} from '@molvia/model'
import type { Actor, StartTripBody, TripView } from '@molvia/model'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { parseBody } from '@/routes/body'

export interface TripsApi {
  /** The use cases, already bound to their repositories by the composition point. */
  start(actor: Actor, body: StartTripBody): Promise<{ trip: TripView; created: boolean }>
  current(actorId: string): Promise<TripView | null>
}

/**
 * Expenses are private always (CLAUDE.md), and the owner travels in a header: a shared cache
 * holding one of these would show one device what another one bought.
 */
function answer(reply: FastifyReply, trip: TripView) {
  return reply.header('cache-control', 'no-store').send(z.encode(tripViewCodec, trip))
}

/**
 * The trip, registered inside the guarded scope: the owner comes from the hook, never from the
 * request, and a stranger's trip answers exactly as a missing one does.
 */
export function tripRoutes(app: FastifyInstance, api: TripsApi): void {
  /**
   * «Начать поход». 201 for a new trip, 200 for the same identifier sent again — a double tap
   * or a queue — and 409 `error.trip_open` while another trip is open: the screen then asks
   * whether to continue that one or finish it first (MOL-21, В-4).
   */
  app.post('/trips', async (request, reply) => {
    const body = parseBody(startTripBodySchema, request.body)
    // Checked rather than asserted — the hook guarantees it, and a reader should not have to
    // know that to trust this.
    const actor = request.actor
    if (!actor) throw new DomainError(ERROR.NO_ACTOR)

    const { trip, created } = await api.start(actor, body)
    return answer(reply.code(created ? 201 : 200), trip)
  })

  // No HEAD twin, as in the catalogue: nothing to gain, and one more way in.
  app.get('/trips/current', { exposeHeadRoute: false }, async (request, reply) => {
    const trip = await api.current(request.actorId)
    return reply
      .header('cache-control', 'no-store')
      .send(z.encode(currentTripResponseSchema, { trip }))
  })
}
