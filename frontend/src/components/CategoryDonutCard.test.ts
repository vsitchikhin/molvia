import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseMoney } from '@molvia/model'
import type { MoneyMonthView } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import CategoryDonutCard from './CategoryDonutCard.vue'

const TELECOM = 'ffffffff-0000-4000-8000-000000000001'
const GROCERIES = 'ffffffff-0000-4000-8000-000000000002'
const OTHER = 'ffffffff-0000-4000-8000-000000000003'
const HOME = 'ffffffff-0000-4000-8000-000000000004'
const OWN = 'ffffffff-0000-4000-8000-000000000005'

const amd = (value: string) => parseMoney(value, 'AMD')
const NAMES: Record<string, string> = {
  [TELECOM]: 'Связь и интернет',
  [GROCERIES]: 'Продукты',
  [OTHER]: 'Прочее',
  [HOME]: 'Дом и быт',
  [OWN]: 'Такси',
}

/** September of the handoff (MOL-157): six sectors and «Остальные» of three, as the server lays them. */
const SEPTEMBER: MoneyMonthView['slices'] = [
  { categoryId: TELECOM, amount: amd('68076'), count: 1, level: 248 },
  { categoryId: GROCERIES, amount: amd('60318'), count: 1, level: 220 },
  { categoryId: OTHER, amount: amd('51294'), count: 1, level: 187 },
  { categoryId: HOME, amount: amd('43728'), count: 1, level: 159 },
  { categoryId: OWN, amount: amd('38307'), count: 1, level: 140 },
  { categoryId: null, amount: amd('12800'), count: 3, level: 46 },
]

function month(value: string, slices = SEPTEMBER): MoneyMonthView {
  return {
    month: value,
    spent: amd('274523'),
    slices,
    categories: [
      { id: TELECOM, preset: 'telecom', name: null, colour: null, archived: false },
      { id: GROCERIES, preset: 'groceries', name: null, colour: null, archived: false },
      { id: OTHER, preset: 'other', name: null, colour: null, archived: false },
      { id: HOME, preset: 'home', name: null, colour: null, archived: false },
      { id: OWN, preset: null, name: 'Такси', colour: 3, archived: false },
    ],
  } as MoneyMonthView
}

