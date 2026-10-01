import { writtenBarcode } from '@molvia/model'
import type { AppLocale, BarcodeHint } from '@molvia/model'
import type { OpenFoodFactsRepository } from '@/db/open-food-facts-repository'
import type { OpenFoodFacts } from '@/open-food-facts/client'
import type { OffAnswer } from '@/open-food-facts/product'

/** How long a find is believed, in days: a product's name and size change rarely (Р-7). */
export const FOUND_FRESH_DAYS = 30

/** How long a miss is believed: the base grows, and a code unknown today may be named next week. */
export const MISSED_FRESH_DAYS = 7

/** The product's page — the attribution the base's licence asks for, opened by the person's tap. */
export const OFF_PRODUCT_PAGE = 'https://world.openfoodfacts.org/product'

export interface HintDeps {
  readonly cache: OpenFoodFactsRepository
  /** `null` when the hint is off — no contact to give the base (MOL-162, В-4). */
  readonly off: OpenFoodFacts | null
}

function hintOf(answer: OffAnswer, code: string, locale: AppLocale): BarcodeHint | null {
  if (!answer.found) return null
  return {
    name: answer.product.names[locale],
    quantity: answer.product.quantity,
    url: `${OFF_PRODUCT_PAGE}/${code}`,
  }
}

/**
 * What Open Food Facts says a package is, for a code our catalogue missed (MOL-162): a name for
 * «Предложить товар» to start from, never a write. Asked by the server, so the base sees the code
 * and our address — not who scanned it.
 *
 * Only a code that could be written is asked about (`writtenBarcode`): a shop's own label is another
 * item in every shop and never leaves the server, and a code that does not check is on no package.
 * The answer kept is used while it is believed (`FOUND_FRESH_DAYS`, `MISSED_FRESH_DAYS`); past that
 * the base is asked again, and when it cannot be, a find kept from before is still a find. Out of
 * reach, over its limit or knowing nothing — no hint, and never an error: the hint is a bonus.
 */
export async function hintByBarcode(
  deps: HintDeps,
  code: string,
  locale: AppLocale,
): Promise<BarcodeHint | null> {
  if (deps.off === null) return null
  const written = writtenBarcode(code)
  if (!written.ok) return null

  const kept = await deps.cache.get(written.code)
  const freshFor = kept?.answer.found ? FOUND_FRESH_DAYS : MISSED_FRESH_DAYS
  if (kept !== null && kept.ageDays < freshFor) return hintOf(kept.answer, written.code, locale)

  const answer = await deps.off.product(written.code)
  if (answer === null) return kept === null ? null : hintOf(kept.answer, written.code, locale)
  await deps.cache.put(written.code, answer)
  return hintOf(answer, written.code, locale)
}
