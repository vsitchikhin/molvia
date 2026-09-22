import { z } from 'zod'
import {
  DomainError,
  ERROR,
  LOGIN_COOKIE,
  LOGIN_HEADER,
  actorViewSchema,
  loginPollCodec,
  loginStartedCodec,
} from '@molvia/model'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { readCookieValues, setLoginCookie, setSessionCookie } from '@/cookie'
import { deviceName } from '@/device-name'
import { parseQuery } from '@/parse'
import type { CompletedLogin } from '@/usecases/complete-login'
import type { StartedLogin } from '@/usecases/start-login'
import { refuseAnyBody } from './empty-body'

function browserOnly(request: FastifyRequest): Promise<void> {
  const site = request.headers['sec-fetch-site']
  if (
    request.headers[LOGIN_HEADER.toLowerCase()] !== '1' ||
    (site !== undefined && site !== 'same-origin' && site !== 'none')
  ) {
    throw new DomainError(ERROR.LOGIN_FORBIDDEN)
  }
  return Promise.resolve()
}

export function authRoutes(
  app: FastifyInstance,
  api: {
    start(deviceName: string | null): Promise<StartedLogin>
    poll(id: string, secret: string): Promise<CompletedLogin>
  },
): void {
  app.register((scope, _options, done) => {
    scope.addHook('onRequest', (_request, reply, next) => {
      reply.header('cache-control', 'no-store')
      next()
    })
    scope.addHook('onRequest', browserOnly)
    scope.addHook('onRequest', refuseAnyBody)
    scope.post('/auth/login', async (request, reply) => {
      parseQuery(z.strictObject({}), request.query)
      const { view, secret } = await api.start(deviceName(request.headers['user-agent']))
      setLoginCookie(reply, secret, view.expiresAt)
      return reply.code(201).send(z.encode(loginStartedCodec, view))
    })
    // Fastify's implicit HEAD would run the GET handler and silently consume the login.
    scope.get<{ Params: { id: string } }>(
      '/auth/login/:id',
      { exposeHeadRoute: false },
      async (request, reply) => {
        parseQuery(z.strictObject({}), request.query)
        const sent = readCookieValues(request.headers.cookie, LOGIN_COOKIE)
        if (sent.length !== 1) throw new DomainError(ERROR.LOGIN_UNAVAILABLE)
        const result = await api.poll(request.params.id, sent[0] ?? '')
        if (result.status === 'pending') return reply.send(z.encode(loginPollCodec, result))
        const { actor, token, expiresAt } = result.signedIn
        const body = z.encode(loginPollCodec, {
          status: 'authenticated',
          actor: actorViewSchema.parse(actor),
        })
        setSessionCookie(reply, token, expiresAt)
        return reply.send(body)
      },
    )
    scope.head('/auth/login/:id', () => {
      throw new DomainError(ERROR.LOGIN_FORBIDDEN)
    })
    done()
  })
}
