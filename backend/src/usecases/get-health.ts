import type { HealthResponse } from '@molvia/model'

/** What the use case needs, not where it comes from — so a test can answer for it. */
export interface HealthProbe {
  databaseIsReachable(): Promise<boolean>
}

export async function getHealth(version: string, probe: HealthProbe): Promise<HealthResponse> {
  const database = (await probe.databaseIsReachable()) ? 'up' : 'down'
  return { status: database === 'up' ? 'ok' : 'degraded', version, database }
}
