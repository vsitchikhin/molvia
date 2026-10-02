import Fastify from 'fastify'
import type {
  FastifyBaseLogger,
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify'
import {
  DomainError,
  ERROR,
  ISSUE,
  VERSION_HEADER,
  errorResponseSchema,
  isWireCode,
} from '@molvia/model'
import type { ErrorCode, ErrorResponse } from '@molvia/model'
import { InvalidBody } from '@/parse'
import { VERSION, env, loginConfig } from '@/env'
import type { LoginConfiguration } from '@/login-config'
import { startLoginCleanup } from '@/login-cleanup'
import { healthRoutes } from '@/routes/health'
import { internalAuthRoutes } from '@/routes/internal-auth'
import { withActor } from '@/routes/actor'
import { actorEraseRoute, actorExportRoute, actorMeRoute } from '@/routes/actors'
import { authRoutes } from '@/routes/auth'
import { adviceRoutes } from '@/routes/advice'
import { devLoginRoute } from '@/routes/dev-login'
import { catalogueRoutes } from '@/routes/catalogue'
import { placeRoutes } from '@/routes/places'
import { tripRoutes } from '@/routes/trips'
import { verdictRoutes } from '@/routes/verdicts'
import { sessionRoutes } from '@/routes/sessions'
import { exchangeRoutes } from '@/routes/exchanges'
import { feedbackRoutes } from '@/routes/feedback'
import { advice, adviceSearch } from '@/usecases/advice'
import { ownNever } from '@/usecases/own-never'
import { ownPrices } from '@/usecases/own-prices'
import { authenticate } from '@/usecases/authenticate'
import { previewLogin, confirmLogin, declineLogin } from '@/usecases/bot-login'
import { eraseMe } from '@/usecases/erase-me'
import { exportMine } from '@/usecases/export-mine'
import { sendFeedback } from '@/usecases/send-feedback'
import { completeLogin } from '@/usecases/complete-login'
import { currentTrip, selectedTrip } from '@/usecases/current-trip'
import { proposeItem } from '@/usecases/propose-item'
import { recentPlaces } from '@/usecases/recent-places'
import { rateFromBot } from '@/usecases/rate-from-bot'
import { rateItem } from '@/usecases/rate-item'
import { remindRatings } from '@/usecases/remind-ratings'
import {
  chooseReminders,
  remindersSettingOf,
  switchRemindersFromBot,
} from '@/usecases/reminders-switch'
import type { QuietToday } from '@/usecases/remind-ratings'
import { amendVerdict } from '@/usecases/amend-verdict'
import { withdrawVerdict } from '@/usecases/withdraw-verdict'
import { pendingVerdicts } from '@/usecases/pending-verdicts'
import { attachBarcode, detachBarcode } from '@/usecases/attach-barcode'
import { findByBarcode } from '@/usecases/find-by-barcode'
import { hintByBarcode } from '@/usecases/hint-by-barcode'
import { offUserAgent, openFoodFacts } from '@/open-food-facts/client'
import type { OpenFoodFacts } from '@/open-food-facts/client'
import { searchCatalogue } from '@/usecases/search-catalogue'
import { signIn } from '@/usecases/sign-in'
import { endSession, listSessions, logout } from '@/usecases/sessions'
import { chooseTripRate } from '@/usecases/choose-trip-rate'
import {
  amendExchange,
  chooseRatePreference,
  readExchanges,
  recordExchange,
  removeExchange,
  restoreExchange,
} from '@/usecases/exchanges'
import {
  amendIncome,
  readIncomes,
  recordIncome,
  removeIncome,
  restoreIncome,
} from '@/usecases/incomes'
import { incomeRoutes } from '@/routes/incomes'
import { createIncomeRepository } from '@/db/incomes-repository'
import {
  addSpendingCategory,
  amendSpending,
  archiveSpendingCategory,
  recordSpending,
  removeSpending,
  restoreSpending,
  spendingOfOwner,
  spendingCategoriesOf,
} from '@/usecases/spendings'
import { chooseSalaryShift, moneyMonthOf, salaryShiftOf } from '@/usecases/money-month'
import { moneyChartMonthOf } from '@/usecases/money-chart-month'
import { moneyBudgetOf, setBudgetPlan } from '@/usecases/money-budget'
import { moneyChartYearOf } from '@/usecases/money-chart-year'
import { spendingRoutes } from '@/routes/spendings'
import { createSpendingRepository } from '@/db/spendings-repository'
import { createTripRepository } from '@/db/trips-repository'
import {
  accountJournal,
  accountsHeld,
  addMoneyAccount,
  amendMoneyAccount,
  checkAccount,
  moneyAccountsOf,
  payTrip,
  removeMoneyAccount,
  restoreMoneyAccount,
  unassignedOf,
} from '@/usecases/money-accounts'
import { moneyAccountRoutes } from '@/routes/money-accounts'
import { createMoneyAccountRepository } from '@/db/money-accounts-repository'
import { createSettingsRepository } from '@/db/settings-repository'
import { saveSettings } from '@/usecases/save-settings'
import { settingsRoute } from '@/routes/settings'
import { remindersRoutes } from '@/routes/reminders'
import { startTrip } from '@/usecases/start-trip'
import { removeTrip, restoreTrip } from '@/usecases/remove-trip'
import { startLogin } from '@/usecases/start-login'
import {
  addExpense,
  finishTrip,
  removeExpense,
  setReceipt,
  updateExpense,
} from '@/usecases/trip-expenses'
import { createActorRepository } from '@/db/actors-repository'
import { createExchangeRepository } from '@/db/exchanges-repository'
import { createEventRepository } from '@/db/events-repository'
import { createItemRepository } from '@/db/items-repository'
import { createOpenFoodFactsRepository } from '@/db/open-food-facts-repository'
import { createLoginRequestRepository } from '@/db/login-requests-repository'
import { createSessionRepository } from '@/db/sessions-repository'
import { createErasureRepository } from '@/db/erasure-repository'
import { createExportRepository } from '@/db/export-repository'
import { createFeedbackRepository } from '@/db/feedback-repository'
import { createReminderRepository } from '@/db/reminders-repository'
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
  [ERROR.FEEDBACK_RATE_LIMITED]: 429,
  [ERROR.LOGIN_DISABLED]: 503,
  [ERROR.BOT_UNAUTHORIZED]: 401,
  // The request is well formed; another row already holds what it claims — a barcode that
  // belongs to another item. Not 400: nothing about the request itself is wrong.
  [ERROR.CONFLICT]: 409,
  // An item that holds as many codes as one item may (MOL-100): the request is well formed.
  [ERROR.BARCODES_FULL]: 409,
  // A name one of the owner's live categories already has: the same kind of answer as a conflict.
  [ERROR.SPENDING_CATEGORY_TAKEN]: 409,
  // The same for an account's name (MOL-115, Р-21), and for the currency of an account that
  // already counted operations in it: the request is well formed, the state refuses it.
  [ERROR.MONEY_ACCOUNT_TAKEN]: 409,
  [ERROR.MONEY_ACCOUNT_CURRENCY_LOCKED]: 409,
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
  const path = routePath(request)
  return path.startsWith('/auth/') || path.startsWith('/internal/')
}

