/**
 * What reading a receipt by a model costs (MOL-272, Т-3, Т-4): the model's price written in the code, each
 * call counted at its own `usage` — an answer we did not take too, since it was paid — and before the
 * call its worst, which the month's cap is held against. Integer micro-dollars throughout: a dollar is a
 * currency here, and a sum of floats over a month of calls drifts.
 */

/** The model that reads receipts: Haiku 5.5. */
export const RECEIPT_MODEL = 'claude-haiku-5-5'

/**
 * The model that reads again a receipt the first did not read whole (MOL-405): Sonnet 5.5, the same prompt and schema.
 * On the bench it adds a fifth of the right figures and no wrong one, at ten times Haiku's price a call.
 */
export const RECEIPT_SECOND_MODEL = 'claude-sonnet-5-5'

/** A model that reads receipts. */
export type ReceiptModelName = typeof RECEIPT_MODEL | typeof RECEIPT_SECOND_MODEL

/**
 * Each model's price in micro-dollars a million tokens, for a request up to `RECEIPT_MODEL_INPUT_MAX` tokens (the
 * Claude API's price list): Haiku $0,10 in, $0,50 out (06.10.2026), Sonnet $2 and $10 (17.11.2026) — thinking is
 * output — a cache write 1.25× the input, a read 0.1×.
 */
export const RECEIPT_MODEL_PRICES = {
  [RECEIPT_MODEL]: { input: 100_000, output: 500_000, cacheWrite: 125_000, cacheRead: 10_000 },
  [RECEIPT_SECOND_MODEL]: {
    input: 2_000_000,
    output: 10_000_000,
    cacheWrite: 2_500_000,
    cacheRead: 200_000,
  },
} as const satisfies Record<
  ReceiptModelName,
  { input: number; output: number; cacheWrite: number; cacheRead: number }
>

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

/** A call's price by what it used, at its model's price, rounded up to the micro-dollar. */
export function modelCallMicroUsd(usage: ModelUsage, model: ReceiptModelName): number {
  const p = RECEIPT_MODEL_PRICES[model]
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

/** The most a call of the model may cost: its input at most and the whole output it may take. */
export function worstCallMicroUsd(inputTokens: number, model: ReceiptModelName): number {
  return modelCallMicroUsd(
    { input_tokens: inputTokens, output_tokens: RECEIPT_MODEL_OUTPUT_MAX },
    model,
  )
}

/**
 * What the model may cost reading one person's receipts in a month (MOL-367, owner's В-1 «а»): $2, the price of a month
 * of receipts (MOL-271), so one person never takes the cap from the others. **A constant, never the environment**
 * (В-5 «а»): the privacy page names it, so a change is a change of the code and a revision of the page in one pull
 * request, as `RECEIPTS_DAY_MAX` is. Above the month's cap it is the cap.
 */
export const RECEIPT_MODEL_SHARE_MICRO_USD = 2_000_000

/**
 * The shares of the month's cap the owner hears of, each once a month (В-2 «а»): half, nine tenths, and
 * the stop — the first call that would not fit under the cap. It stops that call, not the month: the model
 * reads up to the last call that still fits (В-2 «а»), and a smaller receipt after it may (adversarial А1).
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

/**
 * The receipts the model reads free for anyone who has never paid (MOL-275, MOL-271's «пробник»): the first ten of
 * their life, a count on the person that only goes down, spent only while no paid access is open
 * (`receipts_model_until`).
 */
export const RECEIPT_TRIAL = 10

/**
 * The receipts the model reads a person in their month at most, paid or on the trial (MOL-275, MOL-271: the tariff of
 * receipts is «до 100 в месяц»). The month is the phone's when the receipt was sent (MOL-121); a receipt counts once
 * its reading reached the review, a repeat of a counted one never. Beside the share's dollars, which hold the money.
 */
export const RECEIPTS_MODEL_MONTH_MAX = 100

/**
 * The share of the month's cap past which the model no longer reads on the trial (MOL-275, owner's В-3 «а»): the
 * trial stops first, paid access last; half, the owner's first notice, so the day it stops is the day he hears.
 */
export const RECEIPT_TRIAL_CAP_PERCENT = 50

/** What of the month's cap the trial may take: `RECEIPT_TRIAL_CAP_PERCENT` of it, to the micro-dollar below. */
export const trialCapMicroUsd = (capMicroUsd: number): number =>
  Math.floor((capMicroUsd * RECEIPT_TRIAL_CAP_PERCENT) / 100)

/** The month a receipt sent on the phone's `day` counts in (MOL-275, MOL-121): its first day, `YYYY-MM-01`. */
export const receiptsMonthOf = (day: string): string => `${day.slice(0, 7)}-01`

/**
 * How a receipt the model read was counted (MOL-275): `trial` — a trial receipt and a place in the hundred, `month` — a
 * place alone, the reading paid. «Переснять» gives back what it took (owner's В-4 «а»), so it is kept.
 */
export const RECEIPT_COUNTS = ['trial', 'month'] as const
export type ReceiptCount = (typeof RECEIPT_COUNTS)[number]
