import { z } from 'zod'
import { feedbackBodySchema, feedbackSentCodec } from '@molvia/model'
import type { FeedbackBody, FeedbackSent } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { parseBody } from '@/parse'

/** The use case, already bound to its repository and this server's build. */
export type SendFeedback = (
  actorId: string,
  message: FeedbackBody,
) => Promise<{ sent: FeedbackSent; created: boolean }>

/**
 * «Написать разработчику» (MOL-147), inside the guarded scope: the session's owner is the author, so
 * the path names nobody. 201 for a new message, 200 for the same message again — a double tap or a
 * lost answer — and 429 past the day's limit, from the central handler.
 */
export function feedbackRoutes(app: FastifyInstance, send: SendFeedback): void {
  app.post('/feedback', async (request, reply) => {
    const body = parseBody(feedbackBodySchema, request.body)
    const { sent, created } = await send(request.actorId, body)
    return reply
      .code(created ? 201 : 200)
      .header('cache-control', 'no-store')
      .send(z.encode(feedbackSentCodec, sent))
  })
}