/**
 * What a failure is called in the log. The bot's channel carries more than the login since MOL-101
 * — the reminder's claim and a press of 1–5 — and «authentication failed» over a failed reminder
 * sent whoever read the log to look at the login, which was fine (adversarial Г).
 */
function failureMessage(request: FastifyRequest): string {
  const path = routePath(request)
  if (path.startsWith('/auth/') || path.startsWith('/internal/auth/')) {
    return 'authentication failed'
  }
  return path.startsWith('/internal/') ? 'bot request failed' : 'request failed'
}

function routePath(request: FastifyRequest): string {
  return request.routeOptions.url ?? decodedPath(request.url)
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
  /**
   * The client of Open Food Facts, `null` for the hint off. Absent, it is built from the
   * environment — on only where a contact is set (MOL-162): tests hand in a fake, and nothing but
   * production ever asks the real base.
   */
  readonly openFoodFacts?: OpenFoodFacts | null
}

/**
 * The build as a header can carry it. A tag is whatever `git describe` found under `v[0-9]*`, and
 * Node refuses to write a header with a character outside latin1: a `v0.2-бета` failed every answer
 * of the API, `/health` included (adversarial Д4). Encoded, a latin tag stays as it is — the page
 * only compares two answers with each other.
 */
const NAMED_BUILD = encodeURIComponent(VERSION)

