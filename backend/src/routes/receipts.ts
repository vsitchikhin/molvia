import { z } from 'zod'
import {
  receiptReadQuerySchema,
  DomainError,
  RECEIPT_CODES_HEADER,
  ERROR,
  RECEIPT_PART_BYTES_MAX,
  receiptBodySchema,
  receiptDetailCodec,
  receiptRecordBodySchema,
  receiptRecordedCodec,
  receiptSettledCodec,
  receiptSummaryCodec,
  receiptsResponseCodec,
} from '@molvia/model'
import type {
  Actor,
  ReceiptBody,
  ReceiptDetail,
  ReceiptRecordBody,
  ReceiptRecorded,
  ReceiptSettled,
  ReceiptSummary,
} from '@molvia/model'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { parseBody, parseQuery } from '@/parse'
import type { Today } from '@/usecases/today'

export interface ReceiptsApi {
  send(actorId: string, body: ReceiptBody): Promise<{ receipt: ReceiptSummary; created: boolean }>
  putPart(actorId: string, id: string, part: string, photo: Buffer): Promise<ReceiptSummary>
  /** `shown` — the phone asked with its page in view (MOL-129, А1): what it is handed read is heard. */
  list(actor: Actor, shown: boolean): Promise<ReceiptSummary[]>
  /**
   * The review reads the rate of the receipt's day, and «today» is the phone's (MOL-121). `codes` — the
   * phone knows a line's `code` (`RECEIPT_CODES_HEADER`, MOL-234, adversarial А3).
   */
  one(actor: Actor & Today, id: string, shown: boolean, codes: boolean): Promise<ReceiptDetail>
  remove(actorId: string, id: string): Promise<void>
  restore(actorId: string, id: string): Promise<ReceiptSummary>
  /** «Записать» (MOL-126): the receipt's day and «today» are the phone's (MOL-121). */
  record(actor: Actor & Today, id: string, body: ReceiptRecordBody): Promise<ReceiptRecorded>
  /** «Отменить запись» (MOL-169, Г1): recorded or not, once no «Записать» of it is still running. */
  settled(actor: Actor, id: string): Promise<ReceiptSettled>
}

/** A receipt is the person's own: private always, never in a shared cache. */
function privately(reply: FastifyReply) {
  return reply.header('cache-control', 'no-store')
}

/** Whether the phone asked with its page in view (`?shown=1`, MOL-129, А1). */
function shownOf(request: FastifyRequest): boolean {
  return parseQuery(receiptReadQuerySchema, request.query).shown === '1'
}

/** Whether the phone knows a review line's `code` (MOL-234, adversarial А3). */
function codesOf(request: FastifyRequest): boolean {
  return request.headers[RECEIPT_CODES_HEADER.toLowerCase()] === '1'
}

function ownerOf(request: FastifyRequest): string {
  return actorOf(request).id
}

function actorOf(request: FastifyRequest): Actor {
  const actor = request.actor
  if (!actor) throw new DomainError(ERROR.NO_ACTOR)
  return actor
}

function askingOf(request: FastifyRequest): Actor & Today {
  return {
    ...actorOf(request),
    today: request.today,
    ...(request.zone ? { zone: request.zone } : {}),
  }
}

/**
 * Receipts (MOL-125) — inside the guarded scope. The parts are the one body of the API that is not
 * JSON: a JPEG as it is, up to `RECEIPT_PART_BYTES_MAX`, taken in this scope only, so every other
 * route keeps Fastify's limit of a megabyte.
 */
export function receiptRoutes(app: FastifyInstance, api: ReceiptsApi): void {
  void app.register((scope, _options, done) => {
    // Counted here rather than by Fastify's `bodyLimit` (review А16): a body sent in chunks names no
    // length, and past Fastify's limit the answer would be `issue.body_invalid`, which the phone cannot
    // tell from a malformed body. Past ours it is `error.receipt_too_large`, however it was sent.
    scope.addContentTypeParser('image/jpeg', (_request, payload, parsed) => {
      const chunks: Buffer[] = []
      let size = 0
      let over = false
      payload.on('data', (chunk: Buffer) => {
        if (over) return
        size += chunk.length
        if (size > RECEIPT_PART_BYTES_MAX) {
          over = true
          chunks.length = 0
          parsed(new DomainError(ERROR.RECEIPT_TOO_LARGE), undefined)
          return
        }
        chunks.push(chunk)
      })
      payload.on('end', () => {
        if (!over) parsed(null, Buffer.concat(chunks))
      })
      payload.on('error', (error: Error) => {
        if (over) return
        over = true
        parsed(error, undefined)
      })
    })

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
      {
        // too large is said by its own code before the body is read (review А7): past the parser's
        // limit Fastify would answer `issue.body_invalid`, which the phone cannot tell from a bad body
        onRequest: (request, _reply, done) => {
          const length = Number(request.headers['content-length'] ?? 0)
          done(
            length > RECEIPT_PART_BYTES_MAX ? new DomainError(ERROR.RECEIPT_TOO_LARGE) : undefined,
          )
        },
      },
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
        z.encode(receiptsResponseCodec, {
          receipts: await api.list(actorOf(request), shownOf(request)),
        }),
      ),
    )

    /** One receipt with its lines: 404 for a missing, removed or someone else's one alike. */
    scope.get<{ Params: { receiptId: string } }>(
      '/receipts/:receiptId',
      { exposeHeadRoute: false },
      async (request, reply) =>
        privately(reply).send(
          z.encode(
            receiptDetailCodec,
            await api.one(
              askingOf(request),
              request.params.receiptId,
              shownOf(request),
              codesOf(request),
            ),
          ),
        ),
    )

    /** Recorded or not, once no «Записать» of it is still running: the check of «Отменить запись». */
    scope.get<{ Params: { receiptId: string } }>(
      '/receipts/:receiptId/settled',
      { exposeHeadRoute: false },
      async (request, reply) =>
        privately(reply).send(
          z.encode(
            receiptSettledCodec,
            await api.settled(actorOf(request), request.params.receiptId),
          ),
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

    /**
     * «Записать» (MOL-126): one write for the whole receipt; the same trip again is the same answer,
     * another is a 409, and so is the same receipt recorded before.
     */
    scope.post<{ Params: { receiptId: string } }>(
      '/receipts/:receiptId/record',
      async (request, reply) => {
        const body = parseBody(receiptRecordBodySchema, request.body)
        const recorded = await api.record(askingOf(request), request.params.receiptId, body)
        return privately(reply).send(z.encode(receiptRecordedCodec, recorded))
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
