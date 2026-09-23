import { settingsUpdateSchema } from '@molvia/model'
import type { Actor, SettingsUpdate } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { parseBody } from '@/parse'
import { answerWithActor } from './actors'

export function settingsRoute(
  app: FastifyInstance,
  save: (owner: string, input: SettingsUpdate) => Promise<Actor>,
): void {
  app.put('/actors/me/settings', async (request, reply) =>
    answerWithActor(
      reply,
      await save(request.actorId, parseBody(settingsUpdateSchema, request.body)),
    ),
  )
}
