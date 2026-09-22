import { z } from 'zod'
import type { ZodType } from 'zod'
import {
  ERROR,
  ISSUE,
  actorCodec,
  adviceResponseSchema,
  addExpenseBodySchema,
  catalogueEntryCodec,
  catalogueSearchResponseSchema,
  currentTripResponseSchema,
  errorResponseSchema,
  expensePatchSchema,
  healthResponseSchema,
  isWireCode,
  proposedItemSchema,
  rateChoiceBodySchema,
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
  ActorView,
  AdviceResponse,
  AddExpenseBody,
  CatalogueEntry,
  ExpensePatch,
  HealthResponse,
  PendingVerdicts,
  ProposedItem,
  RateChoiceBody,
  Rating,
  StartTripBody,
  TripPlace,
  TripView,
  VerdictAmendment,
  VerdictCard,
  WireCode,
} from '@molvia/model'

/**
 * What the API answered with. Not a DomainError: the wire carries shape errors too — a
 * malformed body is the commonest failure there is — and those are not domain rules.
 *
 * Everything this module throws is one of these, and the claim is load-bearing: the PWA
 * decides that its identity is gone by reading `error.code`, so anything escaping as a
 * `SyntaxError` or a `TypeError` is silently read as «the server did not answer».
 */
export class ApiError extends Error {
  readonly code: WireCode
  /**
   * Whether the code is the API's own word — its error body — rather than inferred from a bare
   * status or from no answer at all. A 404 page from a shop's captive portal becomes `not_found`
   * here too, and a caller for whom a refusal is final (the trip queue, MOL-24) must not take it
   * for the server's.
   */
  readonly answered: boolean

  constructor(code: WireCode, details?: string, answered = true) {
    super(details ? `${code}: ${details}` : code)
    this.name = 'ApiError'
    this.code = code
    this.answered = answered
  }
}

/**
 * Codes that may be inferred from a status alone, when the body carries nothing usable.
 *
 * **401 is deliberately absent.** A 401 is the one status the PWA acts on destructively —
 * it means «this identity is gone», and the store replaces it. Anything in front of the API
 * can answer 401 without knowing what an actor is: basic auth on Caddy, an API gateway, a
 * captive portal on shop wifi. Only a body that parses as this project's own error shape
 * may say NO_ACTOR; a bare 401 is reported as an answer that did not match the contract.
 */
const CODE_BY_STATUS: Readonly<Record<number, WireCode>> = Object.freeze({
  404: ERROR.NOT_FOUND,
})

/** How long a request may hang before it is called a failure. */
const DEFAULT_TIMEOUT_MS = 15_000

export interface ClientOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  /**
   * Whether the browser's cookies travel with a request. `same-origin` is the default in every
   * browser that matters, and it is written out because since MOL-53 it is **the whole of how a
   * request proves who it is**: a line that silently changed to `omit` would log everybody out.
   *
   * There is nothing else here about identity, and that is the point. The client cannot name an
   * owner, cannot read the session and cannot speak as anybody: what it sends is whatever the
   * browser attached, and in Node — where the bot runs — that is nothing at all.
   *
   * Spelled out rather than taken from `RequestCredentials`: the backend and the bot compile
   * this source without the DOM library, and a name that only exists in a browser's types would
   * fail to build for them.
   */
  readonly credentials?: 'omit' | 'same-origin' | 'include'
  /**
   * How long a request may hang. A test sets it to milliseconds; nothing else should need
   * to — a constant here would make every suite that covers the timeout wait for it.
   */
  readonly timeoutMs?: number
}

