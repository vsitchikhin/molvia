/**
 * What reading a receipt by a model costs (MOL-272, Т-3, Т-4): the model's price written in the code, each
 * call counted at its own `usage` — an answer we did not take too, since it was paid — and before the
 * call its worst, which the month's cap is held against. Integer micro-dollars throughout: a dollar is a
 * currency here, and a sum of floats over a month of calls drifts.
 */

/** The model that reads receipts: Haiku 5.5. */
export const RECEIPT_MODEL = 'claude-haiku-5-5'

/**
 * Its price in micro-dollars a million tokens, for a request up to `RECEIPT_MODEL_INPUT_MAX` tokens (the
 * Claude API's price list, 06.10.2026): $0,10 in, $0,50 out — thinking is output — a cache write 1.25×
 * the input, a read 0.1×.
 */
export const RECEIPT_MODEL_PRICE = {
  input: 100_000,
  output: 500_000,
  cacheWrite: 125_000,
  cacheRead: 10_000,
} as const

/** The tokens the price above holds for; a request past it is priced otherwise and never sent. */
export const RECEIPT_MODEL_INPUT_MAX = 100_000

/**
 * The most an answer may take, thinking included: the bench's longest was 10 534 (MOL-272). It is the
 * output the worst price counts.
 */
export const RECEIPT_MODEL_OUTPUT_MAX = 16_000

/**
 * An image's tokens at most: its pixels over 750 (the Claude API's rule). The API scales a larger image
 * down, never up, so the pixels sent bound it from above.
 */
const PIXELS_A_TOKEN = 750

/** What a call used, as the Messages API answers it. */
export interface ModelUsage {
  readonly input_tokens: number
  readonly output_tokens: number
  readonly cache_creation_input_tokens?: number | null
  readonly cache_read_input_tokens?: number | null
}

const MILLION = 1_000_000

/** A call's price by what it used, rounded up to the micro-dollar. */
export function modelCallMicroUsd(usage: ModelUsage): number {
  const p = RECEIPT_MODEL_PRICE
  const millionths =
    usage.input_tokens * p.input +
    (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite +
    (usage.cache_read_input_tokens ?? 0) * p.cacheRead +
    usage.output_tokens * p.output
  return Math.ceil(millionths / MILLION)
}

/**
 * The input of a call at most: every image by its pixels, and the text by its UTF-8 bytes — a token is at
 * least one byte.
 */
export function modelInputTokensMax(
  images: readonly { width: number; height: number }[],
  textBytes: number,
): number {
  return (
    images.reduce(
      (all, { width, height }) => all + Math.ceil((width * height) / PIXELS_A_TOKEN),
      0,
    ) + textBytes
  )
}

/** The most a call may cost: its input at most and the whole output it may take. */
export function worstCallMicroUsd(inputTokens: number): number {
  return modelCallMicroUsd({ input_tokens: inputTokens, output_tokens: RECEIPT_MODEL_OUTPUT_MAX })
}

/**
 * The shares of the month's cap the owner hears of, each once a month (В-2 «а»): half, nine tenths, and
 * the stop — a call that would not fit under the cap, after which no call goes until the month ends.
 */
export const MODEL_SPEND_STEPS = [50, 90, 100] as const
export type ModelSpendStep = (typeof MODEL_SPEND_STEPS)[number]

/** The step a month's spending has reached: 50 and 90 by the share spent, 100 only by a call refused. */
export function modelSpendStep(spentMicroUsd: number, capMicroUsd: number): ModelSpendStep | 0 {
  if (spentMicroUsd * 10 >= capMicroUsd * 9) return 90
  if (spentMicroUsd * 2 >= capMicroUsd) return 50
  return 0
}

/** The month a call is counted in: the calendar month in UTC, as Anthropic bills. */
export const spendMonthOf = (at: Date): string => `${at.toISOString().slice(0, 7)}-01`
