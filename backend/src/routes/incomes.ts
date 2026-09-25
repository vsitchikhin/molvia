import { z } from 'zod'
import {
  DomainError,
  ERROR,
  incomeAmendBodySchema,
  incomeBodySchema,
  incomesResponseCodec,
} from '@molvia/model'
import type { Actor, IncomeAmendBody, IncomeBody, IncomesResponse } from '@molvia/model'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { parseBody } from '@/parse'

export interface IncomesApi {
  /** The use cases, already bound to their repositories by the composition point. */
  overview(actor: Actor): Promise<IncomesResponse>
  record(actor: Actor, body: IncomeBody): Promise<{ overview: IncomesResponse; created: boolean }>
  amend(actor: Actor, id: string, body: IncomeAmendBody): Promise<IncomesResponse>
  remove(actor: Actor, id: string): Promise<IncomesResponse>
  restore(actor: Actor, id: string): Promise<IncomesResponse>
}

/** Incomes are the person's own money: private always, never in a shared cache. */
function answer(reply: FastifyReply, overview: IncomesResponse) {
  return reply.header('cache-control', 'no-store').send(z.encode(incomesResponseCodec, overview))
}

/** The hook guarantees it; checked rather than asserted, so a reader need not know that. */
function ownerOf(request: FastifyRequest): Actor {
  const actor = request.actor
  if (!actor) throw new DomainError(ERROR.NO_ACTOR)
  return actor
}

/**
 * «Доходы» (MOL-66), inside the guarded scope, by the same rules as «Обмен денег»: every route
 * answers with the screen whole, so the phone adds up nothing itself.
 */
export function incomeRoutes(app: FastifyInstance, api: IncomesApi): void {
  app.get('/incomes', { exposeHeadRoute: false }, async (request, reply) =>
    answer(reply, await api.overview(ownerOf(request))),
  )

  /** 201 for a new income, 200 for the same identifier again — a tap sent twice. */
  app.post('/incomes', async (request, reply) => {
    const body = parseBody(incomeBodySchema, request.body)
    const { overview, created } = await api.record(ownerOf(request), body)
    return answer(reply.code(created ? 201 : 200), overview)
  })

  /** 200 for an amendment and a repeat of it; 409 when it moved on elsewhere; 404 otherwise. */
  app.put<{ Params: { incomeId: string } }>('/incomes/:incomeId', async (request, reply) => {
    const body = parseBody(incomeAmendBodySchema, request.body)
    return answer(reply, await api.amend(ownerOf(request), request.params.incomeId, body))
  })

  /** One answer for the owner's income, a missing one, someone else's and a malformed address. */
  app.delete<{ Params: { incomeId: string } }>('/incomes/:incomeId', async (request, reply) =>
    answer(reply, await api.remove(ownerOf(request), request.params.incomeId)),
  )

  /** «Вернуть» (В-5): 404 for anything that is not the owner's removed income. */
  app.post<{ Params: { incomeId: string } }>('/incomes/:incomeId/restore', async (request, reply) =>
    answer(reply, await api.restore(ownerOf(request), request.params.incomeId)),
  )
}
