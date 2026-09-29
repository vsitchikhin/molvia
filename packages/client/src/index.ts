import { z } from 'zod'
import type { ZodType } from 'zod'
import {
  ERROR,
  EXPORT_FORMAT,
  LOGIN_HEADER,
  loginStartedCodec,
  sessionsResponseCodec,
  loginPollCodec,
  ISSUE,
  actorCodec,
  settingsUpdateSchema,
  adviceResponseSchema,
  adviceSearchResponseSchema,
  addExpenseBodySchema,
  catalogueEntryCodec,
  catalogueSearchResponseSchema,
  currentTripResponseSchema,
  exchangeAmendBodySchema,
  exchangeBodySchema,
  exchangesResponseCodec,
  incomeAmendBodySchema,
  incomeBodySchema,
  incomesResponseCodec,
  journalCursorCodec,
  accountCheckBodySchema,
  accountCheckCodec,
  accountJournalCodec,
  accountsHeldCodec,
  moneyAccountAmendBodySchema,
  moneyAccountBodySchema,
  moneyAccountsCodec,
  tripPaymentBodySchema,
  unassignedOperationsCodec,
  moneyChartsCodec,
  moneyMonthCodec,
  monthSchema,
  salaryShiftSchema,
  spendingAmendBodySchema,
  spendingBodySchema,
  spendingCategoriesResponseCodec,
  spendingCategoryBodySchema,
  spendingViewCodec,
  expensePatchSchema,
  finishTripBodySchema,
  restoreTripBodySchema,
  tripHistoryCodec,
  healthResponseSchema,
  isWireCode,
  proposedItemSchema,
  rateChoiceBodySchema,
  ratePreferenceBodySchema,
  ratingSchema,
  pendingVerdictsCodec,
  recentPlacesResponseSchema,
  startTripBodySchema,
  tripViewCodec,
  verdictAmendmentSchema,
  verdictCardCodec,
  verdictPathSchema,
} from '@molvia/model'
import type {
  LoginStarted,
  SessionsResponse,
  LoginPoll,
  ActorView,
  SettingsUpdate,
  SettingsGeography,
  AdviceResponse,
  AdviceSearchResponse,
  AddExpenseBody,
  CatalogueEntry,
  CatalogueSearchResponse,
  ExchangeAmendBody,
  ExchangeBody,
  ExchangesResponse,
  IncomeAmendBody,
  IncomeBody,
  IncomesResponse,
  JournalKey,
  AccountCheckBody,
  AccountCheckResponse,
  AccountJournalResponse,
  AccountsHeldQuery,
  AccountsHeldResponse,
  MoneyAccountAmendBody,
  MoneyAccountBody,
  MoneyAccountsResponse,
  TripPaymentBody,
  UnassignedOperationsResponse,
  MoneyChartsView,
  MoneyMonthView,
  SalaryShift,
  SpendingAmendBody,
  SpendingBody,
  SpendingCategoriesResponse,
  SpendingCategoryBody,
  SpendingView,
  ExpensePatch,
  TripHistory,
  TripHistoryCursor,
  HealthResponse,
  PendingVerdicts,
  ProposedItem,
  RateChoiceBody,
  RatePreference,
  Rating,
  StartTripBody,
  TripPlace,
  TripView,
  VerdictAmendment,
  VerdictCard,
  FinishTripBody,
} from '@molvia/model'
import { ApiError, createTransport } from './transport'
import type { ClientOptions } from './transport'

export { ApiError } from './transport'
export type { ClientOptions } from './transport'
export { createBotClient } from './bot'
export type { MolviaBotClient, BotClientOptions } from './bot'

