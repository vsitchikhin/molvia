import { z } from 'zod'
import {
  DomainError,
  ERROR,
  addExpenseBodySchema,
  currentTripResponseSchema,
  expensePatchSchema,
  finishTripBodySchema,
  tripHistoryCodec,
  tripHistoryQuerySchema,
  rateChoiceBodySchema,
  startTripBodySchema,
  tripViewCodec,
} from '@molvia/model'
import type {
  Actor,
  TripHistory,
  TripHistoryCursor,
  AddExpenseBody,
  ExpensePatch,
  RateChoiceBody,
  StartTripBody,
  TripView,
} from '@molvia/model'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { parseBody, parseQuery, resourceId } from '@/parse'

export interface TripsApi {
  /** The use cases, already bound to their repositories by the composition point. */
  start(actor: Actor, body: StartTripBody): Promise<{ trip: TripView; created: boolean }>
  current(actorId: string): Promise<TripView | null>
  selected(actorId: string, id: string): Promise<TripView>
  history(actorId: string, cursor?: TripHistoryCursor): Promise<TripHistory>
  add(
    actorId: string,
    tripId: string,
    body: AddExpenseBody,
  ): Promise<{ trip: TripView; created: boolean }>
  update(actorId: string, tripId: string, expenseId: string, patch: ExpensePatch): Promise<TripView>
  remove(actorId: string, tripId: string, expenseId: string): Promise<TripView>
  finish(actorId: string, tripId: string, deviceAt?: Date): Promise<void>
  chooseRate(actorId: string, tripId: string, body: RateChoiceBody): Promise<TripView>
}

/**
 * Identifiers in the path are passed on as they came. A malformed one matches nothing in the
 * repositories (`idOrNull`), so it answers 404 exactly as a stranger's or a missing one does —
 * a third answer for it would be one more way to tell them apart.
 */
interface TripParams {
  tripId: string
}
interface ExpenseParams extends TripParams {
  expenseId: string
}

/**
 * Expenses are private always (CLAUDE.md), and the owner travels in a header: a shared cache
 * holding one of these would show one device what another one bought.
 */
function answer(reply: FastifyReply, trip: TripView) {
  return reply.header('cache-control', 'no-store').send(z.encode(tripViewCodec, trip))
}

/**
 * The trip, registered inside the guarded scope: the owner comes from the hook, never from the
 * request, and a stranger's trip answers exactly as a missing one does.
 */
export function tripRoutes(app: FastifyInstance, api: TripsApi): void {
  /**
   * «Начать поход». 201 for a new trip, 200 for the same identifier sent again — a double tap
   * or a queue — and 409 `error.trip_open` while another trip is open: the screen then asks
   * whether to continue that one or finish it first (MOL-21, В-4).
   */
  app.post('/trips', async (request, reply) => {
    const body = parseBody(startTripBodySchema, request.body)
    // Checked rather than asserted — the hook guarantees it, and a reader should not have to
    // know that to trust this.
    const actor = request.actor
    if (!actor) throw new DomainError(ERROR.NO_ACTOR)

    const { trip, created } = await api.start(actor, body)
    return answer(reply.code(created ? 201 : 200), trip)
  })

  // No HEAD twin, as in the catalogue: nothing to gain, and one more way in.
  app.get('/trips/current', { exposeHeadRoute: false }, async (request, reply) => {
    const trip = await api.current(request.actorId)
    return reply
      .header('cache-control', 'no-store')
      .send(z.encode(currentTripResponseSchema, { trip }))
  })

  app.get('/trips/history', { exposeHeadRoute: false }, async (request, reply) => {
    const query = parseQuery(tripHistoryQuerySchema, request.query)
    const cursor =
      query.before && query.beforeId ? { at: query.before, id: query.beforeId } : undefined
    const page = await api.history(request.actorId, cursor)
    return reply.header('cache-control', 'no-store').send(z.encode(tripHistoryCodec, page))
  })

  app.get<{ Params: TripParams }>(
    '/trips/:tripId',
    { exposeHeadRoute: false },
    async (request, reply) =>
      answer(reply, await api.selected(request.actorId, resourceId(request.params.tripId))),
  )

  /**
   * «Добавить в поход». 201 for a new expense, 200 for the same identifier sent again — the
   * queue after a lost reply — and the whole trip either way, total included.
   */
  app.post<{ Params: TripParams }>('/trips/:tripId/expenses', async (request, reply) => {
    const body = parseBody(addExpenseBodySchema, request.body)
    const { trip, created } = await api.add(
      request.actorId,
      resourceId(request.params.tripId),
      body,
    )
    return answer(reply.code(created ? 201 : 200), trip)
  })

  app.patch<{ Params: ExpenseParams }>(
    '/trips/:tripId/expenses/:expenseId',
    async (request, reply) => {
      const patch = parseBody(expensePatchSchema, request.body)
      const tripId = resourceId(request.params.tripId)
      const expenseId = resourceId(request.params.expenseId)
      return answer(reply, await api.update(request.actorId, tripId, expenseId, patch))
    },
  )

  app.delete<{ Params: ExpenseParams }>(
    '/trips/:tripId/expenses/:expenseId',
    async (request, reply) => {
      const tripId = resourceId(request.params.tripId)
      const expenseId = resourceId(request.params.expenseId)
      return answer(reply, await api.remove(request.actorId, tripId, expenseId))
    },
  )

  /** 204: the screen goes back to «Новый поход», and there is nothing for it to read. */
  app.post<{ Params: TripParams }>('/trips/:tripId/finish', async (request, reply) => {
    const id = resourceId(request.params.tripId)
    const body = parseBody(finishTripBodySchema, request.body ?? {})
    await api.finish(request.actorId, id, body.finishedOnDeviceAt)
    return reply.code(204).header('cache-control', 'no-store').send()
  })

  /**
   * «Считать по новому курсу / по прежнему / по своему», when the rate the trip took jumped
   * (MOL-39, Р-19, Р-21). PUT: the same choice again is the same state. 409 `error.conflict` for
   * a trip that never jumped or a «previous» it does not hold; 400 `error.invalid_rate` for an
   * own rate that is not one.
   */
  app.put<{ Params: TripParams }>('/trips/:tripId/rate-choice', async (request, reply) => {
    const body = parseBody(rateChoiceBodySchema, request.body)
    return answer(
      reply,
      await api.chooseRate(request.actorId, resourceId(request.params.tripId), body),
    )
  })
}
