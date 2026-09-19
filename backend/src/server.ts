import Fastify from 'fastify'
import type { FastifyError, FastifyInstance } from 'fastify'
import { DomainError, ERROR, ISSUE, errorResponseSchema, isWireCode } from '@molvia/model'
import type { ErrorCode, ErrorResponse } from '@molvia/model'
import { InvalidBody } from '@/parse'
import { healthRoutes } from '@/routes/health'
import { withActor } from '@/routes/actor'
import { actorMeRoute, firstVisitRoute } from '@/routes/actors'
import { catalogueRoutes } from '@/routes/catalogue'
import { placeRoutes } from '@/routes/places'
import { tripRoutes } from '@/routes/trips'
import { verdictRoutes } from '@/routes/verdicts'
import { createActor } from '@/usecases/create-actor'
import { currentTrip } from '@/usecases/current-trip'
import { getActor } from '@/usecases/get-actor'
import { proposeItem } from '@/usecases/propose-item'
import { recentPlaces } from '@/usecases/recent-places'
import { rateItem } from '@/usecases/rate-item'
import { amendVerdict } from '@/usecases/amend-verdict'
import { withdrawVerdict } from '@/usecases/withdraw-verdict'
import { searchCatalogue } from '@/usecases/search-catalogue'
import { startTrip } from '@/usecases/start-trip'
import { addExpense, finishTrip, removeExpense, updateExpense } from '@/usecases/trip-expenses'
import { createActorRepository } from '@/db/actors-repository'
import { createEventRepository } from '@/db/events-repository'
import { createItemRepository } from '@/db/items-repository'
import { transactOn, tripRepositories } from '@/db/unit-of-work'
import { createVerdictRepository } from '@/db/verdicts-repository'
import { databaseIsReachable, getDb } from '@/db'
import type { Db } from '@/db'
import { env } from '@/env'

// The one place where a domain error becomes an HTTP status. Routes never map errors
// themselves, so a code cannot mean 400 in one place and 404 in another.
const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  [ERROR.NOT_FOUND]: 404,
  // The request is well formed; another row already holds what it claims — a barcode that
  // belongs to another item. Not 400: nothing about the request itself is wrong.
  [ERROR.CONFLICT]: 409,
  // Also well formed: another trip of the same person is still open, and which of the two goes
  // on is the person's choice (MOL-21). The screen reads the code, the status only groups it.
  [ERROR.TRIP_OPEN]: 409,
  // Not 400: the request is well formed, it simply names no subject the server can find.
  // The PWA reads exactly this to decide that its stored identity is gone (MOL-8, Р-4).
  [ERROR.NO_ACTOR]: 401,
}

// The handler answers with the contract the client parses, so it checks its own reply
// against it rather than trusting that a path it built fits.
function answer(response: ErrorResponse): ErrorResponse {
  const parsed = errorResponseSchema.safeParse(response)
  return parsed.success ? parsed.data : { code: response.code }
}

/**
 * A body Fastify itself refused: malformed JSON, an empty body announced as JSON, a media
 * type nothing can parse. It is the caller's mistake and has to read as one — it used to
 * come back as 400 carrying `error.internal`, so the status said «your request» while the
 * body said «our fault», and every typo was filed through `log.error` as a server failure.
 */
function isBodyFault(error: FastifyError): boolean {
  return typeof error.code === 'string' && error.code.startsWith('FST_ERR_CTP_')
}

export interface ServerOptions {
  /**
   * The connection the repositories are built on. Integration tests point it at their own
   * database: without this the server under test writes into the database a person has been
   * entering data into by hand, and the test reads an empty one — every assertion about
   * rows passes while proving nothing.
   */
  readonly db?: Db
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true })

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error instanceof DomainError) {
      const status = STATUS_BY_CODE[error.code] ?? 400
      // RFC 9110 §15.5.2 makes a challenge mandatory on a 401. The scheme is this project's
      // own: the credential is a header carrying an identifier, not Basic or Bearer.
      if (status === 401) void reply.header('www-authenticate', 'Molvia realm="molvia"')
      return reply.status(status).send({ code: error.code })
    }

    if (isBodyFault(error)) {
      // The status comes from the error itself: `FST_ERR_CTP_*` covers a body too large
      // (413) and an unsupported media type (415) as well as malformed JSON, and flattening
      // all of them to 400 would leave a caller unable to tell «too big» from «broken».
      return reply.status(error.statusCode ?? 400).send(answer({ code: ISSUE.BODY_INVALID }))
    }

    // Only a body parsed at the seam, never any ZodError: a row that stopped matching its
    // schema is the server's fault and has to keep falling through to the log below.
    if (error instanceof InvalidBody) {
      const issue = error.issues[0]
      const code = isWireCode(issue?.message) ? issue.message : ISSUE.BODY_INVALID
      // An unknown key has no path of its own — the object it sits in has — so the name that
      // was refused is taken from the issue: `?actorId=` answers with `details: "actorId"`.
      const details =
        issue?.code === 'unrecognized_keys' ? issue.keys.join(',') : issue?.path.join('.')
      return reply.status(400).send(answer({ code, ...(details ? { details } : {}) }))
    }

    app.log.error(error)
    return reply.status(error.statusCode ?? 500).send({ code: ERROR.INTERNAL })
  })

  // The composition point: routes are handed what they need instead of importing it. Binding
  // the repository into the use cases happens here and nowhere else — a route that could
  // name a repository would be a route that could reach the database.
  app.register((instance, _options, done) => {
    const db = options.db ?? getDb()
    const actors = createActorRepository(db)
    const items = createItemRepository(db)
    const events = createEventRepository(db)
    const tripData = tripRepositories(db)
    const transact = transactOn(db)
    const verdicts = createVerdictRepository(db)

    healthRoutes(instance, { databaseIsReachable })
    firstVisitRoute(instance, {
      create: () => createActor(actors),
      signupCode: env.SIGNUP_CODE,
    })

    // Everything that needs an owner is registered inside this scope, and the scope is here
    // rather than inside a route module: «new routes land in the guarded place by default»
    // is only true if the guarded place is where routes are actually added. MOL-21 and MOL-27
    // add theirs next to these.
    void instance.register((guarded, _guardedOptions, guardedDone) => {
      withActor(guarded, (id) => getActor(actors, id))
      actorMeRoute(guarded)
      catalogueRoutes(guarded, {
        search: (actorId, query) => searchCatalogue({ items, events }, actorId, query),
        propose: (actorId, input) => proposeItem(items, actorId, input),
      })
      placeRoutes(guarded, { recent: (actorId) => recentPlaces(tripData.places, actorId) })
      tripRoutes(guarded, {
        start: (actor, body) => startTrip(transact, actor, body),
        current: (actorId) => currentTrip(tripData, actorId),
        add: (actorId, tripId, body) => addExpense(transact, actorId, tripId, body),
        update: (actorId, tripId, expenseId, patch) =>
          updateExpense(transact, actorId, tripId, expenseId, patch),
        remove: (actorId, tripId, expenseId) => removeExpense(transact, actorId, tripId, expenseId),
        finish: (actorId, tripId) => finishTrip(tripData.trips, actorId, tripId),
      })
      verdictRoutes(guarded, {
        rate: (actorId, itemId, rating) => rateItem({ items, verdicts }, actorId, itemId, rating),
        amend: (actorId, itemId, patch) => amendVerdict(verdicts, actorId, itemId, patch),
        withdraw: (actorId, itemId) => withdrawVerdict(verdicts, actorId, itemId),
      })
      guardedDone()
    })

    done()
  })

  return app
}
