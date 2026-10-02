import { chooseRemindersSchema } from '@molvia/model'
import type { ChooseReminders, RemindersSetting } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { parseBody } from '@/parse'

export interface RemindersApi {
  setting(owner: string): Promise<RemindersSetting>
  choose(owner: string, body: ChooseReminders): Promise<RemindersSetting>
}

/**
 * «Напоминать об оценке в Telegram» (MOL-103): its own address beside the settings, saved on the tap,
 * never a field of their form or of `/actors/me` (Р-1). The person's own: never in a shared cache.
 */
export function remindersRoutes(app: FastifyInstance, api: RemindersApi): void {
  app.get('/actors/me/reminders', { exposeHeadRoute: false }, async (request, reply) =>
    reply.header('cache-control', 'no-store').send(await api.setting(request.actorId)),
  )

  app.put('/actors/me/reminders', async (request, reply) =>
    reply
      .header('cache-control', 'no-store')
      .send(await api.choose(request.actorId, parseBody(chooseRemindersSchema, request.body))),
  )
}
