import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  DomainError,
  ERROR,
  confirmLoginSchema,
  eraseMeSchema,
  loginPreviewCodec,
} from '@molvia/model'
import type { LoginPreview, TelegramUserId } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { parseBody, parseQuery } from '@/parse'
import { refuseAnyBody } from './empty-body'

export function internalAuthRoutes(
  app: FastifyInstance,
  api: {
    secret: string | null
    preview(code: string): Promise<LoginPreview>
    confirm(code: string, telegramUserId: TelegramUserId): Promise<void>
    decline(code: string): Promise<void>
    erase(telegramUserId: TelegramUserId): Promise<void>
  },
): void {
  const digest = (value: string): Buffer => createHash('sha256').update(value).digest()
  app.register((scope, _options, done) => {
    scope.addHook('onRequest', (request, reply, next) => {
      reply.header('cache-control', 'no-store')
      const authorization = request.headers.authorization ?? ''
      if (!api.secret || !timingSafeEqual(digest(authorization), digest(`Bearer ${api.secret}`))) {
        throw new DomainError(ERROR.BOT_UNAUTHORIZED)
      }
      next()
    })
    scope.get<{ Params: { code: string } }>(
      '/internal/auth/login/:code',
      { onRequest: refuseAnyBody, exposeHeadRoute: false },
      async (request) => {
        parseQuery(z.strictObject({}), request.query)
        return z.encode(loginPreviewCodec, await api.preview(request.params.code))
      },
    )
    scope.post<{ Params: { code: string } }>(
      '/internal/auth/login/:code/confirm',
      async (request, reply) => {
        parseQuery(z.strictObject({}), request.query)
        const body = parseBody(confirmLoginSchema, request.body)
        await api.confirm(request.params.code, body.telegramUserId)
        return reply.code(204).send()
      },
    )
    scope.post<{ Params: { code: string } }>(
      '/internal/auth/login/:code/decline',
      { onRequest: refuseAnyBody },
      async (request, reply) => {
        parseQuery(z.strictObject({}), request.query)
        await api.decline(request.params.code)
        return reply.code(204).send()
      },
    )
    // Behind the same secret as the login, because it is the same caller asking for the same
    // kind of thing: an act Telegram vouched for, which the API cannot check by itself (MOL-58).
    scope.post('/internal/actors/erase', async (request, reply) => {
      parseQuery(z.strictObject({}), request.query)
      const body = parseBody(eraseMeSchema, request.body)
      await api.erase(body.telegramUserId)
      return reply.code(204).send()
    })
    done()
  })
}
