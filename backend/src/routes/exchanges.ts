import { z } from 'zod'
import {
  DomainError,
  ERROR,
  exchangeBodySchema,
  exchangesResponseCodec,
  ratePreferenceBodySchema,
} from '@molvia/model'
import type { Actor, ExchangeBody, ExchangesResponse, RatePreference } from '@molvia/model'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { parseBody } from '@/parse'

export interface ExchangesApi {
  /** The use cases, already bound to their repositories by the composition point. */
  overview(actor: Actor): Promise<ExchangesResponse>
  record(
    actor: Actor,
    body: ExchangeBody,
  ): Promise<{ overview: ExchangesResponse; created: boolean }>
  remove(actor: Actor, id: string): Promise<ExchangesResponse>
  restore(actor: Actor, id: string): Promise<ExchangesResponse>
  prefer(actor: Actor, preference: RatePreference): Promise<ExchangesResponse>
}

/** Exchanges are the person's own money: private always, never in a shared cache. */
function answer(reply: FastifyReply, overview: ExchangesResponse) {
  return reply.header('cache-control', 'no-store').send(z.encode(exchangesResponseCodec, overview))
}

/** The hook guarantees it; checked rather than asserted, so a reader need not know that. */
function ownerOf(request: FastifyRequest): Actor {
  const actor = request.actor
  if (!actor) throw new DomainError(ERROR.NO_ACTOR)
  return actor
}

/**
 * «Обмен денег» (MOL-40), inside the guarded scope. Every route answers with the screen whole, so
 * the phone never works out a rate or a difference itself.
 */
export function exchangeRoutes(app: FastifyInstance, api: ExchangesApi): void {
  app.get('/exchanges', { exposeHeadRoute: false }, async (request, reply) =>
    answer(reply, await api.overview(ownerOf(request))),
  )

  /** 201 for a new exchange, 200 for the same identifier again — a tap sent twice. */
  app.post('/exchanges', async (request, reply) => {
    const body = parseBody(exchangeBodySchema, request.body)
    const { overview, created } = await api.record(ownerOf(request), body)
    return answer(reply.code(created ? 201 : 200), overview)
  })

  /**
   * One answer for the owner's exchange, a missing one, someone else's and an address that could
   * never be one: gone, and the screen as it is. Not `resourceId` — its 404 for a malformed
   * address would be the one reply that differs.
   */
  app.delete<{ Params: { exchangeId: string } }>('/exchanges/:exchangeId', async (request, reply) =>
    answer(reply, await api.remove(ownerOf(request), request.params.exchangeId)),
  )

  /** «Вернуть» (В-5): 404 for anything that is not the owner's removed exchange. */
  app.post<{ Params: { exchangeId: string } }>(
    '/exchanges/:exchangeId/restore',
    async (request, reply) =>
      answer(reply, await api.restore(ownerOf(request), request.params.exchangeId)),
  )

  app.put('/actors/me/rate-preference', async (request, reply) => {
    const { preference } = parseBody(ratePreferenceBodySchema, request.body)
    return answer(reply, await api.prefer(ownerOf(request), preference))
  })
}
