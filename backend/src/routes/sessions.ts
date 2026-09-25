import { z } from 'zod'
import { sessionsResponseCodec } from '@molvia/model'
import type { SessionsResponse } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { clearSessionCookie } from '@/cookie'
import { parseQuery } from '@/parse'

export interface SessionsApi {
  /** The use cases, already bound to their repository by the composition point. */
  list(actorId: string, currentId: string): Promise<SessionsResponse>
  end(actorId: string, currentId: string, id: string): Promise<{ readonly endedCurrent: boolean }>
}

/**
 * «Устройства» (MOL-57), inside the guarded scope: the owner's own sessions and nobody else's —
 * there is no parameter with which to name another owner.
 */
export function sessionRoutes(app: FastifyInstance, api: SessionsApi): void {
  // `no-store`: the reply lists the keys to an account, and a cached copy of it would outlive the
  // very session the person is about to end.
  app.get('/sessions', { exposeHeadRoute: false }, async (request, reply) => {
    parseQuery(z.strictObject({}), request.query)
    const list = await api.list(request.actorId, request.sessionId)
    return reply.header('cache-control', 'no-store').send(z.encode(sessionsResponseCodec, list))
  })

  /**
   * 204 for the owner's live session; one 404 for someone else's, a missing one, an expired one
   * and an address that could never be one. Ending the session this request came with is a way
   * out like any other, so the cookie goes with it — the browser would otherwise keep a token
   * that opens nothing, and learn that only from the next request's 401.
   */
  app.delete<{ Params: { sessionId: string } }>('/sessions/:sessionId', async (request, reply) => {
    const { endedCurrent } = await api.end(
      request.actorId,
      request.sessionId,
      request.params.sessionId,
    )
    if (endedCurrent) clearSessionCookie(reply)
    // Every reply about the keys to an account, not only the one that puts a cookie out
    // (self-review С-7): one rule with no exceptions is the one that holds.
    return reply.header('cache-control', 'no-store').code(204).send()
  })
}
