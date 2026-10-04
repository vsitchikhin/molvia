import { chooseReceiptNoticesSchema } from '@molvia/model'
import type { ChooseReceiptNotices, ReceiptNoticesSetting } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { parseBody } from '@/parse'

export interface ReceiptNoticesApi {
  setting(owner: string): Promise<ReceiptNoticesSetting>
  choose(owner: string, body: ChooseReceiptNotices): Promise<ReceiptNoticesSetting>
}

/**
 * «Сообщать, что чек разобран» (MOL-129, В-2): its own address on the page «Бот», saved on the tap,
 * as the rating reminders' is (MOL-103 Р-1). The person's own: never in a shared cache.
 */
export function receiptNoticesRoutes(app: FastifyInstance, api: ReceiptNoticesApi): void {
  app.get('/actors/me/receipt-notices', { exposeHeadRoute: false }, async (request, reply) =>
    reply.header('cache-control', 'no-store').send(await api.setting(request.actorId)),
  )

  app.put('/actors/me/receipt-notices', async (request, reply) =>
    reply
      .header('cache-control', 'no-store')
      .send(await api.choose(request.actorId, parseBody(chooseReceiptNoticesSchema, request.body))),
  )
}
