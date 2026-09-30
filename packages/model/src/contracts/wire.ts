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
 * The header every answer of the API names its build in — the `version` above, on every route
 * (MOL-132). An open page that meets a build other than the first it met was rolled out under,
 * and looks for its new version then rather than on its next return.
 */
export const VERSION_HEADER = 'X-Molvia-Version'

/**
 * The header every request of the phone names its own today in, `2026-09-28` (MOL-121, round 2): the
 * day it is for the person, which the server counts «today» by — the running month, the wallet, a
 * check — held to the days that are today somewhere (`todayFrom`). Absent — the bot, a page older
 * than it — and the server counts by Yerevan's.
 */
export const TODAY_HEADER = 'X-Molvia-Today'

/**
 * The header every request of the phone names its time zone in, `Europe/Moscow` (MOL-121, adversarial
 * round 4 У, Ч): where the phone's days begin and end, for a moment the server stamped itself — a
 * record written, a setting changed — to be a day beside the days the phone names. A name the server
 * does not know, or none, and it is Yerevan's.
 */
export const ZONE_HEADER = 'X-Molvia-Zone'

/** The build a copy that was not built by the release runs as: nothing to compare. */
export const UNNAMED_BUILD = 'dev'

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
