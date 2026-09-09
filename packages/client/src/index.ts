import type { ZodType } from 'zod'
import { ERROR, errorResponseSchema, healthResponseSchema } from '@molvia/model'
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
      throw failure.success
        ? new ApiError(failure.data.code, failure.data.details)
        : new ApiError(ERROR.INTERNAL, `HTTP ${String(response.status)}`)
    }

    return schema.parse(body)
  }

  return {
    health: () => request('/health', healthResponseSchema),
  }
}
