import { z } from 'zod'

/**
 * The 0.3 threshold is measured separately for products and venues, so the subject is not
 * optional detail — it is the axis the whole gate splits on.
 */
export const catalogueSubjectSchema = z.enum(['product', 'venue'])
export type CatalogueSubject = z.infer<typeof catalogueSubjectSchema>
