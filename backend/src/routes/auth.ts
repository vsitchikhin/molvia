import { z } from 'zod'
import {
  DomainError,
  ERROR,
  LOGIN_COOKIE,
  LOGIN_HEADER,
  SESSION_COOKIE,
  actorViewSchema,
  loginPollCodec,
  loginStartedCodec,
} from '@molvia/model'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { clearSessionCookie, readCookieValues, setLoginCookie, setSessionCookie } from '@/cookie'
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
    logout(token: string): Promise<void>
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
      setLoginCookie(reply, secret)
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
    /**
     * The way out of this device (MOL-57). Here rather than in the guarded scope, because a way
     * out must work for a session that is already gone: a repeat after a lost answer, or a token
     * another device ended a second ago, is the outcome the person asked for and answers 204 like
     * the first. So it answers every call the same, puts out the one cookie it was sent, and
     * never says whether a session was behind it.
     *
     * The guards of the login start apply, and they matter more here than they look: `SameSite=Lax`
     * already withholds the cookie from another site's form, and the required header means no
     * page anywhere can end a person's session with a plain `<form method=post>` either.
     *
     * Two cookies of that name are refused and nothing is cleared — MOL-53's rule (А2, А3):
     * `Set-Cookie` addresses a name and a path, so clearing would put out ours at `Path=/` and
     * leave the foreign one at its deeper path.
     */
    scope.post('/auth/logout', async (request, reply) => {
      parseQuery(z.strictObject({}), request.query)
      const sent = readCookieValues(request.headers.cookie, SESSION_COOKIE)
      if (sent.length > 1) throw new DomainError(ERROR.NO_ACTOR)
      const token = sent[0]
      if (token !== undefined) {
        await api.logout(token)
        clearSessionCookie(reply)
      }
      return reply.code(204).send()
    })
    scope.head('/auth/login/:id', () => {
      throw new DomainError(ERROR.LOGIN_FORBIDDEN)
    })
    done()
  })
}
