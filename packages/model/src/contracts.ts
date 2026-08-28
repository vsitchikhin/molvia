import { z } from 'zod'

/** Shared between the API, the PWA and the bot — the only reason the language is TypeScript. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
})
export type HealthResponse = z.infer<typeof healthResponseSchema>

export const errorResponseSchema = z.object({
  code: z.string(),
  details: z.string().optional(),
})
export type ErrorResponse = z.infer<typeof errorResponseSchema>
