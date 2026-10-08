import { z } from 'zod'
import {
  DomainError,
  ERROR,
  moneyAccountsCodec,
  transferAmendBodySchema,
  transferBodySchema,
  transferResponseCodec,
  transferViewCodec,
} from '@molvia/model'
import type {
  MoneyAccountsResponse,
  TransferAmendBody,
  TransferBody,
  TransferResponse,
  TransferView,
} from '@molvia/model'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Asking } from './actor'
import { parseBody } from '@/parse'

export interface TransfersApi {
  /** The use cases, already bound to their repositories by the composition point. */
  record(
    actor: Asking,
    body: TransferBody,
  ): Promise<{ response: TransferResponse; created: boolean }>
  one(actor: Asking, id: string): Promise<TransferView>
  amend(actor: Asking, id: string, body: TransferAmendBody): Promise<TransferResponse>
  remove(actor: Asking, id: string): Promise<MoneyAccountsResponse>
  restore(actor: Asking, id: string): Promise<TransferResponse>
}

/** A transfer is the person's own money: private always, never in a shared cache. */
function privately(reply: FastifyReply) {
  return reply.header('cache-control', 'no-store')
}

function ownerOf(request: FastifyRequest): Asking {
  const actor = request.actor
  if (!actor) throw new DomainError(ERROR.NO_ACTOR)
  return { ...actor, today: request.today, ...(request.zone ? { zone: request.zone } : {}) }
}

/**
 * «Перевод» between one's own accounts (MOL-253), inside the guarded scope, by the rules of an
 * exchange: written with a connection, named by the device, answered with «Счета» whole.
 */
export function transferRoutes(app: FastifyInstance, api: TransfersApi): void {
  /** 201 for a new transfer, 200 for the same identifier again — a tap sent twice. */
  app.post('/transfers', async (request, reply) => {
    const body = parseBody(transferBodySchema, request.body)
    const { response, created } = await api.record(ownerOf(request), body)
    return privately(reply.code(created ? 201 : 200)).send(
      z.encode(transferResponseCodec, response),
    )
  })

  /** One answer for the owner's transfer, a missing one, someone else's and a malformed address. */
  app.get<{ Params: { transferId: string } }>(
    '/transfers/:transferId',
    { exposeHeadRoute: false },
    async (request, reply) =>
      privately(reply).send(
        z.encode(transferViewCodec, await api.one(ownerOf(request), request.params.transferId)),
      ),
  )

  /** 200 for an amendment and a repeat of it; 409 when it moved on elsewhere; 404 otherwise. */
  app.put<{ Params: { transferId: string } }>('/transfers/:transferId', async (request, reply) => {
    const body = parseBody(transferAmendBodySchema, request.body)
    const response = await api.amend(ownerOf(request), request.params.transferId, body)
    return privately(reply).send(z.encode(transferResponseCodec, response))
  })

  /** «Счета» whole, whether or not there was such a transfer of the owner's. */
  app.delete<{ Params: { transferId: string } }>('/transfers/:transferId', async (request, reply) =>
    privately(reply).send(
      z.encode(moneyAccountsCodec, await api.remove(ownerOf(request), request.params.transferId)),
    ),
  )

  /** «Вернуть»: 404 for anything that is not the owner's removed transfer within its ten minutes. */
  app.post<{ Params: { transferId: string } }>(
    '/transfers/:transferId/restore',
    async (request, reply) =>
      privately(reply).send(
        z.encode(
          transferResponseCodec,
          await api.restore(ownerOf(request), request.params.transferId),
        ),
      ),
  )
}
