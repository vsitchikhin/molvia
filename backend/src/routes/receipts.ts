import { z } from 'zod'
import {
  DomainError,
  ERROR,
  RECEIPT_PART_BYTES_MAX,
  receiptBodySchema,
  receiptDetailCodec,
  receiptSummaryCodec,
  receiptsResponseCodec,
} from '@molvia/model'
import type { ReceiptBody, ReceiptDetail, ReceiptSummary } from '@molvia/model'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { parseBody } from '@/parse'

export interface ReceiptsApi {
  send(actorId: string, body: ReceiptBody): Promise<{ receipt: ReceiptSummary; created: boolean }>
  putPart(actorId: string, id: string, part: string, photo: Buffer): Promise<ReceiptSummary>
  list(actorId: string): Promise<ReceiptSummary[]>
  one(actorId: string, id: string): Promise<ReceiptDetail>
  remove(actorId: string, id: string): Promise<void>
  restore(actorId: string, id: string): Promise<ReceiptSummary>
}

/** A receipt is the person's own: private always, never in a shared cache. */
function privately(reply: FastifyReply) {
  return reply.header('cache-control', 'no-store')
}

function ownerOf(request: FastifyRequest): string {
  const actor = request.actor
  if (!actor) throw new DomainError(ERROR.NO_ACTOR)
  return actor.id
}

/**
 * Receipts (MOL-125) — inside the guarded scope. The parts are the one body of the API that is not
 * JSON: a JPEG as it is, up to `RECEIPT_PART_BYTES_MAX`, taken in this scope only, so every other
 * route keeps Fastify's limit of a megabyte.
 */
export function receiptRoutes(app: FastifyInstance, api: ReceiptsApi): void {
  void app.register((scope, _options, done) => {
    scope.addContentTypeParser(
      'image/jpeg',
      { parseAs: 'buffer', bodyLimit: RECEIPT_PART_BYTES_MAX },
      (_request, body, parsed) => {
        parsed(null, body)
      },
    )

    /** 201 for a new receipt, 200 for the same one again — the queue sending twice. */
    scope.post('/receipts', async (request, reply) => {
      const body = parseBody(receiptBodySchema, request.body)
      const { receipt, created } = await api.send(ownerOf(request), body)
      return privately(reply.code(created ? 201 : 200)).send(z.encode(receiptSummaryCodec, receipt))
    })

    /**
     * A part, by its number from 1: the same photo again is the same answer, another one in its place
     * is a 409; not a photo is a 415, too large a 413 — «не принят» on the phone.
     */
    scope.put<{ Params: { receiptId: string; part: string } }>(
      '/receipts/:receiptId/parts/:part',
      async (request, reply) => {
        if (!Buffer.isBuffer(request.body)) throw new DomainError(ERROR.RECEIPT_NOT_PHOTO)
        const receipt = await api.putPart(
          ownerOf(request),
          request.params.receiptId,
          request.params.part,
          request.body,
        )
        return privately(reply).send(z.encode(receiptSummaryCodec, receipt))
      },
    )

    /** «Покупки»: the person's receipts, the newest first, the removed ones left out. */
    scope.get('/receipts', { exposeHeadRoute: false }, async (request, reply) =>
      privately(reply).send(
        z.encode(receiptsResponseCodec, { receipts: await api.list(ownerOf(request)) }),
      ),
    )

    /** One receipt with its lines: 404 for a missing, removed or someone else's one alike. */
    scope.get<{ Params: { receiptId: string } }>(
      '/receipts/:receiptId',
      { exposeHeadRoute: false },
      async (request, reply) =>
        privately(reply).send(
          z.encode(receiptDetailCodec, await api.one(ownerOf(request), request.params.receiptId)),
        ),
    )

    /** «Удалить чек»: one answer for the owner's, a missing and someone else's receipt. */
    scope.delete<{ Params: { receiptId: string } }>(
      '/receipts/:receiptId',
      async (request, reply) => {
        await api.remove(ownerOf(request), request.params.receiptId)
        return privately(reply.code(204)).send()
      },
    )

    /** «Вернуть» (П-8): 404 for anything that is not the owner's receipt removed within the window. */
    scope.post<{ Params: { receiptId: string } }>(
      '/receipts/:receiptId/restore',
      async (request, reply) =>
        privately(reply).send(
          z.encode(
            receiptSummaryCodec,
            await api.restore(ownerOf(request), request.params.receiptId),
          ),
        ),
    )
    done()
  })
}
