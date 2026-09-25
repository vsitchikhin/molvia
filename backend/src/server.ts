import Fastify from 'fastify'
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { DomainError, ERROR, ISSUE, errorResponseSchema, isWireCode } from '@molvia/model'
import type { ErrorCode, ErrorResponse } from '@molvia/model'
import { InvalidBody } from '@/parse'
import { loginConfig } from '@/env'
import type { LoginConfiguration } from '@/login-config'
import { startLoginCleanup } from '@/login-cleanup'
import { healthRoutes } from '@/routes/health'
import { internalAuthRoutes } from '@/routes/internal-auth'
import { withActor } from '@/routes/actor'
import { actorMeRoute } from '@/routes/actors'
import { authRoutes } from '@/routes/auth'
import { adviceRoutes } from '@/routes/advice'
import { devLoginRoute } from '@/routes/dev-login'
import { catalogueRoutes } from '@/routes/catalogue'
import { placeRoutes } from '@/routes/places'
import { tripRoutes } from '@/routes/trips'
import { verdictRoutes } from '@/routes/verdicts'
import { sessionRoutes } from '@/routes/sessions'
import { exchangeRoutes } from '@/routes/exchanges'
import { advice } from '@/usecases/advice'
import { authenticate } from '@/usecases/authenticate'
import { previewLogin, confirmLogin, declineLogin } from '@/usecases/bot-login'
import { eraseMe } from '@/usecases/erase-me'
import { completeLogin } from '@/usecases/complete-login'
import { currentTrip, selectedTrip } from '@/usecases/current-trip'
import { proposeItem } from '@/usecases/propose-item'
import { recentPlaces } from '@/usecases/recent-places'
import { rateItem } from '@/usecases/rate-item'
import { amendVerdict } from '@/usecases/amend-verdict'
import { withdrawVerdict } from '@/usecases/withdraw-verdict'
import { pendingVerdicts } from '@/usecases/pending-verdicts'
import { searchCatalogue } from '@/usecases/search-catalogue'
import { signIn } from '@/usecases/sign-in'
import { endSession, listSessions, logout } from '@/usecases/sessions'
import { chooseTripRate } from '@/usecases/choose-trip-rate'
import {
  chooseRatePreference,
  readExchanges,
  recordExchange,
  removeExchange,
  restoreExchange,
} from '@/usecases/exchanges'
import { createSettingsRepository } from '@/db/settings-repository'
import { saveSettings } from '@/usecases/save-settings'
import { settingsRoute } from '@/routes/settings'
import { startTrip } from '@/usecases/start-trip'
import { startLogin } from '@/usecases/start-login'
import { addExpense, finishTrip, removeExpense, updateExpense } from '@/usecases/trip-expenses'
import { createActorRepository } from '@/db/actors-repository'
import { createExchangeRepository } from '@/db/exchanges-repository'
import { createEventRepository } from '@/db/events-repository'
import { createItemRepository } from '@/db/items-repository'
import { createLoginRequestRepository } from '@/db/login-requests-repository'
import { createSessionRepository } from '@/db/sessions-repository'
import { createErasureRepository } from '@/db/erasure-repository'
import { describeFailure } from '@/db/failure'
import { authTransactOn } from '@/db/auth-unit-of-work'
import { transactOn, tripRepositories } from '@/db/unit-of-work'
import { createVerdictRepository } from '@/db/verdicts-repository'
import { databaseIsReachable, getDb } from '@/db'
import type { Db } from '@/db'

// The one place where a domain error becomes an HTTP status. Routes never map errors
// themselves, so a code cannot mean 400 in one place and 404 in another.
const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  [ERROR.NOT_FOUND]: 404,
  [ERROR.LOGIN_UNAVAILABLE]: 404,
  [ERROR.LOGIN_FORBIDDEN]: 403,
  [ERROR.LOGIN_RATE_LIMITED]: 429,
  [ERROR.LOGIN_DISABLED]: 503,
  [ERROR.BOT_UNAUTHORIZED]: 401,
  // The request is well formed; another row already holds what it claims — a barcode that
  // belongs to another item. Not 400: nothing about the request itself is wrong.
  [ERROR.CONFLICT]: 409,
  // Also well formed: another trip of the same person is still open, and which of the two goes
  // on is the person's choice (MOL-21). The screen reads the code, the status only groups it.
  [ERROR.TRIP_OPEN]: 409,
  [ERROR.TRIP_CONTEXT_REQUIRED]: 409,
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

