import { z } from 'zod'
import {
  pendingVerdictsCodec,
  ratingSchema,
  verdictAmendmentSchema,
  verdictCardCodec,
  verdictCardOf,
} from '@molvia/model'
import type { PendingVerdicts, Rating, Verdict, VerdictAmendment } from '@molvia/model'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { parseBody, resourceId } from '@/parse'

export interface VerdictApi {
  /** The use cases, already bound to their repositories by the composition point. */
  rate(
    actorId: string,
    itemId: string,
    rating: Rating,
  ): Promise<{ verdict: Verdict; created: boolean }>
  amend(actorId: string, itemId: string, patch: VerdictAmendment): Promise<Verdict>
  withdraw(actorId: string, itemId: string): Promise<void>
  pending(actorId: string): Promise<PendingVerdicts>
}

/** `no-store`: a verdict is personal, and the owner travels in a header. */
function answer(reply: FastifyReply, verdict: Verdict) {
  return reply
    .header('cache-control', 'no-store')
    .send(z.encode(verdictCardCodec, verdictCardOf(verdict)))
}

/**
 * The verdict, addressed by the item it is about (MOL-27). Registered inside the guarded
 * scope: the owner comes from the hook, never from the request.
 */
export function verdictRoutes(app: FastifyInstance, api: VerdictApi): void {
  /** «Оценки»: bought and not rated, one card per item (MOL-28). Personal, never cached. */
  app.get('/verdicts/pending', { exposeHeadRoute: false }, async (request, reply) => {
    const pending = await api.pending(request.actorId)
    return reply.header('cache-control', 'no-store').send(z.encode(pendingVerdictsCodec, pending))
  })

  /**
   * «Поставить оценку», and the same again. 201 for a first verdict — or one given after it
   * was withdrawn — and 200 for one replaced: repeating a draft that already arrived is an
   * ordinary path for a screen that sends when the network is back.
   */
  app.put<{ Params: { itemId: string } }>('/verdicts/:itemId', async (request, reply) => {
    const itemId = resourceId(request.params.itemId)
    const rating = parseBody(ratingSchema, request.body)
    const { verdict, created } = await api.rate(request.actorId, itemId, rating)

    return answer(reply.code(created ? 201 : 200), verdict)
  })

  /** «Изменить оценку»: part of it, and `review: null` is how the text is erased. */
  app.patch<{ Params: { itemId: string } }>('/verdicts/:itemId', async (request, reply) => {
    const itemId = resourceId(request.params.itemId)
    const patch = parseBody(verdictAmendmentSchema, request.body)

    return answer(reply, await api.amend(request.actorId, itemId, patch))
  })

  /** «Снять оценку»: 204, nothing to send back — the verdict is no longer there to show. */
  app.delete<{ Params: { itemId: string } }>('/verdicts/:itemId', async (request, reply) => {
    const itemId = resourceId(request.params.itemId)
    await api.withdraw(request.actorId, itemId)

    return reply.code(204).header('cache-control', 'no-store').send()
  })
}
