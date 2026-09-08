import { z } from 'zod'

/**
 * Geography belongs to no single entity: an owner has a country of residence, a place has
 * a country it stands in, and they are the same vocabulary. Keeping it in whichever entity
 * needed it first is how `place.city` ended up capped at 120 characters and `actor.city`
 * capped at nothing.
 */

/** ISO 3166-1 alpha-2. Part of the key from the start, not "we'll add it later". */
export const countrySchema = z.string().regex(/^[A-Z]{2}$/)

export const citySchema = z.string().trim().min(1).max(120)