function card(value: string, slices = SEPTEMBER) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  return mount(CategoryDonutCard, {
    props: { month: month(value, slices), nameOf: (category) => NAMES[category.id] ?? '' },
    global: { plugins: [router, createAppI18n('ru')] },
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-27T08:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('CategoryDonutCard — «Куда ушли» на «Деньгах» (MOL-156)', () => {
  it('names the three largest with their share and sum, and counts the rest', () => {
    const wrapper = card('2026-09')
    const rows = wrapper.findAll('.sector')
    expect(rows.map((row) => row.find('.sector-name').text())).toEqual([
      'Связь и интернет',
      'Продукты',
      'Прочее',
    ])
    expect(rows[0]?.find('.sector-share').text()).toMatch(/^25\s%$/)
    expect(rows[0]?.find('.sector-amount').text()).toMatch(/68\s076\s֏/)
    expect(wrapper.find('.rest').text()).toBe('Ещё 3 сектора — в «Графиках»')
  })

  it('draws a sector for each, coloured by tokens only, «Остальные» the strong border', () => {
    const fills = card('2026-09')
      .findAll('.ring path')
      .map((path) => path.attributes('fill'))
    expect(fills).toEqual([
      'var(--cat-telecom)',
      'var(--cat-groceries)',
      'var(--cat-other)',
      'var(--cat-home)',
      'var(--cat-own-3)',
      'var(--border-strong)',
    ])
  })

  it('leaves out a sector of no level, and has no «Ещё» for three or fewer', () => {
    const wrapper = card('2026-09', [
      { categoryId: TELECOM, amount: amd('1000000'), count: 1, level: 1000 },
      { categoryId: GROCERIES, amount: amd('1'), count: 1, level: 0 },
    ])
    expect(wrapper.findAll('.ring path')).toHaveLength(1)
    expect(wrapper.findAll('.sector')).toHaveLength(2)
    expect(wrapper.findAll('.sector')[1]?.find('.sector-share').text()).toBe('<1 %')
    expect(wrapper.find('.rest').exists()).toBe(false)
  })

  it('is one link, read as the three it names', () => {
    const link = card('2026-09').find('a')
    // Intl keeps the percent sign on its number with a space that does not break.
    expect(link.attributes('aria-label')?.replace(/\s/g, ' ')).toBe(
      'Куда ушли: Связь и интернет 25 %, Продукты 22 %, Прочее 19 %. Открыть графики',
    )
    expect(card('2026-09').findAll('a')).toHaveLength(1)
  })

  it('opens the charts on the largest category of the ring, twelve months for an older month', () => {
    // The category seen first, not the period's largest (review 3, owner's choice «а»).
    expect(card('2026-04').find('a').attributes('href')).toBe(`/money/charts?category=${TELECOM}`)
    expect(card('2026-03').find('a').attributes('href')).toBe(
      `/money/charts?period=12&category=${TELECOM}`,
    )
  })

  it('counts past the three only the sectors the ring draws (adversarial Б)', () => {
    const slices = (level: number): MoneyMonthView['slices'] => [
      { categoryId: TELECOM, amount: amd('250000'), count: 1, level: 735 },
      { categoryId: GROCERIES, amount: amd('60000'), count: 1, level: 177 },
      { categoryId: OTHER, amount: amd('30000'), count: 1, level: 88 - level },
      { categoryId: HOME, amount: amd('100'), count: 1, level },
    ]
    expect(card('2026-09', slices(0)).find('.rest').exists()).toBe(false)
    expect(card('2026-09', slices(1)).find('.rest').text()).toBe('Ещё 1 сектор — в «Графиках»')
  })

  it('names no category the month does not name, but keeps its sector so the ring closes (review 7)', () => {
    const wrapper = card('2026-09', [
      { categoryId: TELECOM, amount: amd('3000'), count: 1, level: 600 },
      {
        categoryId: 'ffffffff-0000-4000-8000-0000000000ff',
        amount: amd('2000'),
        count: 1,
        level: 400,
      },
    ])
    expect(wrapper.findAll('.sector-name').map((name) => name.text())).toEqual(['Связь и интернет'])
    expect(wrapper.findAll('.ring path').map((path) => path.attributes('fill'))).toEqual([
      'var(--cat-telecom)',
      'var(--border)',
    ])
  })

  it('says why there is no ring when the month has categories and no sectors (round 2, Е)', () => {
    // A month kept before the ring, or an answer of a server older than it: the phone adds nothing up.
    const kept = {
      ...month('2026-09', []),
      byCategory: [{ categoryId: TELECOM, amount: amd('3000') }],
      uncounted: [],
    } as MoneyMonthView
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(CategoryDonutCard, {
      props: { month: kept, nameOf: () => '' },
      global: { plugins: [router, createAppI18n('ru')] },
    })
    expect(wrapper.find('.ring').exists()).toBe(false)
    expect(wrapper.find('.rest').text()).toBe('Доли появятся, когда месяц обновится')
    expect(wrapper.find('a').attributes('href')).toBe('/money/charts')
  })

  it('says why there is no ring when nothing spent was counted by a rate (round 2, Ж)', () => {
    const coffee = {
      ...month('2026-09', []),
      byCategory: [],
      uncounted: [parseMoney('11', 'USD')],
    } as MoneyMonthView
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(CategoryDonutCard, {
      props: { month: coffee, nameOf: () => '' },
      global: { plugins: [router, createAppI18n('ru')] },
    })
    expect(wrapper.find('.rest').text()).toBe('Доли появятся, когда у трат будет курс')
  })

  it('stays a way into «Графики» on an empty month, with no ring (handoff 01, adversarial Г)', () => {
    const empty = { ...month('2026-09', []), byCategory: [], uncounted: [], days: [], remaining: 0 }
    const router = createRouter({ history: createMemoryHistory(), routes })
    const wrapper = mount(CategoryDonutCard, {
      props: { month: empty, nameOf: () => '' },
      global: { plugins: [router, createAppI18n('ru')] },
    })
    expect(wrapper.find('a').attributes('href')).toBe('/money/charts')
    expect(wrapper.find('.ring').exists()).toBe(false)
    // «В этом месяце трат нет» is the journal's to say, once, while the journal is on «Деньги».
    expect(wrapper.find('.rest').exists()).toBe(false)
  })
})