/**
 * The client of Open Food Facts the environment asks for (MOL-162): on only where a contact is set,
 * since the base asks every client for one (В-4). A failure is logged by its reason — never the
 * code, which is what a person bought.
 */
function openFoodFactsOf(log: FastifyBaseLogger): OpenFoodFacts | null {
  const contact = env.OPEN_FOOD_FACTS_CONTACT
  if (contact === undefined) return null
  return openFoodFacts({
    ...(env.OPEN_FOOD_FACTS_URL === undefined ? {} : { url: env.OPEN_FOOD_FACTS_URL }),
    userAgent: offUserAgent(VERSION, contact),
    ...(env.OPEN_FOOD_FACTS_PER_MINUTE === undefined
      ? {}
      : { perMinute: env.OPEN_FOOD_FACTS_PER_MINUTE }),
    onFailure: (reason) => {
      log.warn({ reason }, 'open food facts did not answer')
    },
  })
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
      // No hook runs for these, the one below included.
      void reply.header(VERSION_HEADER, NAMED_BUILD)
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

  // Every answer names the build that gave it, a refusal and a missing route included: an open
  // page that meets another build than the one it first met knows the server was rolled out
  // under it, and looks for its own new version at once — on the very answer it may no longer
  // read (MOL-132). `onSend`, not `onRequest`: a reply the error handler builds anew keeps it.
  app.addHook('onSend', (_request, reply, payload, next) => {
    void reply.header(VERSION_HEADER, NAMED_BUILD)
    next(null, payload)
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
    app.log.error(describeFailure(error), failureMessage(request))
    return reply.status(error.statusCode ?? 500).send({ code: ERROR.INTERNAL })
  })

  // The composition point: routes are handed what they need instead of importing it. Binding
  // the repository into the use cases happens here and nowhere else — a route that could
  // name a repository would be a route that could reach the database.
  app.register((instance, _options, done) => {
    const db = options.db ?? getDb()
    const loginRequests = createLoginRequestRepository(db)
    const removedExchanges = createExchangeRepository(db)
    const removedIncomes = createIncomeRepository(db)
    const removedSpendings = createSpendingRepository(db)
    const removedTrips = createTripRepository(db)
    const removedAccounts = createMoneyAccountRepository(db)
    let stopCleanup: (() => Promise<void>) | undefined
    let stopExchangeCleanup: (() => Promise<void>) | undefined
    let stopIncomeCleanup: (() => Promise<void>) | undefined
    let stopSpendingCleanup: (() => Promise<void>) | undefined
    let stopTripCleanup: (() => Promise<void>) | undefined
    let stopAccountCleanup: (() => Promise<void>) | undefined
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
      // The same for incomes (MOL-66): one rule for removing one's own money.
      stopIncomeCleanup = startLoginCleanup(
        () => removedIncomes.purgeStale(),
        () => {
          instance.log.error('removed income cleanup failed')
        },
      )
      // And for spendings (MOL-73, В-4): the ten minutes are the server's, whatever the strip says.
      stopSpendingCleanup = startLoginCleanup(
        () => removedSpendings.purgeStale(),
        () => {
          instance.log.error('removed spending cleanup failed')
        },
      )
      // And for trips (MOL-76, Р-1): a trip is money too, and its purchases go with it.
      stopTripCleanup = startLoginCleanup(
        () => removedTrips.purgeStale(),
        () => {
          instance.log.error('removed trip cleanup failed')
        },
      )
      // And for accounts without operations (MOL-115): deleted ten minutes on, whatever named one
      // meanwhile left without an account rather than lost (Р-17).
      stopAccountCleanup = startLoginCleanup(
        () => removedAccounts.purgeStale(),
        () => {
          instance.log.error('removed account cleanup failed')
        },
      )
      // An expired session has no reader, and it kept a device name for good while the privacy
      // page promises 180 days from the last use (MOL-57, owner's decision Q4).
      stopSessionCleanup = startLoginCleanup(
        () => sessions.removeExpired(),
        () => {
          instance.log.error('expired session cleanup failed')
        },
      )
      ready()
    })
    instance.addHook('onClose', async () => {
      await stopCleanup?.()
      await stopExchangeCleanup?.()
      await stopIncomeCleanup?.()
      await stopSpendingCleanup?.()
      await stopTripCleanup?.()
      await stopAccountCleanup?.()
      await stopSessionCleanup?.()
    })
    const actors = createActorRepository(db)
    const items = createItemRepository(db)
    const hints = createOpenFoodFactsRepository(db)
    const off =
      options.openFoodFacts === undefined ? openFoodFactsOf(app.log) : options.openFoodFacts
    const events = createEventRepository(db)
    const tripData = tripRepositories(db)
    const transact = transactOn(db)
    const sessions = createSessionRepository(db)
    const verdicts = createVerdictRepository(db)
    const reminders = createReminderRepository(db)
    const quietToday: QuietToday = new Map()

    healthRoutes(instance, { databaseIsReachable })
    const login = options.login === undefined ? loginConfig : options.login
    authRoutes(instance, {
      start: (name, again) => {
        if (!login) throw new DomainError(ERROR.LOGIN_DISABLED)
        return startLogin(loginRequests, login.username, name, again)
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
      // One person's claim that fails is logged by its kind and the others of the minute go on.
      claimReminders: () =>
        remindRatings(
          reminders,
          new Date(),
          (error) => {
            instance.log.error(describeFailure(error), 'rating reminder failed')
          },
          quietToday,
        ),
      rateFromBot: (itemId, body) =>
        rateFromBot({ actors, items, verdicts, reminders }, itemId, body),
      switchReminders: (body) => switchRemindersFromBot(reminders, body, new Date()),
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
      actorExportRoute(guarded, (actorId, sessionId) =>
        exportMine(createExportRepository(db), actorId, sessionId),
      )
      actorEraseRoute(guarded, (telegramUserId) =>
        eraseMe(createErasureRepository(db), telegramUserId),
      )
      feedbackRoutes(guarded, (actorId, message) =>
        sendFeedback(createFeedbackRepository(db), actorId, message, VERSION),
      )
      sessionRoutes(guarded, {
        list: (actorId, currentId) => listSessions(sessions, actorId, currentId),
        end: (actorId, currentId, id) => endSession(sessions, actorId, currentId, id),
      })
      settingsRoute(guarded, (owner, input) =>
        saveSettings(createSettingsRepository(db), tripData.money, owner, input),
      )
      remindersRoutes(guarded, {
        setting: (owner) => remindersSettingOf(reminders, { id: owner }),
        choose: (owner, body) => chooseReminders(reminders, { id: owner }, body, new Date()),
      })
      catalogueRoutes(guarded, {
        search: (actorId, query) => searchCatalogue({ items }, actorId, query),
        propose: (actorId, input) => proposeItem(items, hints, actorId, input),
        byBarcode: (code) => findByBarcode(items, code),
        hint: (actorId, code, locale) =>
          hintByBarcode({ cache: hints, off }, actorId, code, locale),
        attachBarcode: (actorId, itemId, code) => attachBarcode(items, actorId, itemId, code),
        detachBarcode: (itemId, code) => detachBarcode(items, itemId, code),
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
        finish: (actorId, tripId, deviceAt, deviceDay) =>
          finishTrip(tripData.trips, actorId, tripId, deviceAt, deviceDay),
        chooseRate: (actorId, tripId, body) => chooseTripRate(transact, actorId, tripId, body),
        setReceipt: (actorId, tripId, receipt) => setReceipt(transact, actorId, tripId, receipt),
        removeTrip: (actorId, tripId) => removeTrip(tripData.trips, actorId, tripId),
        restoreTrip: (actorId, tripId, body) => restoreTrip(tripData, actorId, tripId, body),
      })
      exchangeRoutes(guarded, {
        overview: (actor) => readExchanges(tripData, actor),
        record: (actor, body) => recordExchange(tripData, actor, body),
        amend: (actor, id, body) => amendExchange(tripData, actor, id, body),
        remove: (actor, id) => removeExchange(tripData, actor, id),
        restore: (actor, id) => restoreExchange(tripData, actor, id),
        prefer: (actor, preference) => chooseRatePreference(tripData, actor, preference),
      })
      incomeRoutes(guarded, {
        overview: (actor) => readIncomes(tripData, actor),
        record: (actor, body) => recordIncome(tripData, actor, body),
        amend: (actor, id, body) => amendIncome(tripData, actor, id, body),
        remove: (actor, id) => removeIncome(tripData, actor, id),
        restore: (actor, id) => restoreIncome(tripData, actor, id),
      })
      spendingRoutes(guarded, {
        record: (actor, body) => recordSpending(tripData, actor, body),
        amend: (actor, id, body) => amendSpending(tripData, actor, id, body),
        one: (actor, id) => spendingOfOwner(tripData, actor, id),
        remove: (actor, id) => removeSpending(tripData, actor, id),
        restore: (actor, id) => restoreSpending(tripData, actor, id),
        categories: (actor) => spendingCategoriesOf(tripData, actor),
        addCategory: (actor, body) => addSpendingCategory(tripData, actor, body),
        archiveCategory: (actor, id, archived) =>
          archiveSpendingCategory(tripData, actor, id, archived),
        month: (actor, month, cursor) => moneyMonthOf(tripData, actor, month, cursor),
        chartMonth: (actor, month) => moneyChartMonthOf(tripData, actor, month),
        chartYear: (actor, year) => moneyChartYearOf(tripData, actor, year),
        budget: (actor, month) => moneyBudgetOf(tripData, actor, month),
        setBudgetPlan: (actor, body) => setBudgetPlan(tripData, actor, body),
        salaryShift: (actor) => salaryShiftOf(tripData, actor),
        setSalaryShift: (actor, body) => chooseSalaryShift(tripData, actor, body),
      })
      moneyAccountRoutes(guarded, {
        overview: (actor) => moneyAccountsOf(tripData, actor),
        add: (actor, body) => addMoneyAccount(tripData, actor, body),
        amend: (actor, id, body) => amendMoneyAccount(tripData, actor, id, body),
        remove: (actor, id) => removeMoneyAccount(tripData, actor, id),
        restore: (actor, id) => restoreMoneyAccount(tripData, actor, id),
        journal: (actor, id, cursor) => accountJournal(tripData, actor, id, cursor),
        unassigned: (actor) => unassignedOf(tripData, actor),
        check: (actor, id, body) => checkAccount(tripData, actor, id, body),
        held: (actor, query) => accountsHeld(tripData, actor, query),
        payTrip: (actor, tripId, body) => payTrip(tripData, actor, tripId, body),
      })
      adviceRoutes(guarded, {
        advice: ({ actorId, ...phone }) =>
          advice({ actors, verdicts, expenses: tripData.expenses, events }, actorId, phone),
        search: ({ actorId, ...phone }, query) =>
          adviceSearch(
            { actors, verdicts, expenses: tripData.expenses, items },
            actorId,
            query,
            phone,
          ),
        prices: (owner, query) =>
          ownPrices(
            {
              actors,
              verdicts,
              expenses: tripData.expenses,
              items,
              trips: tripData.trips,
              places: tripData.places,
            },
            owner,
            query,
          ),
      })
      verdictRoutes(guarded, {
        rate: (actorId, itemId, rating) => rateItem({ items, verdicts }, actorId, itemId, rating),
        amend: (actorId, itemId, patch) => amendVerdict(verdicts, actorId, itemId, patch),
        withdraw: (actorId, itemId) => withdrawVerdict(verdicts, actorId, itemId),
        pending: (actorId) => pendingVerdicts(tripData.expenses, actorId),
        never: (actorId) => ownNever(verdicts, actorId),
      })
      guardedDone()
    })

    done()
  })

  return app
}