/**
 * Where every reply is `no-store` and an error is logged by name only.
 *
 * Judged by the route that matched, not by how the URL was spelt: the router decodes static
 * segments too, so `/internal/%61uth/…` reached `confirm` while a prefix test on the raw URL
 * said «not auth» and logged the driver's message whole (adversarial Б2). With no route — a 404,
 * or a URL refused before routing — the decoded path stands in for it.
 */
function isAuthRequest(request: FastifyRequest): boolean {
  const path = request.routeOptions.url ?? decodedPath(request.url)
  return path.startsWith('/auth/') || path.startsWith('/internal/')
}

function decodedPath(url: string): string {
  const path = url.split('?', 1)[0] ?? ''
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

export interface ServerOptions {
  /**
   * The connection the repositories are built on. Integration tests point it at their own
   * database: without this the server under test writes into the database a person has been
   * entering data into by hand, and the test reads an empty one — every assertion about
   * rows passes while proving nothing.
   */
  readonly db?: Db
  readonly login?: LoginConfiguration | null
  /** Where the log goes instead of stdout — for the test that reads what an auth failure logs. */
  readonly logStream?: { write(line: string): void }
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      // Fastify's default serializers write no headers at all, so today this hides nothing; it
      // is here for the day a serializer is widened. What keeps credentials out of the log now
      // is the error handler below, and a test holds that, not this line.
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers'],
      // A request is logged as its method and its path, and nothing else (MOL-58). Fastify's own
      // serializer adds the address, the port and the host, and keeps the query string — which
      // for `/catalogue/search?q=…` is what a person was looking for, the very behaviour the
      // privacy page promises is not kept. The address today is Caddy's rather than a person's
      // (no `trustProxy`), and this keeps it out on the day that changes.
      serializers: {
        req: (request: FastifyRequest) => ({
          id: request.id,
          method: request.method,
          path: request.url.split('?', 1)[0],
        }),
      },
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
    // No limit of the router's own: every parameter is judged by the schema of its route, which
    // answers a value no row could carry with the same nothing as any other (`login_unavailable`,
    // `path_invalid`). The default of 100 answered before the route did, and differently
    // (adversarial Б1). Node's own limit on the request line is the ceiling that remains.
    maxParamLength: 16 * 1024,
    // A path that does not decode (`%E0`) is refused before any hook runs, so its reply is
    // built here, in the API's own shape and — under the auth paths — `no-store` like the rest.
    frameworkErrors: (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      if (isAuthRequest(request)) void reply.header('cache-control', 'no-store')
      // Both are the caller's: a path that does not decode, and one past a raised header limit.
      if (error.code === 'FST_ERR_BAD_URL' || error.code === 'FST_ERR_MAX_PARAM_LENGTH') {
        void reply
          .status(error.code === 'FST_ERR_BAD_URL' ? 400 : 414)
          .send({ code: ISSUE.PATH_INVALID })
        return
      }
      app.log.error(describeFailure(error), 'request refused by the framework')
      void reply.status(500).send({ code: ERROR.INTERNAL })
    },
  })

  // The auth scopes set `no-store` on what their routes answer, but a path no route matches
  // and a URL Fastify cannot decode are answered before any scope is entered (adversarial А4).
  // The body of those stays Fastify's own: the client reads a code it does not recognise as
  // «the API did not answer», and that is the truth for an address the API does not have.
  app.addHook('onRequest', (request, reply, next) => {
    if (isAuthRequest(request)) void reply.header('cache-control', 'no-store')
    next()
  })

  // Fastify's own 404 writes `Route GET:/path?q=… not found` into the log and into the body,
  // past the request serializer: an old client or a mistyped path would log the query the
  // serializer keeps out (MOL-58). The body keeps Fastify's shape — a code the client does not
  // know is how it reads «the API has no such address» — but no longer carries the address.
  app.setNotFoundHandler((_request, reply) => {
    void reply.status(404).send({ message: 'Route not found', error: 'Not Found', statusCode: 404 })
  })

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof DomainError) {
      const status = STATUS_BY_CODE[error.code] ?? 400
      // RFC 9110 §15.5.2 makes a challenge mandatory on a 401. The scheme is this project's
      // own, and it names nothing a browser could answer by itself — the credential is a
      // session cookie the server hands out, so there is no dialog to offer and none is shown.
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

    // By its kind and never by its content, on every path (MOL-58). This was the rule for the
    // login's paths alone, and everything else logged the error whole: a driver's message is
    // the query with its parameters, so a failed search wrote what was searched for and who
    // asked, and a dropped connection wrote the hash of every session token in flight — into a
    // log the privacy page promises holds neither.
    app.log.error(
      describeFailure(error),
      isAuthRequest(request) ? 'authentication failed' : 'request failed',
    )
    return reply.status(error.statusCode ?? 500).send({ code: ERROR.INTERNAL })
  })

  // The composition point: routes are handed what they need instead of importing it. Binding
  // the repository into the use cases happens here and nowhere else — a route that could
  // name a repository would be a route that could reach the database.
  app.register((instance, _options, done) => {
    const db = options.db ?? getDb()
    const loginRequests = createLoginRequestRepository(db)
    const removedExchanges = createExchangeRepository(db)
    let stopCleanup: (() => Promise<void>) | undefined
    let stopExchangeCleanup: (() => Promise<void>) | undefined
    let stopSessionCleanup: (() => Promise<void>) | undefined
    instance.addHook('onReady', (ready) => {
      stopCleanup = startLoginCleanup(
        () => loginRequests.removeExpired(),
        () => {
          instance.log.error('login request cleanup failed')
        },
      )
      // The login timer's runner, reused — it owns only a minute timer and knows nothing of
      // logins: a removed exchange is final ten minutes on, whether or not its owner opens the
      // screen again (MOL-40, В-7).
      stopExchangeCleanup = startLoginCleanup(
        () => removedExchanges.purgeStale(),
        () => {
          instance.log.error('removed exchange cleanup failed')
        },
      )
      // An expired session has no reader, and it kept a device name for good while the privacy
      // page promises 180 days from the last use (MOL-57, owner's decision Q4).
      stopSessionCleanup = startLoginCleanup(
        () => createSessionRepository(db).removeExpired(),
        () => {
          instance.log.error('expired session cleanup failed')
        },
      )
      ready()
    })
    instance.addHook('onClose', async () => {
      await stopCleanup?.()
      await stopExchangeCleanup?.()
      await stopSessionCleanup?.()
    })
    const actors = createActorRepository(db)
    const items = createItemRepository(db)
    const events = createEventRepository(db)
    const tripData = tripRepositories(db)
    const transact = transactOn(db)
    const sessions = createSessionRepository(db)
    const verdicts = createVerdictRepository(db)

    healthRoutes(instance, { databaseIsReachable })
    const login = options.login === undefined ? loginConfig : options.login
    authRoutes(instance, {
      start: (name) => {
        if (!login) throw new DomainError(ERROR.LOGIN_DISABLED)
        return startLogin(loginRequests, login.username, name)
      },
      poll: (id, secret) => completeLogin(authTransactOn(db), id, secret),
      logout: (token) => logout(sessions, token),
    })
    internalAuthRoutes(instance, {
      secret: login?.botSecret ?? null,
      preview: (code) => previewLogin(loginRequests, code),
      confirm: (code, telegramId) => confirmLogin(loginRequests, code, telegramId),
      decline: (code) => declineLogin(loginRequests, code),
      erase: (telegramUserId) => eraseMe(createErasureRepository(db), telegramUserId),
    })

    // The development seam, and the guard is not `env.NODE_ENV` by accident (MOL-52, Р-14).
    // `bin/bundle.mjs` replaces this exact expression with the literal `'production'`, so in
    // the production bundle the condition folds to `false`, the branch goes, and with its
    // last reference gone `dev-login` is tree-shaken out entirely — the address does not
    // exist there rather than being switched off. Two things keep that true, and both are
    // easy to undo without noticing: esbuild only substitutes an *unbound* `process`, so this
    // file must never `import process from 'node:process'`, and the parsed `env` object is no
    // substitute because its value is only known while running. What actually holds the
    // promise is neither comment but `bundle-seam.integration.test.ts`, which greps the built
    // file.
    if (process.env.NODE_ENV !== 'production') {
      devLoginRoute(instance, {
        signIn: (telegramUserId, name) => signIn(actors, sessions, telegramUserId, name),
      })
    }

    // Everything that needs an owner is registered inside this scope, and the scope is here
    // rather than inside a route module: «new routes land in the guarded place by default»
    // is only true if the guarded place is where routes are actually added. MOL-21 and MOL-27
    // add theirs next to these.
    void instance.register((guarded, _guardedOptions, guardedDone) => {
      withActor(guarded, (token) => authenticate(sessions, token))
      actorMeRoute(guarded)
      sessionRoutes(guarded, {
        list: (actorId, currentId) => listSessions(sessions, actorId, currentId),
        end: (actorId, currentId, id) => endSession(sessions, actorId, currentId, id),
      })
      settingsRoute(guarded, (owner, input) =>
        saveSettings(createSettingsRepository(db), owner, input),
      )
      catalogueRoutes(guarded, {
        search: (actorId, query) => searchCatalogue({ items }, actorId, query),
        propose: (actorId, input) => proposeItem(items, actorId, input),
      })
      placeRoutes(guarded, {
        recent: (actorId, geography) => recentPlaces(tripData.places, actorId, geography),
      })
      tripRoutes(guarded, {
        start: (actor, body) => startTrip(transact, actor, body),
        current: (actorId) => currentTrip(tripData, actorId),
        selected: (actorId, id) => selectedTrip(tripData, actorId, id),
        history: (actorId, cursor) => tripData.trips.history(actorId, cursor),
        add: (actorId, tripId, body) => addExpense(transact, actorId, tripId, body),
        update: (actorId, tripId, expenseId, patch) =>
          updateExpense(transact, actorId, tripId, expenseId, patch),
        remove: (actorId, tripId, expenseId) => removeExpense(transact, actorId, tripId, expenseId),
        finish: (actorId, tripId, deviceAt) =>
          finishTrip(tripData.trips, actorId, tripId, deviceAt),
        chooseRate: (actorId, tripId, body) => chooseTripRate(transact, actorId, tripId, body),
      })
      exchangeRoutes(guarded, {
        overview: (actor) => readExchanges(tripData, actor),
        record: (actor, body) => recordExchange(tripData, actor, body),
        remove: (actor, id) => removeExchange(tripData, actor, id),
        restore: (actor, id) => restoreExchange(tripData, actor, id),
        prefer: (actor, preference) => chooseRatePreference(tripData, actor, preference),
      })
      adviceRoutes(guarded, {
        advice: (actorId) =>
          advice({ actors, verdicts, expenses: tripData.expenses, events }, actorId),
      })
      verdictRoutes(guarded, {
        rate: (actorId, itemId, rating) => rateItem({ items, verdicts }, actorId, itemId, rating),
        amend: (actorId, itemId, patch) => amendVerdict(verdicts, actorId, itemId, patch),
        withdraw: (actorId, itemId) => withdrawVerdict(verdicts, actorId, itemId),
        pending: (actorId) => pendingVerdicts(tripData.expenses, actorId),
      })
      guardedDone()
    })

    done()
  })

  return app
}
