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
 */
export class ApiError extends Error {
  readonly code: WireCode

  constructor(code: WireCode, details?: string) {
    super(details ? `${code}: ${details}` : code)
    this.name = 'ApiError'
    this.code = code
  }
}

const CODE_BY_STATUS: Readonly<Record<number, WireCode>> = Object.freeze({
  401: ERROR.NO_ACTOR,
  404: ERROR.NOT_FOUND,
})

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
  async function request<T>(path: string, schema: ZodType<T>, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    const id = actorId?.()
    // Set only when there is one: `X-Molvia-Actor: null` is the string «null», which the
    // server refuses for a reason the caller cannot act on.
    if (id) headers.set(ACTOR_HEADER, id)

    const response = await fetch(`${baseUrl}${path}`, { ...init, headers })
    const body: unknown = await response.json()

    if (!response.ok) {
      const failure = errorResponseSchema.safeParse(body)
      if (failure.success) throw new ApiError(failure.data.code, failure.data.details)
      // The body says nothing usable, so the status is all there is — and «not found» and
      // «no actor» are codes the registry has, not something to be read back out of a message.
      throw new ApiError(
        CODE_BY_STATUS[response.status] ?? ERROR.INTERNAL,
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
    createActor: (inviteCode) =>
      request('/actors', actorCodec, {
        method: 'POST',
        headers: { [INVITE_HEADER]: inviteCode },
      }),

    me: () => request('/actors/me', actorCodec),
  }
}