export interface MolviaClient {
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
  /**
   * The catalogue lookup behind «что взяли?», ranked by the server — the query goes as typed.
   * The screen searches while the person types, so a search the next keystroke made stale is
   * cancelled through `signal`; the cancellation arrives as an ApiError like everything else.
   */
  searchCatalogue(
    query: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CatalogueEntry[]>
  /**
   * «Предложить товар». `created` is `false` when the catalogue already held an item of this
   * kind by the same name — the entry is then that item, and the fields sent were not applied.
   */
  proposeItem(input: ProposedItem): Promise<{ entry: CatalogueEntry; created: boolean }>
  /** The places this person shopped in lately, to tap at the door instead of typing. */
  recentPlaces(): Promise<TripPlace[]>
  /**
   * «Начать поход». The identifier is the device's own, so sending it again after a lost reply
   * is safe: `created` is then `false` and the trip is the one already there. Another open trip
   * rejects with `error.trip_open` — the screen then asks whether to continue it or finish it.
   */
  startTrip(body: StartTripBody): Promise<{ trip: TripView; created: boolean }>
  /** The trip the screen opens on, or null — «Новый поход». */
  currentTrip(): Promise<TripView | null>
  /** «Добавить в поход». The same identifier again is one purchase, and `created` is `false`. */
  addExpense(tripId: string, body: AddExpenseBody): Promise<{ trip: TripView; created: boolean }>
  /** «Добавить цену», «Сохранить»: `null` clears a field, a missing one leaves it be. */
  updateExpense(tripId: string, expenseId: string, patch: ExpensePatch): Promise<TripView>
  removeExpense(tripId: string, expenseId: string): Promise<TripView>
  /** «Завершить». Finishing twice is not an error. */
  finishTrip(tripId: string): Promise<void>
  /**
   * «Считать по новому курсу / по прежнему / по своему» when the rate the trip took jumped
   * (`rateJump`). Safe to repeat; a trip with nothing to choose between rejects with
   * `error.conflict`, an own rate that is not a rate with `error.invalid_rate`.
   */
  chooseTripRate(tripId: string, body: RateChoiceBody): Promise<TripView>
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
}

/**
 * The PWA and the bot both talk to the API through this, and both validate what comes
 * back against the same schemas the API answers with.
 */
export function createClient({
  baseUrl,
  fetch = globalThis.fetch,
  credentials = 'same-origin',
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ClientOptions): MolviaClient {
  interface Options {
    readonly method?: string
    readonly headers?: Headers
    /** `null` means «wait as long as it takes» — see `devLogin`. */
    readonly timeout?: number | null
    /** Sent as JSON. Already on the wire's side: the caller encodes through the schema. */
    readonly body?: unknown
    /** The caller's own cancellation, on top of the timeout. */
    readonly signal?: AbortSignal
  }

  async function exchange<T>(
    path: string,
    schema: ZodType<T>,
    options: Options = {},
  ): Promise<{ status: number; data: T }> {
    const headers = new Headers(options.headers)
    if (options.body !== undefined) headers.set('content-type', 'application/json')

    // `AbortController` and a timer rather than `AbortSignal.timeout`, which Safari only
    // learned in 16.0: on iOS 15 the call itself threw, inside the try below, and turned
    // **every** request into a failure — an app permanently in «error», retrying into the
    // same wall.
    const limit = options.timeout === undefined ? timeoutMs : options.timeout
    const controller = new AbortController()
    const timer =
      limit === null
        ? undefined
        : setTimeout(() => {
            controller.abort()
          }, limit)
    // The caller's signal drives the same controller rather than replacing it, so the timeout
    // still holds for a caller that passed one. `AbortSignal.any` would say this in one line,
    // and Safari only learned it in 17.4.
    const cancel = (): void => {
      controller.abort()
    }
    if (options.signal?.aborted) cancel()
    options.signal?.addEventListener('abort', cancel)

    // The deadline and the caller's cancellation hold until the body is read, not only until
    // the headers: a server that sends its headers and goes quiet — a proxy buffering, the Wi-Fi
    // at a shelf dropping mid-reply — would otherwise hold the call forever, past both.
    let response: Response
    let body: unknown
    try {
      try {
        response = await fetch(`${baseUrl}${path}`, {
          ...(options.method === undefined ? {} : { method: options.method }),
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          credentials,
          headers,
          signal: controller.signal,
        })
      } catch (error) {
        // A dropped connection is `fetch`'s own TypeError. Whether that reads as «offline» or
        // as «broken» is the caller's call — what matters here is that it arrives as an
        // ApiError like everything else.
        throw new ApiError(
          ERROR.INTERNAL,
          error instanceof Error ? error.message : 'transport',
          false,
        )
      }

      // A proxy page, an empty body, a reply cut off mid-flight: `.json()` throws, and every
      // line below — including the one that tells a dead identity from a broken server — used
      // to be skipped entirely.
      try {
        body = await response.json()
      } catch {
        // Cut off by the deadline or by the caller, the reply never came — it is not a reply
        // off the contract.
        if (controller.signal.aborted) throw new ApiError(ERROR.INTERNAL, 'aborted', false)
        body = undefined
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      options.signal?.removeEventListener('abort', cancel)
    }

    if (!response.ok) {
      const failure = errorResponseSchema.safeParse(body)
      if (failure.success) throw new ApiError(failure.data.code, failure.data.details)
      // The body says nothing this project would recognise, so only the status is left —
      // and it is never allowed to mean NO_ACTOR (see CODE_BY_STATUS). A 5xx is the server
      // being down rather than answering off-contract: Caddy's 502 during a deploy is «the
      // server broke», and calling it a malformed reply would send the caller looking in
      // the wrong place.
      const fallback = response.status >= 500 ? ERROR.INTERNAL : ISSUE.RESPONSE_INVALID
      throw new ApiError(
        CODE_BY_STATUS[response.status] ?? fallback,
        `HTTP ${String(response.status)}`,
        false,
      )
    }

    // A reply that does not match the schema is still the API's answer, so it leaves here
    // as an ApiError like everything else: `catch (e) { e instanceof ApiError }` is the
    // only way callers are meant to need.
    const parsed = schema.safeParse(body)
    if (parsed.success) return { status: response.status, data: parsed.data }
    throw new ApiError(ISSUE.RESPONSE_INVALID, parsed.error.issues[0]?.path.join('.'))
  }

  async function request<T>(path: string, schema: ZodType<T>, options: Options = {}): Promise<T> {
    return (await exchange(path, schema, options)).data
  }

  /**
   * A verdict is addressed by its item. Checked before anything is sent: an identifier that
   * is not one can only be refused, and one carrying «/» or «?» would reach another address.
   */
  function verdictPath(itemId: string): string {
    const path = verdictPathSchema.safeParse({ itemId })
    if (!path.success) throw new ApiError(ISSUE.PATH_INVALID, 'itemId')
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

    searchCatalogue: async (query, options = {}) => {
      // URLSearchParams, not a template: «&», «#», «+» and «%» in a query would otherwise
      // cut it short or change its meaning on the way.
      const search = new URLSearchParams({ q: query })
      const { items } = await request(
        `/catalogue/search?${search.toString()}`,
        catalogueSearchResponseSchema,
        options.signal === undefined ? {} : { signal: options.signal },
      )
      return items
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

    recentPlaces: async () => (await request('/places/recent', recentPlacesResponseSchema)).places,

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

    // 204 has no body, and nothing else is a success here.
    finishTrip: async (tripId) => {
      await request(`/trips/${segment(tripId)}/finish`, z.undefined(), { method: 'POST' })
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
  }
}
