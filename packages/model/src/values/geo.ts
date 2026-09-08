import { z } from 'zod'
import { visibleLine } from '#model/support/text'

export const countrySchema = z.string().regex(/^[A-Z]{2}$/)

export const citySchema = visibleLine(120)
