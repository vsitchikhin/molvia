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

  it('opens the charts, on twelve months for a month older than six (adversarial А of MOL-74)', () => {
    expect(card('2026-04').find('a').attributes('href')).toBe('/money/charts')
    expect(card('2026-03').find('a').attributes('href')).toBe('/money/charts?period=12')
  })
})
