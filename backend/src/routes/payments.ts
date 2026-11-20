import {
  DomainError,
  ERROR,
  paymentOfferCodec,
  paymentStartedSchema,
  paymentStatusCodec,
  resourceIdOf,
  startPaymentSchema,
} from '@molvia/model'
import type { PaymentOffer, PaymentStarted, PaymentStatus, StartPayment } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { parseBody, parseQuery } from '@/parse'

const rfCardQuerySchema = z.strictObject({ again: z.literal('1').optional() })

export interface PaymentsApi {
  offer(actorId: string): Promise<PaymentOffer>
  start(actorId: string, body: StartPayment): Promise<PaymentStarted>
  status(actorId: string, paymentId: string): Promise<PaymentStatus>
  /** A tap of «У меня только карта РФ» counted (Р-8): nobody's, by the day. */
  rfCard(actorId: string, again: boolean): Promise<void>
}

/**
 * Payment by card (MOL-277): registered only while the фф `payments` is on, so off they are an address the API has
 * not got (MOL-382). The person's own, never in a shared cache.
 */
export function paymentRoutes(app: FastifyInstance, api: PaymentsApi): void {
  app.get('/payments/tariffs', { exposeHeadRoute: false }, async (request, reply) =>
    reply
      .header('cache-control', 'no-store')
      .send(paymentOfferCodec.encode(await api.offer(request.actorId))),
  )

  app.post('/payments', async (request, reply) => {
    const started = await api.start(request.actorId, parseBody(startPaymentSchema, request.body))
    return reply
      .header('cache-control', 'no-store')
      .code(201)
      .send(paymentStartedSchema.parse(started))
  })

  /**
   * «У меня только карта РФ» (Р-8): a count of the day and nothing of who — `?again=1` is the phone's word that it
   * tapped within a day, as the login's repeat. Before `/payments/:paymentId` would take it: a static path first.
   */
  app.post('/payments/rf-card', async (request, reply) => {
    const { again } = parseQuery(rfCardQuerySchema, request.query)
    await api.rfCard(request.actorId, again === '1')
    return reply.header('cache-control', 'no-store').code(204).send()
  })

  /** Someone else's, a missing one and an address that could never be one: one 404 (MOL-25). */
  app.get<{ Params: { paymentId: string } }>(
    '/payments/:paymentId',
    { exposeHeadRoute: false },
    async (request, reply) => {
      const id = resourceIdOf(request.params.paymentId)
      if (id === null) throw new DomainError(ERROR.NOT_FOUND, 'payment')
      return reply
        .header('cache-control', 'no-store')
        .send(paymentStatusCodec.encode(await api.status(request.actorId, id)))
    },
  )
}
