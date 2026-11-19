import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { parseRate, yerevanMidnight } from '@molvia/model'
import type { ExchangeView } from '@molvia/model'
import ExchangeComparison from './ExchangeComparison.vue'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'

// The plate an exchange's card carried until MOL-348, now in the sheet of its amendment: these cases
// came over from `ExchangeView.test.ts` as they were.

const cba = (text: string): string => text.replace('{bank}', en.exchange.card_source_cba)

const rate = (value: string, day: string, source: 'personal' | 'official' = 'personal') => ({
  base: 'RUB' as const,
  quote: 'AMD' as const,
  scaled: parseRate(value),
  source,
  asOf: yerevanMidnight(day),
})

function row(patch: Partial<ExchangeView> = {}): ExchangeView {
  return {
    id: '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
    exchangedOn: '2026-09-15',
    given: { minor: 2_000_000n, currency: 'RUB' },
    received: { minor: 9_500_000n, currency: 'AMD' },
    heldBefore: null,
    note: null,
    channel: null,
    givenAccountId: null,
    receivedAccountId: null,
    revision: 1,
    amendedAt: null,
    history: [],
    rate: rate('4.75', '2026-09-15'),
    official: {
      rate: rate('4.3123', '2026-09-15', 'official'),
      provider: 'cba',
      difference: { minor: 875_400n, currency: 'AMD' },
    },
    officialDoubtful: false,
    market: null,
    ...patch,
  }
}

function plate(exchange: ExchangeView) {
  return mount(ExchangeComparison, {
    props: { exchange },
    global: { plugins: [createAppI18n('en')] },
  })
}

const quote = (
  value: string,
  minor: bigint,
  channel: 'bankCash' | 'bankNoncash' | 'exchanger',
  basis: 'bankCash' | 'bankNoncash' | 'banksAll' | 'exchanger' = channel,
) => ({
  channel,
  basis,
  rate: rate(value, '2026-09-15', 'official'),
  difference: { minor, currency: 'AMD' as const },
})

describe('ExchangeComparison: beside the central bank (MOL-40)', () => {
  it('compares with the bank in words — more, less, or nothing to compare with', () => {
    // Whole amounts as they would be typed, as everywhere in «Деньги» (MOL-81, В-1).
    expect(plate(row()).get('.difference').text()).toBe('֏8,754 more than the central bank')
    const less = plate(
      row({
        official: {
          rate: rate('5', '2026-09-10', 'official'),
          provider: 'cba',
          difference: { minor: -500_000n, currency: 'AMD' },
        },
      }),
    )
    expect(less.get('.difference').text()).toBe('֏5,000 less than the central bank')
    // Nothing to compare with is one line in place of three: no bank's rate and no difference.
    const none = plate(row({ official: null }))
    expect(none.get('.missing').text()).toBe(cba(en.exchange.card_no_official))
    expect(none.find('.difference').exists()).toBe(false)
    expect(none.findAll('.line')).toHaveLength(1)
    expect(none.text()).not.toMatch(/commission/i)
  })

  it('says the bank’s rate of that day is in doubt when it jumped with nothing before it (С-5)', () => {
    const view = plate(row({ official: null, officialDoubtful: true }))
    expect(view.get('.missing').text()).toBe(cba(en.exchange.card_doubtful))
  })

  it('у обмена рублей на лари без курса дня называет НБ Грузии, а не ЦБ РА (MOL-110)', () => {
    const lari = {
      received: { minor: 31_200n, currency: 'GEL' as const },
      rate: null,
      official: null,
    }
    expect(plate(row(lari)).get('.missing').text()).toBe(
      'No National Bank of Georgia rate for this day — nothing to compare with',
    )
    expect(
      plate(row({ ...lari, officialDoubtful: true }))
        .get('.missing')
        .text(),
    ).toBe('The National Bank of Georgia rate of that day is in doubt — no comparison')
  })

  it('names an open source when the bank of that day was not the central bank', () => {
    const view = plate(
      row({
        official: {
          rate: rate('4.31', '2026-09-15', 'official'),
          provider: 'cbr',
          difference: { minor: 100n, currency: 'AMD' },
        },
      }),
    )
    const text = view.text()
    // Named instead of the central bank, never beside it (С-6) — in the label and the difference.
    // A name that stands at the head of a line and after «the» alike — no «the the» (adversarial Е).
    expect(view.get('.official .label').text()).toMatch(
      new RegExp(`^${en.exchange.card_source_cbr} on `),
    )
    expect(text).toContain(`than the ${en.exchange.card_source_cbr} rate`)
    expect(text).not.toMatch(/the the/)
    expect(text).not.toMatch(/central bank/i)
  })

  // Near parity the bank's rate falls on the other side of one than the exchange's own; the plate
  // prints it on the exchange's side all the same, not «1.01 $/€» over «1.01 €/$» (adversarial Г).
  it('prints the bank’s rate on the side of the exchange’s own, near parity too', () => {
    const perEuro = (value: string, source: 'personal' | 'official') => ({
      ...rate(value, '2026-09-15', source),
      base: 'EUR' as const,
      quote: 'USD' as const,
    })
    const view = plate(
      row({
        given: { minor: 100_000n, currency: 'USD' },
        received: { minor: 99_500n, currency: 'EUR' },
        rate: perEuro('1.005025', 'personal'),
        official: {
          rate: perEuro('0.995', 'official'),
          provider: 'cba',
          difference: { minor: -1_003n, currency: 'EUR' },
        },
      }),
    )
    expect(view.findAll('.value').map((value) => value.text())).toEqual(['1.01 $/€', '0.995 $/€'])
  })
})

