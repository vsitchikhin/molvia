import {
  RECEIPT_MODEL_INPUT_MAX,
  brandKey,
  heardSpelling,
  modelCallMicroUsd,
  spendMonthOf,
} from '@molvia/model'
import type { BrandSpellingRepository } from '@/db/brand-spellings-repository'
import { BRANDS_OUTPUT_MAX, ModelRejected, ModelUnavailable } from '@/receipts/model-reader'
import type { BrandAsked } from '@/receipts/model-reader'
import type { ModelPaid, ReceiptModelDeps } from '@/usecases/read-receipts'

/**
 * The brands one call asks at most: a receipt prints a few dozen lines, and a brand past them waits for the next
 * receipt that prints it.
 */
export const BRANDS_A_CALL = 40

/** What happened, for the log: counts and reasons, never a brand — a brand is a line of a person's receipt. */
export type SpellReport =
  | {
      readonly kind: 'brands_spelt'
      readonly asked: number
      readonly taken: number
      readonly paid: ModelPaid
    }
  | {
      readonly kind: 'brands_passed'
      readonly reason: 'cap' | 'size' | 'refused' | 'cut' | 'invalid'
      readonly paid?: ModelPaid
    }
  | { readonly kind: 'brands_unavailable'; readonly reason: string }
  | { readonly kind: 'brands_rejected'; readonly error: ModelRejected }
  | { readonly kind: 'error'; readonly error: unknown }

export interface SpellBrandsDeps {
  readonly spellings: BrandSpellingRepository
  readonly model: ReceiptModelDeps
  readonly report: (event: SpellReport) => void
  readonly now?: () => Date
}

/**
 * How the packages spell the brands a receipt the model read prints in «…» and no table of ours spells (MOL-326,
 * owner's В-1 «б»), by their `brandKey`: what was said before, and the rest asked of the model once — text alone,
 * under the month's cap as a reading is, its worst reserved before the call and its own price after. A spelling is
 * taken only where it sounds as the till printed it (`heardSpelling`); what the model said is remembered either way,
 * so that no brand is paid for twice. A model away, refusing or over the cap asks again with the next receipt: the
 * brand is spelt in letters meanwhile, as before.
 */
export async function spelledBrands(
  {
    spellings,
    model: { reader, spend, capMicroUsd },
    report,
    now = () => new Date(),
  }: SpellBrandsDeps,
  asked: readonly BrandAsked[],
): Promise<Map<string, string>> {
  const byKey = new Map<string, BrandAsked>()
  for (const one of asked) {
    const key = brandKey(one.brand)
    if (!byKey.has(key)) byKey.set(key, one)
  }
  if (byKey.size === 0) return new Map()
  const said = await spellings.said([...byKey.keys()])
  const taken = new Map<string, string>()
  for (const [key, spelling] of said) if (spelling !== null) taken.set(key, spelling)
  const missing = [...byKey].filter(([key]) => !said.has(key)).slice(0, BRANDS_A_CALL)
  if (missing.length === 0) return taken

  const brands = missing.map(([, one]) => one)
  const input = reader.brandsInputTokensMax(brands)
  if (input > RECEIPT_MODEL_INPUT_MAX) {
    report({ kind: 'brands_passed', reason: 'size' })
    return taken
  }
  const worst = modelCallMicroUsd({ input_tokens: input, output_tokens: BRANDS_OUTPUT_MAX })
  const month = spendMonthOf(now())
  if (!(await spend.reserve(month, worst, capMicroUsd, now()))) {
    report({ kind: 'brands_passed', reason: 'cap' })
    return taken
  }
  let answer
  try {
    answer = await reader.spellBrands(brands)
  } catch (error) {
    if (error instanceof ModelUnavailable) {
      // a time out may have been paid: its worst stays counted
      if (error.costMicroUsd !== null) {
        await spend.settle(month, worst, error.costMicroUsd, capMicroUsd, now())
      }
      report({ kind: 'brands_unavailable', reason: error.reason })
      return taken
    }
    if (error instanceof ModelRejected) {
      await spend.settle(month, worst, 0, capMicroUsd, now())
      report({ kind: 'brands_rejected', error })
      return taken
    }
    // ours, and the receipt is not at fault: its brands are spelt in letters, the worst stays counted
    report({ kind: 'error', error })
    return taken
  }
  const paid: ModelPaid = { costMicroUsd: answer.costMicroUsd, tokens: answer.tokens }
  await spend.settle(month, worst, answer.costMicroUsd, capMicroUsd, now())
  if (answer.kind !== 'read') {
    report({ kind: 'brands_passed', reason: answer.kind, paid })
    return taken
  }
  const rows = missing.map(([key, one], at) => {
    const spelling = answer.spellings[at] ?? null
    return { brand: key, spelling: spelling === null ? null : heardSpelling(one.brand, spelling) }
  })
  await spellings.remember(rows, reader.brandsVersion)
  for (const row of rows) if (row.spelling !== null) taken.set(row.brand, row.spelling)
  report({
    kind: 'brands_spelt',
    asked: rows.length,
    taken: rows.filter((row) => row.spelling !== null).length,
    paid,
  })
  return taken
}
