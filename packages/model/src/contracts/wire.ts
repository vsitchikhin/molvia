import { z } from 'zod'
import { ERROR, ISSUE } from '#model/support/errors'

/** Shared between the API, the PWA and the bot — the only reason the language is TypeScript. */
const healthFields = z.object({
  // 'degraded' rather than an error: a process that is up but cannot reach its database
  // should say so plainly instead of pretending to be down or pretending to be fine.
  status: z.enum(['ok', 'degraded']),
  version: z.string().min(1),
  database: z.enum(['up', 'down']),
})

// The comment above says a live process with a dead database must not pretend to be fine.
// Until this refine, { status: 'ok', database: 'down' } was a valid answer.
export const healthResponseSchema = healthFields.refine(
  (health) => (health.status === 'ok') === (health.database === 'up'),
  { error: ISSUE.HEALTH_CONTRADICTS_ITSELF },
)
export type HealthResponse = z.infer<typeof healthResponseSchema>

/**
 * A failure crossing the wire carries a registry code, never a prose message — and both
 * registries cross it. A malformed body is the most common failure an API has, and a
 * response that can only name domain errors leaves it nothing to be reported as.
 */
export const wireCodeSchema = z.enum({ ...ERROR, ...ISSUE })
export type WireCode = z.infer<typeof wireCodeSchema>

export function isWireCode(value: unknown): value is WireCode {
  return wireCodeSchema.safeParse(value).success
}

export const errorResponseSchema = z.object({
  code: wireCodeSchema,
  details: z.string().max(200).optional(),
})
export type ErrorResponse = z.infer<typeof errorResponseSchema>
