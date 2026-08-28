import type { HealthResponse } from '@molvia/model'

export function getHealth(version: string): HealthResponse {
  return { status: 'ok', version }
}
