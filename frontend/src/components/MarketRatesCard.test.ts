import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { parseRate, yerevanMidnight } from '@molvia/model'
import type { MarketToday } from '@molvia/model'
import MarketRatesCard from './MarketRatesCard.vue'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'

const TODAY = '2026-11-12'

function rate(currency: 'RUB' | 'USD' | 'EUR', value: string, day = '2026-11-11') {
  return {
    base: currency,
    quote: 'AMD' as const,
    scaled: parseRate(value),
    source: 'official' as const,
    asOf: yerevanMidnight(day),
  }
}

function rouble(of: Partial<MarketToday> = {}): MarketToday {
  return {
    currency: 'RUB',
    official: rate('RUB', '4.34'),
    quotes: [
      {
        channel: 'bankCash',
        basis: 'bankCash',
        buys: rate('RUB', '4.13'),
        sells: rate('RUB', '4.37'),
        bestBuys: false,
        bestSells: false,
      },
      {
        channel: 'bankNoncash',
        basis: 'bankNoncash',
        buys: rate('RUB', '4.24'),
        sells: rate('RUB', '4.34'),
        bestBuys: true,
        bestSells: false,
      },
      {
        channel: 'exchanger',
        basis: 'exchanger',
        buys: rate('RUB', '4.02', '2026-10-31'),
        sells: rate('RUB', '4.09', '2026-10-31'),
        bestBuys: false,
        bestSells: true,
      },
    ],
    track: {
      official: 914,
      sell: [
        { channel: 'bankNoncash', at: 629 },
        { channel: 'bankCash', at: 314 },
        { channel: 'exchanger', at: 0 },
      ],
      buy: [
        { channel: 'exchanger', at: 200 },
        { channel: 'bankNoncash', at: 914 },
        { channel: 'bankCash', at: 1000 },
      ],
    },
    ...of,
  }
}

const dollar: MarketToday = {
  currency: 'USD',
  official: rate('USD', '387.5'),
  quotes: [
    {
      channel: 'bankCash',
      basis: 'bankCash',
      buys: rate('USD', '385'),
      sells: rate('USD', '390'),
      bestBuys: true,
      bestSells: true,
    },
  ],
}

function card(rows: MarketToday[], first: 'RUB' | 'USD' | null = null) {
  return mount(MarketRatesCard, {
    props: { rows, first, today: TODAY },
    global: { plugins: [createAppI18n('en')] },
  })
}

const namesOf = (list: ReturnType<ReturnType<typeof card>['findAll']>[number] | undefined) =>
  list?.findAll('[role="rowheader"]').map((one) => one.text().split(' ').slice(0, 2).join(' '))

describe('MarketRatesCard (MOL-137, MOL-348)', () => {
  it('lists where to sell and where to buy in the server’s order, the best first, the figure always seen', () => {
    const view = card([rouble()])
    const [sell, buy] = view.findAll('[role="table"]')
    expect(sell?.attributes('aria-label')).toBe('Sell roubles')
    expect(buy?.attributes('aria-label')).toBe('Buy roubles')
    expect(namesOf(sell)).toEqual(['Bank, non-cash', 'Bank, cash', 'Exchange offices'])
    expect(namesOf(buy)).toEqual(['Exchange offices', 'Bank, non-cash', 'Bank, cash'])
    expect(sell?.findAll('[role="cell"]').map((one) => one.text())).toEqual([
      `4.24 ֏/₽${en.exchange.market.best_mark}`,
      '4.13 ֏/₽',
      '4.02 ֏/₽',
    ])
    // The best by its place, the star and the weight — no colour; said to a screen reader.
    expect(sell?.findAll('.line').map((line) => line.classes().includes('best'))).toEqual([
      true,
      false,
      false,
    ])
    // A line's own day: the exchange offices come a week or two late.
    expect(sell?.findAll('.day').map((day) => day.text())).toEqual(['Nov 11', 'Nov 11', 'Oct 31'])
  })

  it('places each dot and the central bank’s dashed line where the server says, with no tone', () => {
    const [sell] = card([rouble()]).findAll('[role="table"]')
    const first = sell?.get('.line')
    const spots = first?.findAll('.spot') ?? []
    // The central bank first, then the line's own dot: the room before each and after it.
    const grows = spots.map((spot) =>
      spot.findAll(':scope > span:not(.mark)').map((part) => part.attributes('style')),
    )
    expect(grows).toEqual([
      ['flex-grow: 914;', 'flex-grow: 86;'],
      ['flex-grow: 629;', 'flex-grow: 371;'],
    ])
    expect(first?.find('.good, .bad').exists()).toBe(false)
  })

  it('shows one currency at a time — the latest exchange’s first — and a tap shows another', async () => {
    const view = card([rouble(), dollar], 'USD')
    expect(view.get('[role="table"]').attributes('aria-label')).toBe('Sell dollars')
    const roubles = view
      .findAll('input[type="radio"]')
      .find((radio) => radio.attributes('value') === 'RUB')
    await roubles?.setValue(true)
    expect(view.get('[role="table"]').attributes('aria-label')).toBe('Sell roubles')
  })

  it('says why there is no dashed line, and why no best is starred', () => {
    const noBank = card([rouble({ official: null, track: { official: null, sell: [], buy: [] } })])
    expect(noBank.find('.cb').exists()).toBe(false)
    expect(noBank.get('.legend').text()).toBe(
      '֏ for 1 ₽ · ★ the best for you · no central bank rate today',
    )

    const old = rouble()
    const stale = card([
      {
        ...old,
        quotes: old.quotes.map((quote) => ({ ...quote, bestBuys: false, bestSells: false })),
      },
    ])
    expect(stale.find('.star').exists()).toBe(false)
    expect(stale.get('.legend').text()).toBe('֏ for 1 ₽ · rates over a week old — no best marked')
  })

  it('draws nothing for a currency the bank said nothing of', () => {
    expect(
      card([{ currency: 'EUR', official: null, quotes: [] }])
        .find('.market')
        .exists(),
    ).toBe(false)
  })
})
