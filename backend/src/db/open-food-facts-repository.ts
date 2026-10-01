import { and, eq, inArray, sql } from 'drizzle-orm'
import type { OffAnswer } from '@/open-food-facts/product'
import type { Conn } from './index'
import { openFoodFacts } from './schema'

/** What the base said of a code, and how many days ago it said it. */
export interface CachedAnswer {
  readonly answer: OffAnswer
  readonly ageDays: number
}

export interface OpenFoodFactsRepository {
  /** The answer kept for a code, of any age — how long it holds is the reader's rule. */
  get(code: string): Promise<CachedAnswer | null>

  /** The base's answer, today's: a find and a miss alike, over whatever was kept before. */
  put(code: string, answer: OffAnswer): Promise<void>

  /**
   * Whether the base named any of these codes (MOL-162, В-2) — the item proposed with one may hold
   * its data, whatever the person did with the name. Of any age: what was shown once was shown.
   */
  named(codes: readonly string[]): Promise<boolean>
}

function answerOf(row: typeof openFoodFacts.$inferSelect): OffAnswer {
  if (!row.found || row.nameRu === null || row.nameEn === null) return { found: false }
  return {
    found: true,
    product: {
      names: { ru: row.nameRu, en: row.nameEn },
      quantity:
        row.quantityMilli === null || row.quantityUnit === null
          ? null
          : { milli: row.quantityMilli, unit: row.quantityUnit },
    },
  }
}

export function createOpenFoodFactsRepository(db: Conn): OpenFoodFactsRepository {
  return {
    async get(code) {
      const [row] = await db
        .select({
          row: openFoodFacts,
          // Days by the database's calendar, the same one that stamped `fetched_on`.
          ageDays: sql<number>`(current_date - ${openFoodFacts.fetchedOn})::int`,
        })
        .from(openFoodFacts)
        .where(eq(openFoodFacts.code, code))
      return row === undefined ? null : { answer: answerOf(row.row), ageDays: row.ageDays }
    },

    async put(code, answer) {
      const found = answer.found ? answer.product : null
      const values = {
        found: found !== null,
        nameRu: found?.names.ru ?? null,
        nameEn: found?.names.en ?? null,
        quantityMilli: found?.quantity?.milli ?? null,
        quantityUnit: found?.quantity?.unit ?? null,
        fetchedOn: sql`current_date`,
      }
      await db
        .insert(openFoodFacts)
        .values({ code, ...values })
        .onConflictDoUpdate({ target: openFoodFacts.code, set: values })
    },

    async named(codes) {
      if (codes.length === 0) return false
      const [row] = await db
        .select({ code: openFoodFacts.code })
        .from(openFoodFacts)
        .where(and(inArray(openFoodFacts.code, [...codes]), eq(openFoodFacts.found, true)))
        .limit(1)
      return row !== undefined
    },
  }
}