describe('ExchangeComparison: against the market of the day (MOL-137)', () => {
  it('puts the best of the day first, the own channel under it, the central bank quieter last', () => {
    const card = plate(
      row({
        channel: 'bankCash',
        market: {
          best: quote('4.221606', -123_212n, 'bankNoncash'),
          own: quote('4.110180', 99_640n, 'bankCash'),
          exchangersPending: true,
        },
      }),
    )
    const labels = card.findAll('.comparison > .line .label').map((label) => label.text())
    expect(labels).toEqual([
      en.exchange.card_rate,
      'Best rate on Sep 15: Banks, non-cash',
      'Banks, cash on Sep 15',
    ])
    // Against the market: the sign, the word and the tone, each line its own (Ф-30).
    const differences = card.findAll('.comparison > .difference')
    expect(differences.map((line) => line.text())).toEqual([
      '−֏1,232.12 · worse than at banks non-cash',
      '+֏996.40 · better than at banks for cash',
    ])
    expect(differences[0]?.classes()).toContain('bad')
    expect(differences[1]?.classes()).toContain('good')
    expect(card.get('.comparison > .missing').text()).toBe(en.exchange.market.pending)
    // The central bank is still there, a step quieter and with no tone: it is not the market (Р-5, Д-5).
    expect(card.get('.official').classes()).toContain('quiet')
    const official = card.get('.official .difference')
    expect(official.text()).toBe('֏8,754 more than the central bank')
    expect(official.classes()).not.toContain('good')
    expect(official.classes()).not.toContain('bad')
  })

  it('even with the market is said in words and takes no tone', () => {
    const line = plate(
      row({
        market: { best: quote('4.75', 0n, 'exchanger'), own: null, exchangersPending: false },
      }),
    ).get('.comparison > .difference')
    expect(line.text()).toBe('Exactly as at exchange offices')
    expect(line.classes()).not.toContain('good')
    expect(line.classes()).not.toContain('bad')
  })

  it('must not fire: no market — the central bank is the main line, neutral, never toned', () => {
    const card = plate(
      row({
        official: {
          rate: rate('4.80', '2026-09-15', 'official'),
          provider: 'cba',
          difference: { minor: -250_000n, currency: 'AMD' },
        },
      }),
    )
    expect(card.get('.official').classes()).not.toContain('quiet')
    const line = card.get('.official .difference')
    expect(line.text()).toBe('֏2,500 less than the central bank')
    expect(line.classes()).not.toContain('bad')
  })

  it('names the row of all bank clients where it stood in for non-cash (В-2)', () => {
    const view = plate(
      row({
        market: {
          best: quote('4.2095', -10_000n, 'bankNoncash', 'banksAll'),
          own: null,
          exchangersPending: false,
        },
      }),
    )
    expect(view.get('.comparison > .line + .line .label').text()).toBe(
      'Best rate on Sep 15: Banks, all clients',
    )
    expect(view.get('.comparison > .difference').text()).toContain('at banks (all clients)')
    expect(view.find('.comparison > .missing').exists()).toBe(false)
  })

  it('with a market and no bank rate that day, does not say there is nothing to compare with', () => {
    const view = plate(
      row({
        official: null,
        market: {
          best: quote('4.110180', 99_640n, 'bankCash'),
          own: null,
          exchangersPending: false,
        },
      }),
    )
    expect(view.get('.official .missing').text()).toBe(cba(en.exchange.card_no_official_short))
  })

  it('without a market the central bank stands as it did', () => {
    const view = plate(row())
    expect(view.get('.official').classes()).not.toContain('quiet')
  })
})
