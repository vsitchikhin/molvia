import { describe, expect, it } from 'vitest'
import {
  RECEIPT_MODEL_OUTPUT_MAX,
  modelCallMicroUsd,
  modelInputTokensMax,
  modelSpendStep,
  spendMonthOf,
  worstCallMicroUsd,
} from '#model/entities/model-spend'

describe('what a call of the model costs (MOL-272, Т-3)', () => {
  it('is its usage at Haiku 5.5’s price, rounded up to the micro-dollar', () => {
    // am-01 of the bench: 5 321 in, 2 242 out — $0,0016531
    expect(modelCallMicroUsd({ input_tokens: 5_321, output_tokens: 2_242 })).toBe(1_654)
    expect(modelCallMicroUsd({ input_tokens: 10, output_tokens: 0 })).toBe(1)
    expect(modelCallMicroUsd({ input_tokens: 0, output_tokens: 0 })).toBe(0)
  })

  it('counts the cache at its own price: a write 1.25× the input, a read a tenth', () => {
    const usage = { input_tokens: 0, output_tokens: 0 }
    expect(modelCallMicroUsd({ ...usage, cache_creation_input_tokens: 1_000_000 })).toBe(125_000)
    expect(modelCallMicroUsd({ ...usage, cache_read_input_tokens: 1_000_000 })).toBe(10_000)
    expect(modelCallMicroUsd({ ...usage, cache_read_input_tokens: null })).toBe(0)
  })
})

describe('the worst a call may cost (Т-4)', () => {
  it('bounds the input by the pixels sent and the text’s bytes', () => {
    // 1 179 × 2 843 is 4 469 tokens by the API's rule; the bench counted 5 321 with the prompt
    expect(modelInputTokensMax([{ width: 1_179, height: 2_843 }], 4_000)).toBe(8_470)
    expect(
      modelInputTokensMax(
        [
          { width: 750, height: 1 },
          { width: 1, height: 1 },
        ],
        0,
      ),
    ).toBe(2)
  })

  it('is that input and the whole output a call may take', () => {
    expect(worstCallMicroUsd(10_000)).toBe(1_000 + RECEIPT_MODEL_OUTPUT_MAX * 0.5)
    expect(worstCallMicroUsd(10_000)).toBeGreaterThan(
      modelCallMicroUsd({ input_tokens: 10_000, output_tokens: 10_534 }),
    )
  })
})

describe('the step of the month’s cap the owner hears of (В-2 «а»)', () => {
  const cap = 200_000_000

  it('is half at half exactly and nine tenths at nine tenths exactly, not a micro-dollar before', () => {
    expect(modelSpendStep(cap / 2 - 1, cap)).toBe(0)
    expect(modelSpendStep(cap / 2, cap)).toBe(50)
    expect(modelSpendStep((cap / 10) * 9 - 1, cap)).toBe(50)
    expect(modelSpendStep((cap / 10) * 9, cap)).toBe(90)
    expect(modelSpendStep(cap * 2, cap)).toBe(90)
  })
})

describe('the month a call is counted in', () => {
  it('is the calendar month in UTC, as the bill is', () => {
    expect(spendMonthOf(new Date('2026-10-31T23:59:59Z'))).toBe('2026-10-01')
    expect(spendMonthOf(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11-01')
    // midnight in Yerevan is still October in UTC
    expect(spendMonthOf(new Date('2026-11-01T01:00:00+04:00'))).toBe('2026-10-01')
  })
})
