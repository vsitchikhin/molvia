import { z } from 'zod'
import {
  DomainError,
  ERROR,
  moneyMonthCodec,
  moneyMonthQuerySchema,
  monthSchema,
  spendingAmendBodySchema,
  spendingBodySchema,
  spendingCategoriesResponseCodec,
  spendingCategoryBodySchema,
  spendingViewCodec,
} from '@molvia/model'
import type {
  Actor,
  MoneyMonthView,
  SpendingAmendBody,
  SpendingBody,
  SpendingCategoriesResponse,
  SpendingCategoryBody,
  SpendingView,
} from '@molvia/model'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { parseBody, parseQuery } from '@/parse'

export interface SpendingsApi {
  /** The use cases, already bound to their repositories by the composition point. */
  record(actor: Actor, body: SpendingBody): Promise<{ spending: SpendingView; created: boolean }>
  amend(actor: Actor, id: string, body: SpendingAmendBody): Promise<SpendingView>
  remove(actor: Actor, id: string): Promise<void>
  restore(actor: Actor, id: string): Promise<SpendingView>
  categories(actor: Actor): Promise<SpendingCategoriesResponse>
  addCategory(
    actor: Actor,
    body: SpendingCategoryBody,
  ): Promise<{ list: SpendingCategoriesResponse; created: boolean }>
  archiveCategory(actor: Actor, id: string, archived: boolean): Promise<SpendingCategoriesResponse>
  month(actor: Actor, month: string, cursor: number): Promise<MoneyMonthView>
}

/** Spendings are the person's own money: private always, never in a shared cache. */
function privately(reply: FastifyReply) {
  return reply.header('cache-control', 'no-store')
}

function ownerOf(request: FastifyRequest): Actor {
  const actor = request.actor
  if (!actor) throw new DomainError(ERROR.NO_ACTOR)
  return actor
}

/**
 * «Деньги» (MOL-73): spendings outside trips, the categories they are counted by, and the month
 * counted by the server — inside the guarded scope. A write answers with what it wrote, since the
 * phone writes through its queue and reads the month on its own.
 */
export function spendingRoutes(app: FastifyInstance, api: SpendingsApi): void {
  /** 201 for a new spending, 200 for the same identifier again — the queue sending twice. */
  app.post('/spendings', async (request, reply) => {
    const body = parseBody(spendingBodySchema, request.body)
    const { spending, created } = await api.record(ownerOf(request), body)
    return privately(reply.code(created ? 201 : 200)).send(z.encode(spendingViewCodec, spending))
  })

  /** 200 for an amendment and a repeat of it; 409 when it moved on elsewhere; 404 otherwise. */
  app.put<{ Params: { spendingId: string } }>('/spendings/:spendingId', async (request, reply) => {
    const body = parseBody(spendingAmendBodySchema, request.body)
    const spending = await api.amend(ownerOf(request), request.params.spendingId, body)
    return privately(reply).send(z.encode(spendingViewCodec, spending))
  })

  /** One answer for the owner's spending, a missing one, someone else's and a malformed address. */
  app.delete<{ Params: { spendingId: string } }>(
    '/spendings/:spendingId',
    async (request, reply) => {
      await api.remove(ownerOf(request), request.params.spendingId)
      return privately(reply.code(204)).send()
    },
  )

  /** «Вернуть» (В-4): 404 for anything that is not the owner's removed spending. */
  app.post<{ Params: { spendingId: string } }>(
    '/spendings/:spendingId/restore',
    async (request, reply) => {
      const spending = await api.restore(ownerOf(request), request.params.spendingId)
      return privately(reply).send(z.encode(spendingViewCodec, spending))
    },
  )

  app.get('/spending-categories', { exposeHeadRoute: false }, async (request, reply) =>
    privately(reply).send(
      z.encode(spendingCategoriesResponseCodec, await api.categories(ownerOf(request))),
    ),
  )

  /** 201 for a new category of one's own, 200 for the same one sent again. */
  app.post('/spending-categories', async (request, reply) => {
    const body = parseBody(spendingCategoryBodySchema, request.body)
    const { list, created } = await api.addCategory(ownerOf(request), body)
    return privately(reply.code(created ? 201 : 200)).send(
      z.encode(spendingCategoriesResponseCodec, list),
    )
  })

  /** «Убрать из выбора»: nothing is erased — the category leaves the chips only (В-3). */
  app.delete<{ Params: { categoryId: string } }>(
    '/spending-categories/:categoryId',
    async (request, reply) =>
      privately(reply).send(
        z.encode(
          spendingCategoriesResponseCodec,
          await api.archiveCategory(ownerOf(request), request.params.categoryId, true),
        ),
      ),
  )

  app.post<{ Params: { categoryId: string } }>(
    '/spending-categories/:categoryId/restore',
    async (request, reply) =>
      privately(reply).send(
        z.encode(
          spendingCategoriesResponseCodec,
          await api.archiveCategory(ownerOf(request), request.params.categoryId, false),
        ),
      ),
  )

  /** A month that is not one is answered as a missing one: the address names no month. */
  app.get<{ Params: { month: string } }>(
    '/money/months/:month',
    { exposeHeadRoute: false },
    async (request, reply) => {
      const month = monthSchema.safeParse(request.params.month)
      if (!month.success) throw new DomainError(ERROR.NOT_FOUND)
      const { cursor } = parseQuery(moneyMonthQuerySchema, request.query)
      const view = await api.month(ownerOf(request), month.data, cursor ?? 0)
      return privately(reply).send(z.encode(moneyMonthCodec, view))
    },
  )
}
