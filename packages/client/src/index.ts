import type { ZodType } from 'zod'
import {
  ACTOR_HEADER,
  ERROR,
  INVITE_HEADER,
  ISSUE,
  actorCodec,
  errorResponseSchema,
  healthResponseSchema,
} from '@molvia/model'
import type { Actor, HealthResponse, WireCode } from '@molvia/model'

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

/**
 * How long a request may hang before it is called a failure.
 *
 * Without it a captive portal or a half-dead mobile network holds the call open forever, and
 * the PWA stays on «loading» — a screen with no message and no retry, while the identity
 * lock it is holding keeps every other tab waiting too. A refusal the caller can act on
 * beats a wait nobody can end.
 */
const REQUEST_TIMEOUT_MS = 15_000

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
}

export interface MolviaClient {
  health(): Promise<HealthResponse>
  /** The first visit. The code comes from the link the person opened, once per device. */
  createActor(inviteCode: string): Promise<Actor>
  /** Whether the identity this client carries is still alive. */
  me(): Promise<Actor>
}

/**
 * The PWA and the bot both talk to the API through this, and both validate what comes
 * back against the same schemas the API answers with.
 */
export function createClient({
  baseUrl,
  fetch = globalThis.fetch,
  actorId,
}: ClientOptions): MolviaClient {
  function header(name: string, value: string, headers: Headers): void {
    // A stored identifier with a newline in it would otherwise take the whole call down as
    // a TypeError from `Headers.set` — and a value that cannot be sent names no subject, so
    // it is refused with the code that means exactly that.
    if (!HEADER_SAFE.test(value)) throw new ApiError(ERROR.NO_ACTOR, name)
    headers.set(name, value)
  }

  async function request<T>(path: string, schema: ZodType<T>, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    const id = actorId?.()
    // Set only when there is one: `X-Molvia-Actor: null` is the string «null», which the
    // server refuses for a reason the caller cannot act on.
    if (id) header(ACTOR_HEADER, id, headers)

    let response: Response
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      // A dropped connection is `fetch`'s own TypeError. Whether that reads as «offline» or
      // as «broken» is the caller's call — what matters here is that it arrives as an
      // ApiError like everything else.
      throw new ApiError(ERROR.INTERNAL, error instanceof Error ? error.message : 'transport')
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
    if (parsed.success) return parsed.data
    throw new ApiError(ISSUE.RESPONSE_INVALID, parsed.error.issues[0]?.path.join('.'))
  }

  return {
    health: () => request('/health', healthResponseSchema),

    // The entity arrives with its timestamps as ISO strings and leaves this call as the
    // domain object: the codec is the only place that border is crossed.
    // `async` so that a refused code arrives as a rejection rather than a synchronous
    // throw: a caller writing `createActor(code).catch(…)` would never see the latter, and
    // «everything this module throws is an ApiError» has to mean «through the promise».
    createActor: async (inviteCode) => {
      const headers = new Headers()
      header(INVITE_HEADER, inviteCode, headers)
      return request('/actors', actorCodec, { method: 'POST', headers })
    },

    me: () => request('/actors/me', actorCodec),
  }
}
