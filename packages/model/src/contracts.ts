import { z } from 'zod'
import { ERROR } from './errors'

/** Shared between the API, the PWA and the bot — the only reason the language is TypeScript. */
export const healthResponseSchema = z.object({
  // 'degraded' rather than an error: a process that is up but cannot reach its database
  // should say so plainly instead of pretending to be down or pretending to be fine.
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  database: z.enum(['up', 'down']),
})
export type HealthResponse = z.infer<typeof healthResponseSchema>

/** A failure crossing the wire carries a registry code, never a prose message. */
export const errorCodeSchema = z.enum(ERROR)

export const errorResponseSchema = z.object({
  code: errorCodeSchema,
  details: z.string().optional(),
})
export type ErrorResponse = z.infer<typeof errorResponseSchema>