export interface MolviaClient {
  /** `again`: this device began a login before and has not come in since (MOL-68). */
  startLogin(options?: {
    readonly again?: boolean
    readonly signal?: AbortSignal
  }): Promise<LoginStarted>
  pollLogin(id: string, options?: { readonly signal?: AbortSignal }): Promise<LoginPoll>
  health(): Promise<HealthResponse>
  /**
   * The first visit, through the development seam (MOL-52, MOL-53). It exists only outside
   * production — the real door is the Telegram login of MOL-54 — and a client that calls it
   * against a production server gets a 404, because the address is not in that build.
   *
   * What comes back is the owner; what matters more is what comes back beside it — the session
   * cookie, which the browser keeps and this code never sees.
   */
  devLogin(): Promise<ActorView>
  /** Who this browser is, according to the session it is carrying — or `error.no_actor`. */
  me(): Promise<ActorView>
  /** «Устройства» (MOL-57): the owner's live sessions, this one first and marked. */
  sessions(): Promise<SessionsResponse>
  /**
   * «Скачать мои данные» (MOL-93): the file's text. Only its envelope is checked — an installed
   * app older than the server must still hand over a copy holding a field it does not know.
   */
  exportMine(): Promise<string>
  /**
   * Ends one of the owner's sessions. `error.not_found` is the answer for one that is already
   * gone, someone else's and one that never was — a screen reads it as done.
   */
  endSession(id: string): Promise<void>
  /**
   * The way out of this device (MOL-57): the server deletes the session and puts the cookie out.
   * Safe to send again after a lost answer — a session already gone answers the same 204.
   */
  logout(): Promise<void>
  saveSettings(input: SettingsUpdate): Promise<ActorView>
  /**
   * The catalogue lookup behind «что взяли?», ranked by the server — the query goes as typed.
   * The screen searches while the person types, so a search the next keystroke made stale is
   * cancelled through `signal`; the cancellation arrives as an ApiError like everything else.
   * `near` is whether anything found is close to the query rather than two edits away (MOL-46).
   */
  searchCatalogue(
    query: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CatalogueSearchResponse>
  /**
   * «Предложить товар». `created` is `false` when the catalogue already held an item of this
   * kind by the same name — the entry is then that item, and the fields sent were not applied.
   */
  proposeItem(input: ProposedItem): Promise<{ entry: CatalogueEntry; created: boolean }>
  /** The places this person shopped in lately, to tap at the door instead of typing. */
  recentPlaces(geography?: SettingsGeography): Promise<TripPlace[]>
  /**
   * «Начать поход». The identifier is the device's own, so sending it again after a lost reply
   * is safe: `created` is then `false` and the trip is the one already there. Another open trip
   * rejects with `error.trip_open` — the screen then asks whether to continue it or finish it.
   */
  startTrip(body: StartTripBody): Promise<{ trip: TripView; created: boolean }>
  /** The trip the screen opens on, or null — «Новый поход». */
  currentTrip(): Promise<TripView | null>
  trip(id: string): Promise<TripView>
  tripHistory(cursor?: TripHistoryCursor): Promise<TripHistory>
  /** «Добавить в поход». The same identifier again is one purchase, and `created` is `false`. */
  addExpense(tripId: string, body: AddExpenseBody): Promise<{ trip: TripView; created: boolean }>
  /** «Добавить цену», «Сохранить»: `null` clears a field, a missing one leaves it be. */
  updateExpense(tripId: string, expenseId: string, patch: ExpensePatch): Promise<TripView>
  removeExpense(tripId: string, expenseId: string): Promise<TripView>
  /** «Завершить». Finishing twice is not an error. */
  finishTrip(tripId: string, finishedOnDeviceAt?: Date): Promise<void>
  /**
   * «Считать по новому курсу / по прежнему / по своему» when the rate the trip took jumped
   * (`rateJump`). Safe to repeat; a trip with nothing to choose between rejects with
   * `error.conflict`, an own rate that is not a rate with `error.invalid_rate`.
   */
  chooseTripRate(tripId: string, body: RateChoiceBody): Promise<TripView>
  /**
   * «Удалить поход» (MOL-76): marked on the server, safe to send again. `error.not_found` for a
   * trip the server does not hold — never sent, someone else's, or final — which the queue reads
   * as done.
   */
  removeTrip(tripId: string): Promise<void>
  /**
   * «Вернуть» within ten minutes; `error.trip_open` for an open one while another is open, unless
   * it comes back finished (`finish`).
   */
  restoreTrip(tripId: string, finish?: FinishTripBody): Promise<TripView>
  /**
   * «Обмен денег» whole (MOL-40): the preference, the wallet of the pair, the hint and every
   * exchange with its comparison — all the server's, so the screen divides nothing.
   */
  exchanges(): Promise<ExchangesResponse>
  /**
   * «Записать обмен». Named by the device, so safe to repeat: `created` is `false` for the same
   * identifier again. A day after today in Yerevan rejects with `error.exchange_in_future`.
   */
  recordExchange(body: ExchangeBody): Promise<{ exchanges: ExchangesResponse; created: boolean }>
  /**
   * «Сохранить правку» (MOL-42): the exchange whole as it should now be, over the version the
   * screen showed. Safe to repeat. `error.conflict` when it was amended elsewhere in between,
   * `error.not_found` when it is gone.
   */
  amendExchange(id: string, body: ExchangeAmendBody): Promise<ExchangesResponse>
  /** Gone, whether it was there or not — the answer is the screen as it is now. */
  removeExchange(id: string): Promise<ExchangesResponse>
  /**
   * «Вернуть»: the exchange just removed, back as it was. `error.not_found` once it is final —
   * after any other request of the screen.
   */
  restoreExchange(id: string): Promise<ExchangesResponse>
  /** «Мой / Официальный» for trips from now on. */
  chooseRatePreference(preference: RatePreference): Promise<ExchangesResponse>
  /**
   * «Доходы» whole (MOL-66): the months with what came in per currency, and every income with its
   * earlier versions — all the server's, so the screen adds up nothing.
   */
  incomes(): Promise<IncomesResponse>
  /**
   * «Записать доход». Named by the device, so safe to repeat: `created` is `false` for the same
   * identifier again, `error.conflict` for it with anything else. A day after today in Yerevan
   * rejects with `error.income_in_future`.
   */
  recordIncome(body: IncomeBody): Promise<{ incomes: IncomesResponse; created: boolean }>
  /**
   * «Сохранить правку»: safe to repeat; `error.conflict` when it was amended elsewhere in between,
   * `error.not_found` when it is gone.
   */
  amendIncome(id: string, body: IncomeAmendBody): Promise<IncomesResponse>
  /** Gone, whether it was there or not — the answer is the screen as it is now. */
  removeIncome(id: string): Promise<IncomesResponse>
  /** «Вернуть»: `error.not_found` once the removal is final. */
  restoreIncome(id: string): Promise<IncomesResponse>
  /**
   * «Деньги» (MOL-73): one month counted by the server, and one page of its journal after
   * `cursor` — the key of the last row shown. A month that is not one answers `error.not_found`.
   * A page after `cursor` carries no «Остаток» (MOL-134): take it from the first page.
   */
  moneyMonth(month: string, cursor?: JournalKey): Promise<MoneyMonthView>
  /** «Графики» (MOL-74): the last six or twelve months side by side, counted by the server. */
  moneyCharts(period: 6 | 12): Promise<MoneyChartsView>
  /** «Зарплата с … числа — в следующий месяц» (MOL-134): `day` null is off. */
  salaryShift(): Promise<SalaryShift>
  /** Saved on the tap, whole each time: safe to repeat. */
  chooseSalaryShift(day: number | null): Promise<SalaryShift>
  /**
   * «Сохранить» a new spending. Named by the device, so safe to repeat: `created` is `false` for
   * the same one again, `error.conflict` for the same identifier with anything else — or while it
   * is marked removed.
   */
  recordSpending(body: SpendingBody): Promise<{ spending: SpendingView; created: boolean }>
  /** The spending whole over the version shown: `error.conflict` when it moved on elsewhere. */
  amendSpending(id: string, body: SpendingAmendBody): Promise<SpendingView>
  /** Marked removed for ten minutes; `error.not_found` for anything that is not the owner's. */
  removeSpending(id: string): Promise<void>
  /** «Вернуть»: `error.not_found` once the removal is final. */
  restoreSpending(id: string): Promise<SpendingView>
  /**
   * «Счета» (MOL-115): the accounts, their totals and how many operations fell out of them. Every
   * write below answers with the page whole — which of «удалить» and «убрать» it was is the server's.
   */
  moneyAccounts(): Promise<MoneyAccountsResponse>
  /** Named by the device: `created` is `false` for the same one again, `error.conflict` otherwise. */
  addMoneyAccount(
    body: MoneyAccountBody,
  ): Promise<{ accounts: MoneyAccountsResponse; created: boolean }>
  /** Whole, over the version shown: `error.conflict` when it moved on elsewhere. */
  amendMoneyAccount(id: string, body: MoneyAccountAmendBody): Promise<MoneyAccountsResponse>
  /** «Удалить» an account with no operations (ten minutes of «Вернуть»), «убрать» one with them. */
  removeMoneyAccount(id: string): Promise<MoneyAccountsResponse>
  /** «Вернуть» — a deleted one within its ten minutes, a removed one at any time. */
  restoreMoneyAccount(id: string): Promise<MoneyAccountsResponse>
  /** The account and one page of its journal after `cursor`, the key of the last row shown. */
  accountJournal(id: string, cursor?: JournalKey): Promise<AccountJournalResponse>
  /** «Не попали в остатки»: the operations with no account that could explain a difference. */
  unassignedOperations(): Promise<UnassignedOperationsResponse>
  /** «Сверить»: the same id and fact again count once more; another fact under it is a conflict. */
  checkAccount(id: string, body: AccountCheckBody): Promise<AccountCheckResponse>
  /** The hint of «сколько было до обмена» from the accounts; `held: null` when they cannot say. */
  accountsHeld(query: AccountsHeldQuery): Promise<AccountsHeldResponse>
  /** The account of a trip and «списано», whole each time — safe for the queue to send twice. */
  payTrip(tripId: string, body: TripPaymentBody): Promise<TripView>
  /** The owner's categories in the order of the chips, the removed ones marked. */
  spendingCategories(): Promise<SpendingCategoriesResponse>
  /** «Добавить категорию», named by the device: `error.spending_category_taken` for a live name. */
  addSpendingCategory(
    body: SpendingCategoryBody,
  ): Promise<{ categories: SpendingCategoriesResponse; created: boolean }>
  /** «Убрать из выбора»: nothing is erased, the spendings in it keep it. */
  archiveSpendingCategory(id: string): Promise<SpendingCategoriesResponse>
  /** «Вернуть» a category to the chips. */
  restoreSpendingCategory(id: string): Promise<SpendingCategoriesResponse>
  /**
   * «Поставить оценку», or give it again — safe to repeat, which is what a draft sent when the
   * network is back needs. `created` is `true` for a first verdict, or one given after it was
   * withdrawn; a review left out keeps the one already written.
   */
  rateItem(itemId: string, rating: Rating): Promise<{ verdict: VerdictCard; created: boolean }>
  /** «Изменить оценку»: `review: null` is the one way to erase the text. */
  amendVerdict(itemId: string, patch: VerdictAmendment): Promise<VerdictCard>
  /**
   * «Снять оценку». A repeat answers `ERROR.NOT_FOUND` — nothing is left to withdraw — and a
   * queue that retries it should count that as done rather than as a failure.
   */
  withdrawVerdict(itemId: string): Promise<void>
  /** «Оценки»: bought and not rated, one card per item, and how many wait in all. */
  pendingVerdicts(): Promise<PendingVerdicts>
  /**
   * «Что брать»: the rated rows in three groups, with prices where a price is allowed.
   * Takes nothing — whose figures come back follows from the person's access (MOL-31, Р-11)
   * and is said in `scope`, so there is no parameter with which to ask for anyone else's.
   */
  advice(): Promise<AdviceResponse>
  /**
   * The search on «Что брать» (MOL-128): the whole catalogue, each item found with its row of
   * «Что брать» or none. Cancelled through `signal` as the catalogue search is.
   */
  adviceSearch(
    query: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AdviceSearchResponse>
}

const exportEnvelopeSchema = z.looseObject({
  format: z.literal(EXPORT_FORMAT),
  version: z.int().min(1),
  exportedAt: z.iso.datetime(),
})

/** Everything a person has is read in one snapshot; a year of it is not a search. */
const EXPORT_TIMEOUT_MS = 60_000

/**
 * The PWA and the bot both talk to the API through this, and both validate what comes
 * back against the same schemas the API answers with.
 */
export function createClient(options: ClientOptions): MolviaClient {
  const { request, exchange } = createTransport(options)

  /**
   * A way out has one success, and it is `204` (MOL-57, round 4). A shop's captive portal answers
   * a request it redirected with `200` and a page of its own, which reads as «no body» — exactly
   * what `z.undefined()` accepts — and the phone erased a drawer for a session the server never
   * heard about. Anything else is an answer off the contract, and not the API's.
   */
  function noContent({ status }: { readonly status: number }): void {
    if (status !== 204) throw new ApiError(ISSUE.RESPONSE_INVALID, `HTTP ${String(status)}`, false)
  }
  /**
   * A verdict is addressed by its item. Checked before anything is sent: an identifier that
   * is not one can only be refused, and one carrying «/» or «?» would reach another address.
   */
  function verdictPath(itemId: string): string {
    const path = verdictPathSchema.safeParse({ itemId })
    // `answered: false` — nothing was sent, so this is not the API's word. It is the code the
    // server answers a real 404 with, and `useSelectedTrip` tells «no such trip» from «could not
    // ask» by exactly that flag; the default `true` would have made this refusal final (З-5).
    if (!path.success) throw new ApiError(ERROR.NOT_FOUND, 'itemId', false)
    return `/verdicts/${path.data.itemId}`
  }

  /**
   * The input goes out through its schema, and one it refuses arrives as a rejection — with
   * the code the server would answer for the same input, by the same rule (`server.ts`): the
   * issue's own code when it is one, `body_invalid` otherwise. Flattening every refusal to
   * `body_invalid` made one mistake read two ways on screen, depending on who caught it.
   */
  function encode<T>(schema: ZodType<T>, input: T): unknown {
    const encoded = schema.safeEncode(input)
    if (!encoded.success) {
      const issue = encoded.error.issues[0]
      const code = isWireCode(issue?.message) ? issue.message : ISSUE.BODY_INVALID
      // An unknown key has no path of its own — the object it sits in has — so, as on the
      // server, the name that was refused is taken from the issue.
      const details =
        issue?.code === 'unrecognized_keys' ? issue.keys.join(',') : issue?.path.join('.')
      throw new ApiError(code, details)
    }
    return encoded.data
  }

  /**
   * An identifier kept to its own path segment: `/`, `?` and `#` in it are escaped. Not a full
   * guarantee — `.` is not escaped, so an identifier of `..` is folded away by URL resolution —
   * but identifiers here are the device's own uuids, and a malformed one reaches no route.
   */
  const segment = encodeURIComponent

  return {
    startLogin: ({ again = false, ...options } = {}) =>
      request(again ? '/auth/login?again=1' : '/auth/login', loginStartedCodec, {
        method: 'POST',
        headers: new Headers({ [LOGIN_HEADER]: '1' }),
        ...options,
      }),
    pollLogin: async (id, options = {}) => {
      if (!z.uuid().safeParse(id).success) throw new ApiError(ISSUE.PATH_INVALID, 'id')
      return request(`/auth/login/${id}`, loginPollCodec, {
        headers: new Headers({ [LOGIN_HEADER]: '1' }),
        ...options,
      })
    },
    health: () => request('/health', healthResponseSchema),

    // `async` so that a refusal arrives as a rejection rather than a synchronous throw: a
    // caller writing `devLogin().catch(…)` would never see the latter, and «everything
    // this module throws is an ApiError» has to mean «through the promise».
    devLogin: async () =>
      // No timeout on the first visit, and this is the one place it is right to wait. An
      // abort here says nothing about whether the INSERT landed, so a retry after one
      // creates a **second** identity — and rows in `actors` are the denominator of the
      // 0.2 gate. A cold VPS answering slowly is the ordinary case, not the failure.
      request('/dev/login', actorCodec, { method: 'POST', timeout: null }),

    me: () => request('/actors/me', actorCodec),
    sessions: async () => request('/sessions', sessionsResponseCodec),
    exportMine: async () =>
      JSON.stringify(
        await request('/actors/me/export', exportEnvelopeSchema, { timeout: EXPORT_TIMEOUT_MS }),
        null,
        2,
      ),
    endSession: async (id) => {
      noContent(await exchange(`/sessions/${segment(id)}`, z.undefined(), { method: 'DELETE' }))
    },
    // The login's header: the API refuses a way out that a page on another site could send.
    logout: async () => {
      noContent(
        await exchange('/auth/logout', z.undefined(), {
          method: 'POST',
          headers: new Headers({ [LOGIN_HEADER]: '1' }),
        }),
      )
    },
    saveSettings: async (input) =>
      request('/actors/me/settings', actorCodec, {
        method: 'PUT',
        body: encode(settingsUpdateSchema, input),
      }),

    searchCatalogue: async (query, options = {}) => {
      // URLSearchParams, not a template: «&», «#», «+» and «%» in a query would otherwise
      // cut it short or change its meaning on the way.
      const search = new URLSearchParams({ q: query })
      return request(
        `/catalogue/search?${search.toString()}`,
        catalogueSearchResponseSchema,
        options.signal === undefined ? {} : { signal: options.signal },
      )
    },

    // `async` so that an input the schema refuses arrives as a rejection, like everything else.
    proposeItem: async (input) => {
      // An ordinary timeout, unlike the first visit: an abort may leave the item written, and
      // a retry is still safe — the server answers an exact repeat with the item already there.
      const { status, data } = await exchange('/catalogue/items', catalogueEntryCodec, {
        method: 'POST',
        body: encode(proposedItemSchema, input),
      })
      return { entry: data, created: status === 201 }
    },

    recentPlaces: async (geography) =>
      (
        await request(
          geography
            ? `/places/recent?${new URLSearchParams(geography).toString()}`
            : '/places/recent',
          recentPlacesResponseSchema,
        )
      ).places,

    // `async` everywhere below for the reason `proposeItem` has it: a body the schema refuses
    // must arrive as a rejection. Ordinary timeouts: every one of these is safe to repeat — the
    // identifiers are the device's own, and a repeat is answered with what is already there.
    startTrip: async (body) => {
      const { status, data } = await exchange('/trips', tripViewCodec, {
        method: 'POST',
        body: encode(startTripBodySchema, body),
      })
      return { trip: data, created: status === 201 }
    },

    currentTrip: async () => (await request('/trips/current', currentTripResponseSchema)).trip,
    trip: (id) => request(`/trips/${segment(id.toLowerCase())}`, tripViewCodec),
    tripHistory: (cursor) =>
      request(
        cursor
          ? `/trips/history?${new URLSearchParams({ before: cursor.at, beforeId: cursor.id })}`
          : '/trips/history',
        tripHistoryCodec,
      ),

    addExpense: async (tripId, body) => {
      const { status, data } = await exchange(`/trips/${segment(tripId)}/expenses`, tripViewCodec, {
        method: 'POST',
        body: encode(addExpenseBodySchema, body),
      })
      return { trip: data, created: status === 201 }
    },

    updateExpense: async (tripId, expenseId, patch) =>
      request(`/trips/${segment(tripId)}/expenses/${segment(expenseId)}`, tripViewCodec, {
        method: 'PATCH',
        body: encode(expensePatchSchema, patch),
      }),

    removeExpense: async (tripId, expenseId) =>
      request(`/trips/${segment(tripId)}/expenses/${segment(expenseId)}`, tripViewCodec, {
        method: 'DELETE',
      }),

    chooseTripRate: async (tripId, body) =>
      request(`/trips/${segment(tripId)}/rate-choice`, tripViewCodec, {
        method: 'PUT',
        body: encode(rateChoiceBodySchema, body),
      }),

    // A portal's page answering a redirected DELETE with 200 is not the removal (MOL-57, round 4).
    removeTrip: async (tripId) => {
      noContent(await exchange(`/trips/${segment(tripId)}`, z.undefined(), { method: 'DELETE' }))
    },

    restoreTrip: async (tripId, finish) =>
      request(`/trips/${segment(tripId)}/restore`, tripViewCodec, {
        method: 'POST',
        ...(finish ? { body: encode(restoreTripBodySchema, { finish }) } : {}),
      }),

    exchanges: () => request('/exchanges', exchangesResponseCodec),

    recordExchange: async (body) => {
      const { status, data } = await exchange('/exchanges', exchangesResponseCodec, {
        method: 'POST',
        body: encode(exchangeBodySchema, body),
      })
      return { exchanges: data, created: status === 201 }
    },

    amendExchange: async (id, body) =>
      request(`/exchanges/${segment(id)}`, exchangesResponseCodec, {
        method: 'PUT',
        body: encode(exchangeAmendBodySchema, body),
      }),

    removeExchange: async (id) =>
      request(`/exchanges/${segment(id)}`, exchangesResponseCodec, { method: 'DELETE' }),

    restoreExchange: async (id) =>
      request(`/exchanges/${segment(id)}/restore`, exchangesResponseCodec, { method: 'POST' }),

    chooseRatePreference: async (preference) =>
      request('/actors/me/rate-preference', exchangesResponseCodec, {
        method: 'PUT',
        body: encode(ratePreferenceBodySchema, { preference }),
      }),

    incomes: () => request('/incomes', incomesResponseCodec),

    recordIncome: async (body) => {
      const { status, data } = await exchange('/incomes', incomesResponseCodec, {
        method: 'POST',
        body: encode(incomeBodySchema, body),
      })
      return { incomes: data, created: status === 201 }
    },

    amendIncome: async (id, body) =>
      request(`/incomes/${segment(id)}`, incomesResponseCodec, {
        method: 'PUT',
        body: encode(incomeAmendBodySchema, body),
      }),

    removeIncome: async (id) =>
      request(`/incomes/${segment(id)}`, incomesResponseCodec, { method: 'DELETE' }),

    restoreIncome: async (id) =>
      request(`/incomes/${segment(id)}/restore`, incomesResponseCodec, { method: 'POST' }),

    moneyMonth: async (month, cursor) => {
      // Checked before anything is sent, as a verdict's address is: a month that is not one could
      // only be refused, and one carrying «/» would reach another address.
      if (!monthSchema.safeParse(month).success) throw new ApiError(ERROR.NOT_FOUND, 'month', false)
      const query = cursor
        ? `?${new URLSearchParams({ cursor: journalCursorCodec.encode(cursor) }).toString()}`
        : ''
      return request(`/money/months/${month}${query}`, moneyMonthCodec)
    },

    moneyCharts: (period) => request(`/money/charts?period=${String(period)}`, moneyChartsCodec),

    salaryShift: () => request('/actors/me/salary-shift', salaryShiftSchema),

    chooseSalaryShift: async (day) =>
      request('/actors/me/salary-shift', salaryShiftSchema, {
        method: 'PUT',
        body: encode(salaryShiftSchema, { day }),
      }),

    recordSpending: async (body) => {
      const { status, data } = await exchange('/spendings', spendingViewCodec, {
        method: 'POST',
        body: encode(spendingBodySchema, body),
      })
      return { spending: data, created: status === 201 }
    },

    amendSpending: async (id, body) =>
      request(`/spendings/${segment(id)}`, spendingViewCodec, {
        method: 'PUT',
        body: encode(spendingAmendBodySchema, body),
      }),

    // A portal's page answering a redirected DELETE with 200 is not the removal (MOL-57, round 4).
    removeSpending: async (id) => {
      noContent(await exchange(`/spendings/${segment(id)}`, z.undefined(), { method: 'DELETE' }))
    },

    restoreSpending: async (id) =>
      request(`/spendings/${segment(id)}/restore`, spendingViewCodec, { method: 'POST' }),

    moneyAccounts: () => request('/money/accounts', moneyAccountsCodec),

    addMoneyAccount: async (body) => {
      const { status, data } = await exchange('/money/accounts', moneyAccountsCodec, {
        method: 'POST',
        body: encode(moneyAccountBodySchema, body),
      })
      return { accounts: data, created: status === 201 }
    },

    amendMoneyAccount: async (id, body) =>
      request(`/money/accounts/${segment(id)}`, moneyAccountsCodec, {
        method: 'PUT',
        body: encode(moneyAccountAmendBodySchema, body),
      }),

    removeMoneyAccount: async (id) =>
      request(`/money/accounts/${segment(id)}`, moneyAccountsCodec, { method: 'DELETE' }),

    restoreMoneyAccount: async (id) =>
      request(`/money/accounts/${segment(id)}/restore`, moneyAccountsCodec, { method: 'POST' }),

    accountJournal: async (id, cursor) => {
      const query = cursor
        ? `?${new URLSearchParams({ cursor: journalCursorCodec.encode(cursor) }).toString()}`
        : ''
      return request(`/money/accounts/${segment(id)}/journal${query}`, accountJournalCodec)
    },

    unassignedOperations: () => request('/money/accounts/unassigned', unassignedOperationsCodec),

    checkAccount: async (id, body) =>
      request(`/money/accounts/${segment(id)}/checks`, accountCheckCodec, {
        method: 'POST',
        body: encode(accountCheckBodySchema, body),
      }),

    accountsHeld: async ({ currency, day, except }) => {
      const query = new URLSearchParams({ currency, day, ...(except ? { except } : {}) })
      return request(`/money/accounts/held?${query.toString()}`, accountsHeldCodec)
    },

    payTrip: async (tripId, body) =>
      request(`/trips/${segment(tripId)}/payment`, tripViewCodec, {
        method: 'PUT',
        body: encode(tripPaymentBodySchema, body),
      }),

    spendingCategories: () => request('/spending-categories', spendingCategoriesResponseCodec),

    addSpendingCategory: async (body) => {
      const { status, data } = await exchange(
        '/spending-categories',
        spendingCategoriesResponseCodec,
        { method: 'POST', body: encode(spendingCategoryBodySchema, body) },
      )
      return { categories: data, created: status === 201 }
    },

    archiveSpendingCategory: async (id) =>
      request(`/spending-categories/${segment(id)}`, spendingCategoriesResponseCodec, {
        method: 'DELETE',
      }),

    restoreSpendingCategory: async (id) =>
      request(`/spending-categories/${segment(id)}/restore`, spendingCategoriesResponseCodec, {
        method: 'POST',
      }),

    // 204 has no body, and nothing else is a success here.
    finishTrip: async (tripId, finishedOnDeviceAt) => {
      await request(`/trips/${segment(tripId)}/finish`, z.undefined(), {
        method: 'POST',
        ...(finishedOnDeviceAt
          ? { body: encode(finishTripBodySchema, { finishedOnDeviceAt }) }
          : {}),
      })
    },
    rateItem: async (itemId, rating) => {
      const { status, data } = await exchange(verdictPath(itemId), verdictCardCodec, {
        method: 'PUT',
        body: encode(ratingSchema, rating),
      })
      return { verdict: data, created: status === 201 }
    },

    amendVerdict: async (itemId, patch) =>
      request(verdictPath(itemId), verdictCardCodec, {
        method: 'PATCH',
        body: encode(verdictAmendmentSchema, patch),
      }),

    // 204 carries no body, and a body where none was promised is an answer off the contract.
    withdrawVerdict: async (itemId) =>
      request(verdictPath(itemId), z.undefined(), { method: 'DELETE' }),

    pendingVerdicts: async () => request('/verdicts/pending', pendingVerdictsCodec),

    advice: async () => request('/advice', adviceResponseSchema),
    adviceSearch: async (query, options = {}) => {
      const search = new URLSearchParams({ q: query })
      return request(
        `/advice/search?${search.toString()}`,
        adviceSearchResponseSchema,
        options.signal === undefined ? {} : { signal: options.signal },
      )
    },
  }
}
