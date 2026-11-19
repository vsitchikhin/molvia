import { z } from 'zod'
import {
  DomainError,
  ERROR,
  EXCHANGE_SCREEN_HEADER,
  exchangeAmendBodySchema,
  exchangeBodySchema,
  exchangesResponseCodec,
  ratePreferenceBodySchema,
} from '@molvia/model'
import type {
  ExchangeAmendBody,
  ExchangeBody,
  ExchangesResponse,
  RatePreference,
} from '@molvia/model'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Asking } from './actor'
import { parseBody } from '@/parse'

export interface ExchangesApi {
  /** The use cases, already bound to their repositories by the composition point. */
  overview(actor: Asking): Promise<ExchangesResponse>
  record(
    actor: Asking,
    body: ExchangeBody,
  ): Promise<{ overview: ExchangesResponse; created: boolean }>
  amend(actor: Asking, id: string, body: ExchangeAmendBody): Promise<ExchangesResponse>
  remove(actor: Asking, id: string): Promise<ExchangesResponse>
  restore(actor: Asking, id: string): Promise<ExchangesResponse>
  prefer(actor: Asking, preference: RatePreference): Promise<ExchangesResponse>
}

/**
 * Exchanges are the person's own money: private always, never in a shared cache. The figures of the
 * screen of MOL-348 go only to a phone that asks for them: an earlier build reads the answer strictly.
 */
function answer(request: FastifyRequest, reply: FastifyReply, overview: ExchangesResponse) {
  const shown = asksScreen(request) ? overview : withoutScreen(overview)
  return reply.header('cache-control', 'no-store').send(z.encode(exchangesResponseCodec, shown))
}

/** Whether the phone draws «Обмен денег» of MOL-348. */
function asksScreen(request: FastifyRequest): boolean {
  return request.headers[EXCHANGE_SCREEN_HEADER.toLowerCase()] === '1'
}

/** The answer as a phone of an earlier build reads it. */
function withoutScreen(overview: ExchangesResponse): ExchangesResponse {
  const earlier = {
    ...overview,
    marketToday: overview.marketToday.map((currency) => {
      const kept = { ...currency }
      delete kept.track
      return kept
    }),
  }
  delete earlier.bars
  delete earlier.walletTrack
  return earlier
}

/** The hook guarantees it; checked rather than asserted, so a reader need not know that. */
function ownerOf(request: FastifyRequest): Asking {
  const actor = request.actor
  if (!actor) throw new DomainError(ERROR.NO_ACTOR)
  return { ...actor, today: request.today, ...(request.zone ? { zone: request.zone } : {}) }
}

/**
 * «Обмен денег» (MOL-40), inside the guarded scope. Every route answers with the screen whole, so
 * the phone never works out a rate or a difference itself.
 */
export function exchangeRoutes(app: FastifyInstance, api: ExchangesApi): void {
  app.get('/exchanges', { exposeHeadRoute: false }, async (request, reply) =>
    answer(request, reply, await api.overview(ownerOf(request))),
  )

  /** 201 for a new exchange, 200 for the same identifier again — a tap sent twice. */
  app.post('/exchanges', async (request, reply) => {
    const body = parseBody(exchangeBodySchema, request.body)
    const { overview, created } = await api.record(ownerOf(request), body)
    return answer(request, reply.code(created ? 201 : 200), overview)
  })

  /**
   * «Сохранить правку» (MOL-42): the screen whole, 200 for an amendment and for a repeat of it
   * alike; 409 when the exchange moved on elsewhere, 404 when it is not the owner's to amend.
   */
  app.put<{ Params: { exchangeId: string } }>('/exchanges/:exchangeId', async (request, reply) => {
    const body = parseBody(exchangeAmendBodySchema, request.body)
    return answer(
      request,
      reply,
      await api.amend(ownerOf(request), request.params.exchangeId, body),
    )
  })

  /**
   * One answer for the owner's exchange, a missing one, someone else's and an address that could
   * never be one: gone, and the screen as it is. Not `resourceId` — its 404 for a malformed
   * address would be the one reply that differs.
   */
  app.delete<{ Params: { exchangeId: string } }>('/exchanges/:exchangeId', async (request, reply) =>
    answer(request, reply, await api.remove(ownerOf(request), request.params.exchangeId)),
  )

  /** «Вернуть» (В-5): 404 for anything that is not the owner's removed exchange. */
  app.post<{ Params: { exchangeId: string } }>(
    '/exchanges/:exchangeId/restore',
    async (request, reply) =>
      answer(request, reply, await api.restore(ownerOf(request), request.params.exchangeId)),
  )

  app.put('/actors/me/rate-preference', async (request, reply) => {
    const { preference } = parseBody(ratePreferenceBodySchema, request.body)
    return answer(request, reply, await api.prefer(ownerOf(request), preference))
  })
}
