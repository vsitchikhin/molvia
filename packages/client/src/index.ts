import { z } from 'zod'
import type { ZodType } from 'zod'
import {
  ACTOR_HEADER,
  ERROR,
  INVITE_HEADER,
  ISSUE,
  actorCodec,
  catalogueEntryCodec,
  catalogueSearchResponseSchema,
  errorResponseSchema,
  healthResponseSchema,
  proposedItemSchema,
  ratingSchema,
  verdictAmendmentSchema,
  verdictCardCodec,
  verdictPathSchema,
} from '@molvia/model'
import type {
  Actor,
  CatalogueEntry,
  HealthResponse,
  ProposedItem,
  Rating,
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

  constructor(code: WireCode, details?: string) {
    super(details ? `${code}: ${details}` : code)
    this.name = 'ApiError'
    this.code = code
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

/**
 * A header value has to survive `Headers.set`, which throws a TypeError on anything outside
 * Latin-1 or containing a line break. Both values here come from outside the code — the
 * identifier from storage anyone can write to, the invite code from a link someone typed —
 * so they are checked rather than trusted.
 */
const HEADER_SAFE = /^[ -~]+$/

/** How long a request may hang before it is called a failure. */
const DEFAULT_TIMEOUT_MS = 15_000

export interface ClientOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  /**
   * The identity this client speaks for, read at call time rather than at construction.
   * A getter and not a value on purpose: the PWA builds the client before it has an
   * identity, and a captured `null` would be sent for the rest of the session.
   *
   * Reading storage is deliberately not this package's business — the bot is a client too
   * and has neither `localStorage` nor, in 0.1, an identity at all.
   */
  readonly actorId?: () => string | null
  /**
   * How long a request may hang. A test sets it to milliseconds; nothing else should need
   * to — a constant here would make every suite that covers the timeout wait for it.
   */
  readonly timeoutMs?: number
}

export interface MolviaClient {
  health(): Promise<HealthResponse>
  /** The first visit. The code comes from the link the person opened, once per device. */
  createActor(inviteCode: string): Promise<Actor>
  /**
   * Whether an identity is still alive. With no argument it asks about the one this client
   * speaks for; with one, about that identifier and **without touching anything else** —
   * which is what makes «check before restoring» possible instead of «replace and hope».
   */
  me(identifier?: string): Promise<Actor>
  /** The catalogue lookup behind «что взяли?», ranked by the server — the query goes as typed. */
  searchCatalogue(query: string): Promise<CatalogueEntry[]>
  /**
   * «Предложить товар». `created` is `false` when the catalogue already held an item of this
   * kind by the same name — the entry is then that item, and the fields sent were not applied.
   */
  proposeItem(input: ProposedItem): Promise<{ entry: CatalogueEntry; created: boolean }>
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
}

/**
 * The PWA and the bot both talk to the API through this, and both validate what comes
 * back against the same schemas the API answers with.
 */
export function createClient({
  baseUrl,
  fetch = globalThis.fetch,
  actorId,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ClientOptions): MolviaClient {
  function header(name: string, value: string, headers: Headers): void {
    // A stored identifier with a newline in it would otherwise take the whole call down as
    // a TypeError from `Headers.set` — and a value that cannot be sent names no subject, so
    // it is refused with the code that means exactly that.
    if (!HEADER_SAFE.test(value)) throw new ApiError(ERROR.NO_ACTOR, name)
    headers.set(name, value)
  }

  interface Options {
    readonly method?: string
    readonly headers?: Headers
    /** The identity to speak as, when it is not the one the client carries. */
    readonly as?: string
    /** `null` means «wait as long as it takes» — see `createActor`. */
    readonly timeout?: number | null
    /** Sent as JSON. Already on the wire's side: the caller encodes through the schema. */
    readonly body?: unknown
  }

  async function exchange<T>(
    path: string,
    schema: ZodType<T>,
    options: Options = {},
  ): Promise<{ status: number; data: T }> {
    const headers = new Headers(options.headers)
    if (options.body !== undefined) headers.set('content-type', 'application/json')
    const id = options.as ?? actorId?.()
    // Set only when there is one: `X-Molvia-Actor: null` is the string «null», which the
    // server refuses for a reason the caller cannot act on.
    if (id) header(ACTOR_HEADER, id, headers)

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

    let response: Response
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...(options.method === undefined ? {} : { method: options.method }),
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        headers,
        signal: controller.signal,
      })
    } catch (error) {
      // A dropped connection is `fetch`'s own TypeError. Whether that reads as «offline» or
      // as «broken» is the caller's call — what matters here is that it arrives as an
      // ApiError like everything else.
      throw new ApiError(ERROR.INTERNAL, error instanceof Error ? error.message : 'transport')
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }

    // A proxy page, an empty body, a reply cut off mid-flight: `.json()` throws, and every
    // line below — including the one that tells a dead identity from a broken server — used
    // to be skipped entirely.
    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = undefined
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

  /** The input goes out through its schema, and one it refuses arrives as a rejection. */
  function encode<T>(schema: ZodType<T>, input: T): unknown {
    const encoded = schema.safeEncode(input)
    if (!encoded.success) {
      throw new ApiError(ISSUE.BODY_INVALID, encoded.error.issues[0]?.path.join('.'))
    }
    return encoded.data
  }

  return {
    health: () => request('/health', healthResponseSchema),

    // `async` so that a refused code arrives as a rejection rather than a synchronous
    // throw: a caller writing `createActor(code).catch(…)` would never see the latter, and
    // «everything this module throws is an ApiError» has to mean «through the promise».
    createActor: async (inviteCode) => {
      const headers = new Headers()
      header(INVITE_HEADER, inviteCode, headers)

      // No timeout on the first visit, and this is the one place it is right to wait. An
      // abort here says nothing about whether the INSERT landed, so a retry after one
      // creates a **second** identity — and rows in `actors` are the denominator of the
      // 0.2 gate. A cold VPS answering slowly is the ordinary case, not the failure.
      return request('/actors', actorCodec, { method: 'POST', headers, timeout: null })
    },

    me: (identifier) =>
      request('/actors/me', actorCodec, identifier === undefined ? {} : { as: identifier }),

    searchCatalogue: async (query) => {
      // URLSearchParams, not a template: «&», «#», «+» and «%» in a query would otherwise
      // cut it short or change its meaning on the way.
      const search = new URLSearchParams({ q: query })
      const { items } = await request(
        `/catalogue/search?${search.toString()}`,
        catalogueSearchResponseSchema,
      )
      return items
    },

    // `async` so that an input the schema refuses arrives as a rejection, like everything else.
    proposeItem: async (input) => {
      const encoded = proposedItemSchema.safeEncode(input)
      if (!encoded.success) {
        throw new ApiError(ISSUE.BODY_INVALID, encoded.error.issues[0]?.path.join('.'))
      }

      // An ordinary timeout, unlike the first visit: an abort may leave the item written, and
      // a retry is still safe — the server answers an exact repeat with the item already there.
      const { status, data } = await exchange('/catalogue/items', catalogueEntryCodec, {
        method: 'POST',
        body: encoded.data,
      })
      return { entry: data, created: status === 201 }
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
  }
}
