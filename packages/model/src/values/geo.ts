import { z } from 'zod'

export const countrySchema = z.string().regex(/^[A-Z]{2}$/)

export const citySchema = z.string().trim().min(1).max(120)
