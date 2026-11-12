import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { ExchangeLossesView, ExchangeView, ExchangesResponse } from '@molvia/model'
import ExchangeVsMarket from './ExchangeVsMarket.vue'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'

type Bar = NonNullable<ExchangesResponse['bars']>[number]

const dram = (minor: bigint) => ({ minor, currency: 'AMD' as const })
const TODAY = '2026-11-12'

function bar(id: string, day: string, minor: bigint | null, of: Partial<Bar> = {}): Bar {
  return {
    id,
    exchangedOn: day,
    place: 'ВТБ',
    difference: minor === null ? null : dram(minor),
    percent: minor === null ? null : 1475,
    sign: minor === null ? null : minor < 0n ? -1 : minor > 0n ? 1 : 0,
    level: 0,
    ...of,
  }
}

function losses(total: bigint, of: Partial<ExchangeLossesView> = {}): ExchangeLossesView {
  return { total: dram(total), uncounted: 0, groups: [], ...of }
}

function exchange(id: string): ExchangeView {
  return {
    id,
    exchangedOn: '2026-10-03',
    given: { minor: 3_000_000n, currency: 'RUB' },
    received: dram(14_610_000n),
    heldBefore: null,
    note: 'ВТБ',
    channel: null,
    givenAccountId: null,
    receivedAccountId: null,
    revision: 1,
    amendedAt: null,
    history: [],
    rate: null,
    official: null,
    officialDoubtful: false,
    market: null,
  }
}

function mountCard(props: Record<string, unknown>) {
  return mount(ExchangeVsMarket, {
    props: { today: TODAY, ...props },
    global: { plugins: [createAppI18n('en')] },
  })
}

describe('ExchangeVsMarket', () => {
  it('says the total with its tone, its sign and its word; all better — one line for it', () => {
    const card = mountCard({
      losses: losses(3_969_800n),
      bars: [
        bar('a', '2025-12-14', 293_400n, { level: 156 }),
        bar('b', '2026-10-03', 1_877_600n, { level: 1000 }),
      ],
    })
    expect(card.get('.total').classes()).toContain('good')
    expect(card.get('.total').text()).toMatch(/^\+֏39,698/u)
    expect(card.get('.word').text()).toBe(en.exchange.vs_market.word_better)
    expect(card.get('.note').text()).toBe('all 2 beat that day’s market')
  })

  it('counts better, worse and the same apart, and has «down» in the legend only with a worse one', () => {
    const mixed = mountCard({
      losses: losses(-100n),
      bars: [
        bar('a', '2026-03-22', -344_200n, { level: -1000 }),
        bar('b', '2026-07-20', 7_400n, { level: 21 }),
        bar('c', '2026-11-05', 0n),
      ],
    })
    expect(mixed.get('.note').text()).toBe('1 better · 1 worse · 1 the same')
    expect(mixed.get('.word').text()).toBe(en.exchange.vs_market.word_worse)
    expect(mixed.text()).toContain(en.exchange.vs_market.legend_down)

    const better = mountCard({ losses: losses(100n), bars: [bar('a', '2026-03-22', 100n)] })
    expect(better.get('.note').text()).toBe(en.exchange.vs_market.count_one)
    expect(better.text()).not.toContain(en.exchange.vs_market.legend_down)
  })

  it('draws a bar up for more, down for less, and gives the tone only to a difference with the market', () => {
    const card = mountCard({
      losses: losses(0n),
      bars: [
        bar('up', '2026-01-01', 500n, { level: 1000 }),
        bar('down', '2026-02-01', -250n, { level: -500 }),
        bar('even', '2026-03-01', 0n),
        bar('none', '2026-04-01', null),
      ],
    })
    const cells = card.findAll('.cell')
    expect(
      cells.map((cell) => cell.classes().find((c) => ['good', 'bad', 'even', 'none'].includes(c))),
    ).toEqual(['good', 'bad', 'even', 'none'])
    expect(cells[0]?.find('.up .bar').exists()).toBe(true)
    expect(cells[1]?.find('.down .bar').exists()).toBe(true)
    expect(cells[1]?.find('.up .bar').exists()).toBe(false)
    // «Без сравнения» is a frame of its own size, no height of money; its value is «?».
    expect(cells[3]?.get('.bar').attributes('style')).toBeUndefined()
    expect(cells[3]?.get('.value').text()).toBe('?')
  })

  it('chooses the last compared exchange by default, and a tap chooses another', async () => {
    const card = mountCard({
      losses: losses(100n),
      bars: [bar('a', '2026-09-18', 100n), bar('b', '2026-10-01', null)],
      exchanges: [exchange('a'), exchange('b')],
    })
    expect(card.get('[aria-pressed="true"]').attributes('aria-label')).toContain('Sep 18')
    expect(card.get('.plate-amounts').text()).toBe('₽30,000 → ֏146,100')
    await card.findAll('.cell')[1]?.trigger('click')
    expect(card.emitted('update:chosen')).toEqual([['b']])
    await card.setProps({ chosen: 'b' })
    expect(card.get('.plate-word').text()).toBe(en.exchange.vs_market.none_said)
    expect(card.get('.plate-word').classes()).toContain('none')
  })

  it('names each bar for a screen reader: day and place, the difference, the percent and the word', () => {
    const card = mountCard({
      losses: losses(1_877_600n),
      bars: [bar('a', '2026-10-03', 1_877_600n, { level: 1000 })],
    })
    expect(card.get('.cell').attributes('aria-label')).toBe(
      'Oct 3 · ВТБ: +֏18,776: +14.75% · better than the market',
    )
  })

  it('puts «+18.8K» over a bar from ten thousand, the amount whole under it', () => {
    const card = mountCard({
      losses: losses(1_877_600n),
      bars: [bar('a', '2026-10-03', 1_877_600n, { level: 1000 })],
    })
    expect(card.get('.value').text()).toBe('+18.8K')
    expect(card.get('.plate-diff').text()).toBe('+֏18,776')
  })

  it('shows the places as bars only when there is more than one, each with its word unseen', () => {
    const groups = [
      { place: 'ВТБ', count: 1, difference: dram(1_877_600n), percent: 1475, level: 1000 },
      { place: null, count: 3, difference: dram(-848_300n), percent: -232, level: -157 },
    ]
    const card = mountCard({ losses: losses(1_029_300n, { groups }), bars: [] })
    const places = card.findAll('.place')
    expect(places.map((place) => place.get('.place-name').text())).toEqual([
      'ВТБ × 1',
      `${en.exchange.vs_market.no_place} × 3`,
    ])
    expect(places[1]?.get('.fill').classes()).toContain('bad')
    expect(places[1]?.get('.unseen').text()).toBe(en.exchange.vs_market.worse)
    const one = mountCard({ losses: losses(0n, { groups: groups.slice(0, 1) }), bars: [] })
    expect(one.find('.places').exists()).toBe(false)
  })

  it('says how many were not compared', () => {
    const card = mountCard({ losses: losses(100n, { uncounted: 2 }), bars: [] })
    expect(card.text()).toContain('? — 2 exchanges not compared: no market or rate for those days')
  })

  it('with incomes alone and no exchange is the quiet note', () => {
    const card = mountCard({ losses: null, bars: [] })
    expect(card.get('.quiet').text()).toBe(en.exchange.vs_market.incomes_only)
    expect(card.find('.plot').exists()).toBe(false)
  })
})
