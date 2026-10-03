import { z } from 'zod'
import {
  DomainError,
  ERROR,
  FEEDBACK_BODY_BYTES_MAX,
  feedbackBodySchema,
  feedbackSentCodec,
} from '@molvia/model'
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
 *
 * The one JSON body past Fastify's megabyte: up to three pictures in base64 (MOL-167, Р-3), so the
 * limit is this route's alone. Too large by its `Content-Length` is said by its own code before the
 * body is read; one sent in chunks with no length meets the route's limit, a `413` all the same.
 */
export function feedbackRoutes(app: FastifyInstance, send: SendFeedback): void {
  app.post(
    '/feedback',
    {
      bodyLimit: FEEDBACK_BODY_BYTES_MAX,
      onRequest: (request, _reply, done) => {
        const length = Number(request.headers['content-length'] ?? 0)
        done(
          length > FEEDBACK_BODY_BYTES_MAX
            ? new DomainError(ERROR.FEEDBACK_PICTURE_TOO_LARGE)
            : undefined,
        )
      },
    },
    async (request, reply) => {
      const body = parseBody(feedbackBodySchema, request.body)
      const { sent, created } = await send(request.actorId, body)
      return reply
        .code(created ? 201 : 200)
        .header('cache-control', 'no-store')
        .send(z.encode(feedbackSentCodec, sent))
    },
  )
}
