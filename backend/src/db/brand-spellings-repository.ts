import { inArray, isNotNull } from 'drizzle-orm'
import type { Conn } from './index'
import { brandSpellings } from './schema'

/** A brand and what the model said of its package's spelling: none where it knew none or said one not taken. */
export interface BrandSpelt {
  readonly brand: string
  readonly spelling: string | null
}

/** The brands the model was asked how their packages spell them (MOL-326, owner's В-1 «б»), each once. */
export interface BrandSpellingRepository {
  /** What was said of these brands, by their `brandKey`: a brand never asked is not in it. */
  said(brands: readonly string[]): Promise<Map<string, string | null>>
  /** Every spelling taken: what the renaming of items recorded before names their brands by. */
  spelt(): Promise<Map<string, string>>
  /**
   * Remembers what the model said, under the version that said it. A brand said already keeps its first word: two
   * receipts read at once ask twice, and the first answer stands.
   */
  remember(rows: readonly BrandSpelt[], said: string): Promise<void>
}

export function createBrandSpellingRepository(db: Conn): BrandSpellingRepository {
  return {
    async said(brands) {
      if (brands.length === 0) return new Map()
      const rows = await db
        .select({ brand: brandSpellings.brand, spelling: brandSpellings.spelling })
        .from(brandSpellings)
        .where(inArray(brandSpellings.brand, [...brands]))
      return new Map(rows.map((row) => [row.brand, row.spelling]))
    },

    async spelt() {
      const rows = await db
        .select({ brand: brandSpellings.brand, spelling: brandSpellings.spelling })
        .from(brandSpellings)
        .where(isNotNull(brandSpellings.spelling))
      return new Map(
        rows.flatMap((row) => (row.spelling === null ? [] : [[row.brand, row.spelling]])),
      )
    },

    async remember(rows, said) {
      if (rows.length === 0) return
      await db
        .insert(brandSpellings)
        .values(rows.map(({ brand, spelling }) => ({ brand, spelling, said })))
        .onConflictDoNothing({ target: brandSpellings.brand })
    },
  }
}
