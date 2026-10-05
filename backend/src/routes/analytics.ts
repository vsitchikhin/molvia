import { chooseAnalyticsSchema } from '@molvia/model'
import type { AnalyticsSetting, ChooseAnalytics } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { parseBody } from '@/parse'

export interface AnalyticsApi {
  setting(owner: string): Promise<AnalyticsSetting>
  choose(owner: string, body: ChooseAnalytics): Promise<AnalyticsSetting>
}

/**
 * «Учитывать меня в статистике» (MOL-96): its own address in «Ваши данные», saved on the tap, as the
 * bot's switches are (MOL-103 Р-1). The person's own: never in a shared cache.
 */
export function analyticsRoutes(app: FastifyInstance, api: AnalyticsApi): void {
  app.get('/actors/me/analytics', { exposeHeadRoute: false }, async (request, reply) =>
    reply.header('cache-control', 'no-store').send(await api.setting(request.actorId)),
  )

  app.put('/actors/me/analytics', async (request, reply) =>
    reply
      .header('cache-control', 'no-store')
      .send(await api.choose(request.actorId, parseBody(chooseAnalyticsSchema, request.body))),
  )
}
