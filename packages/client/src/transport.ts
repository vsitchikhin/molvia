import type { ZodType } from 'zod'
import { ERROR, ISSUE, errorResponseSchema } from '@molvia/model'
import type { WireCode } from '@molvia/model'

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

interface RequestOptions {
  readonly method?: string
  readonly headers?: Headers
  /** `null` means «wait as long as it takes» — see `devLogin`. */
  readonly timeout?: number | null
  /** Sent as JSON. Already on the wire's side: the caller encodes through the schema. */
  readonly body?: unknown
  /** The caller's own cancellation, on top of the timeout. */
  readonly signal?: AbortSignal
}

export interface Transport {
  readonly request: <T>(path: string, schema: ZodType<T>, options?: RequestOptions) => Promise<T>
  readonly exchange: <T>(
    path: string,
    schema: ZodType<T>,
    options?: RequestOptions,
  ) => Promise<{ status: number; data: T }>
}

export function createTransport({
  baseUrl,
  fetch = globalThis.fetch,
  credentials = 'same-origin',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  botSecret,
}: ClientOptions & { readonly botSecret?: string }): Transport {
  async function exchange<T>(
    path: string,
    schema: ZodType<T>,
    options: RequestOptions = {},
  ): Promise<{ status: number; data: T }> {
    const headers = new Headers(options.headers)
    if (botSecret) headers.set('authorization', `Bearer ${botSecret}`)
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
          ...(botSecret ? { redirect: 'error' as const } : {}),
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

  async function request<T>(
    path: string,
    schema: ZodType<T>,
    options: RequestOptions = {},
  ): Promise<T> {
    return (await exchange(path, schema, options)).data
  }

  return { request, exchange }
}
