import type { ZodType } from 'zod'
import { DomainError, ERROR, errorResponseSchema, healthResponseSchema } from '@molvia/model'
import type { HealthResponse } from '@molvia/model'

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
        ? new DomainError(failure.data.code, failure.data.details)
        : new DomainError(ERROR.INTERNAL, `HTTP ${String(response.status)}`)
    }

    return schema.parse(body)
  }

  return {
    health: () => request('/health', healthResponseSchema),
  }
}
