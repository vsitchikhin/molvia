import type { ZodType } from 'zod'
import { ERROR, ISSUE, errorResponseSchema, healthResponseSchema } from '@molvia/model'
import type { HealthResponse, WireCode } from '@molvia/model'

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
  404: ERROR.NOT_FOUND,
})

export interface ClientOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
}

export interface MolviaClient {
  health(): Promise<HealthResponse>
}

/**
 * The PWA and the bot both talk to the API through this, and both validate what comes
 * back against the same schemas the API answers with.
 */
export function createClient({ baseUrl, fetch = globalThis.fetch }: ClientOptions): MolviaClient {
  async function request<T>(path: string, schema: ZodType<T>): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`)
    const body: unknown = await response.json()

    if (!response.ok) {
      const failure = errorResponseSchema.safeParse(body)
      if (failure.success) throw new ApiError(failure.data.code, failure.data.details)
      // The body says nothing usable, so the status is all there is — and «not found» is
      // a code the registry has, not something to be read back out of a message.
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
  }
}
