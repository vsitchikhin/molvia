import { z } from 'zod'
import {
  DomainError,
  ERROR,
  accountCheckBodySchema,
  accountCheckCodec,
  accountJournalCodec,
  accountJournalQuerySchema,
  accountsHeldCodec,
  accountsHeldQuerySchema,
  moneyAccountAmendBodySchema,
  moneyAccountBodySchema,
  moneyAccountsCodec,
  tripPaymentBodySchema,
  tripViewCodec,
  unassignedOperationsCodec,
} from '@molvia/model'
import type {
  AccountCheckBody,
  AccountCheckResponse,
  AccountJournalResponse,
  AccountsHeldQuery,
  AccountsHeldResponse,
  JournalKey,
  MoneyAccountAmendBody,
  MoneyAccountBody,
  MoneyAccountsResponse,
  TripPaymentBody,
  TripView,
  UnassignedOperationsResponse,
} from '@molvia/model'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Asking } from './actor'
import { parseBody, parseQuery } from '@/parse'

export interface MoneyAccountsApi {
  /** The use cases, already bound to their repositories by the composition point. */
  overview(actor: Asking): Promise<MoneyAccountsResponse>
  add(
    actor: Asking,
    body: MoneyAccountBody,
  ): Promise<{ overview: MoneyAccountsResponse; created: boolean }>
  amend(actor: Asking, id: string, body: MoneyAccountAmendBody): Promise<MoneyAccountsResponse>
  remove(actor: Asking, id: string): Promise<MoneyAccountsResponse>
  restore(actor: Asking, id: string): Promise<MoneyAccountsResponse>
  journal(actor: Asking, id: string, cursor?: JournalKey): Promise<AccountJournalResponse>
  unassigned(actor: Asking): Promise<UnassignedOperationsResponse>
  check(actor: Asking, id: string, body: AccountCheckBody): Promise<AccountCheckResponse>
  held(actor: Asking, query: AccountsHeldQuery): Promise<AccountsHeldResponse>
  payTrip(actor: Asking, tripId: string, body: TripPaymentBody): Promise<TripView>
}

/** Accounts are the person's own money: private always, never in a shared cache. */
function privately(reply: FastifyReply) {
  return reply.header('cache-control', 'no-store')
}

function ownerOf(request: FastifyRequest): Asking {
  const actor = request.actor
  if (!actor) throw new DomainError(ERROR.NO_ACTOR)
  return { ...actor, today: request.today, ...(request.zone ? { zone: request.zone } : {}) }
}

interface AccountParams {
  accountId: string
}

/**
 * «Счета» (MOL-115): the accounts, their journals, «не попали», the check, the hint of what was held,
 * and the account of a trip — inside the guarded scope. Another's account, a missing one and a
 * malformed address are one 404. A write answers with the page whole: which of «удалить» and
 * «убрать» it was, and what a new start moved, are the server's to say.
 */
export function moneyAccountRoutes(app: FastifyInstance, api: MoneyAccountsApi): void {
  app.get('/money/accounts', { exposeHeadRoute: false }, async (request, reply) =>
    privately(reply).send(z.encode(moneyAccountsCodec, await api.overview(ownerOf(request)))),
  )

  /** 201 for a new account, 200 for the same one sent again. */
  app.post('/money/accounts', async (request, reply) => {
    const body = parseBody(moneyAccountBodySchema, request.body)
    const { overview, created } = await api.add(ownerOf(request), body)
    return privately(reply.code(created ? 201 : 200)).send(z.encode(moneyAccountsCodec, overview))
  })

  app.get('/money/accounts/unassigned', { exposeHeadRoute: false }, async (request, reply) =>
    privately(reply).send(
      z.encode(unassignedOperationsCodec, await api.unassigned(ownerOf(request))),
    ),
  )

  app.get('/money/accounts/held', { exposeHeadRoute: false }, async (request, reply) => {
    const query = parseQuery(accountsHeldQuerySchema, request.query)
    return privately(reply).send(
      z.encode(accountsHeldCodec, await api.held(ownerOf(request), query)),
    )
  })

  /** 200 for an amendment and a repeat of it; 409 when it moved on elsewhere. */
  app.put<{ Params: AccountParams }>('/money/accounts/:accountId', async (request, reply) => {
    const body = parseBody(moneyAccountAmendBodySchema, request.body)
    const overview = await api.amend(ownerOf(request), request.params.accountId, body)
    return privately(reply).send(z.encode(moneyAccountsCodec, overview))
  })

  /** «Удалить» without operations, «убрать из выбора» with them — the answer says which. */
  app.delete<{ Params: AccountParams }>('/money/accounts/:accountId', async (request, reply) => {
    const overview = await api.remove(ownerOf(request), request.params.accountId)
    return privately(reply).send(z.encode(moneyAccountsCodec, overview))
  })

  app.post<{ Params: AccountParams }>(
    '/money/accounts/:accountId/restore',
    async (request, reply) => {
      const overview = await api.restore(ownerOf(request), request.params.accountId)
      return privately(reply).send(z.encode(moneyAccountsCodec, overview))
    },
  )

  app.get<{ Params: AccountParams }>(
    '/money/accounts/:accountId/journal',
    { exposeHeadRoute: false },
    async (request, reply) => {
      const { cursor } = parseQuery(accountJournalQuerySchema, request.query)
      const journal = await api.journal(ownerOf(request), request.params.accountId, cursor)
      return privately(reply).send(z.encode(accountJournalCodec, journal))
    },
  )

  /** «Сверить»: the check is written, and the same check sent again is counted again. */
  app.post<{ Params: AccountParams }>(
    '/money/accounts/:accountId/checks',
    async (request, reply) => {
      const body = parseBody(accountCheckBodySchema, request.body)
      const result = await api.check(ownerOf(request), request.params.accountId, body)
      return privately(reply).send(z.encode(accountCheckCodec, result))
    },
  )

  /** The account of a trip and «списано», from its summary; the answer is the trip. */
  app.put<{ Params: { tripId: string } }>('/trips/:tripId/payment', async (request, reply) => {
    const body = parseBody(tripPaymentBodySchema, request.body)
    const trip = await api.payTrip(ownerOf(request), request.params.tripId, body)
    return privately(reply).send(z.encode(tripViewCodec, trip))
  })
}
