import { acceptConsentSchema } from '@molvia/model'
import type { AcceptConsent, Consent } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { parseBody } from '@/parse'

export interface ConsentApi {
  consent(owner: string): Promise<Consent>
  accept(owner: string, body: AcceptConsent): Promise<Consent>
}

/**
 * The edition of the terms and the privacy page the person accepted (MOL-95): its own address, never
 * a field of `/actors/me` (Р-5), which an installed app reads strictly. The person's own: never in a
 * shared cache.
 */
export function consentRoutes(app: FastifyInstance, api: ConsentApi): void {
  app.get('/actors/me/consent', { exposeHeadRoute: false }, async (request, reply) =>
    reply.header('cache-control', 'no-store').send(await api.consent(request.actorId)),
  )

  app.put('/actors/me/consent', async (request, reply) =>
    reply
      .header('cache-control', 'no-store')
      .send(await api.accept(request.actorId, parseBody(acceptConsentSchema, request.body))),
  )
}
