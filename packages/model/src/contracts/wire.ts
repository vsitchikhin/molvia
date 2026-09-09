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

// One-directional on purpose. A dead database may not be reported as fine; a live one
// does not oblige the process to say it is fine, because the next dependency — the rate
// cache of MOL-39 — degrades without the database noticing.
export const healthResponseSchema = healthFields.refine(
  (health) => health.database === 'up' || health.status !== 'ok',
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
