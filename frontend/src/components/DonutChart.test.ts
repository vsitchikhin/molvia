import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { parseMoney } from '@molvia/model'
import type { MoneyChartMonthView } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import DonutChart from './DonutChart.vue'

const A = 'ffffffff-0000-4000-8000-00000000000a'
const B = 'ffffffff-0000-4000-8000-00000000000b'
const amd = (text: string) => parseMoney(text, 'AMD')

/** Three quarters and a quarter, the ring 200 px square from the corner of the window. */
function donut(modelValue: string | null = null, patch: Partial<MoneyChartMonthView> = {}) {
  const charts: MoneyChartMonthView = {
    month: '2026-09',
    running: true,
    spendCurrency: 'AMD',
    incomeCurrency: 'AMD',
    spent: amd('400'),
    spentIncome: amd('400'),
    uncounted: [],
    slices: [
      { categoryId: A, amount: amd('300'), income: amd('300'), count: 1, level: 750, members: [] },
      { categoryId: B, amount: amd('100'), income: amd('100'), count: 1, level: 250, members: [] },
    ],
    usual: null,
    comparedFrom: '2026-12',
    closed: [],
    firstMonth: '2026-09',
    deviations: [],
    pace: { days: [], usual: null },
    categories: [
      { id: A, preset: 'rent', name: null, colour: null, archived: false },
      { id: B, preset: null, name: 'Такси', colour: 2, archived: false },
    ],
    ...patch,
  }
  const view = mount(DonutChart, {
    props: {
      charts,
      label: 'Сентябрь · идёт',
      nameOf: (one) => one.name ?? one.preset ?? '',
      modelValue,
    },
    global: { plugins: [createAppI18n('ru')] },
  })
  const box = view.find('.ring-box').element
  box.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 }) as DOMRect
  return view
}

describe('DonutChart: what no rate counted (MOL-184)', () => {
  const rub = (text: string) => parseMoney(text, 'RUB')

  it('nothing counted: «0 ֏» with no «≈ 0 ₽» under it, and what had no rate as written (Б1, Б2)', () => {
    const view = donut(null, {
      incomeCurrency: 'RUB',
      spent: amd('0'),
      spentIncome: rub('0'),
      uncounted: [parseMoney('5.50', 'EUR'), parseMoney('0.40', 'USD')],
      slices: [],
    })
    expect(view.find('.center-figure').text().replace(/\s/g, ' ')).toBe('0 ֏')
    expect(view.find('.center-sub').exists()).toBe(false)
    // Never «6 €» or «0 $»: there is no «≈» before them.
    expect(view.find('.note').text().replace(/\s/g, ' ')).toBe('не посчитано: 5,50 €, 0,40 $')
  })

  it('must not fire: something counted keeps its «≈» in the other currency', () => {
    const view = donut(null, { incomeCurrency: 'RUB', spentIncome: rub('86.58') })
    expect(view.find('.center-sub').text().replace(/\s/g, ' ')).toBe('≈ 87 ₽')
  })
})

describe('DonutChart (MOL-158)', () => {
  it('says the words given and the total in the centre, with no rate where one currency is all', () => {
    const view = donut()
    expect(view.find('.center-label').text()).toBe('Сентябрь · идёт')
    expect(view.find('.center-figure').text().replace(/\s/g, ' ')).toBe('400 ֏')
    expect(view.find('.center-sub').exists()).toBe(false)
    expect(view.findAll('.legend .row')).toHaveLength(2)
  })

  it('the arrows choose another row; a tap on the chosen one lets it go', async () => {
    const view = donut(A)
    const [first, second] = view.findAll('.legend input')
    await second?.trigger('change')
    expect(view.emitted('update:modelValue')?.at(-1)).toEqual([B])
    await first?.trigger('click')
    expect(view.emitted('update:modelValue')?.at(-1)).toEqual([null])
  })

  it('a tap on the ring chooses the sector under it, and the hole chooses nothing', async () => {
    const view = donut()
    const box = view.find('.ring-box')
    // Three o'clock is a quarter of the way round: the first sector, three quarters long.
    await box.trigger('click', { clientX: 195, clientY: 100 })
    expect(view.emitted('update:modelValue')?.at(-1)).toEqual([A])
    // Ten o'clock is past three quarters: the second.
    await box.trigger('click', { clientX: 20, clientY: 60 })
    expect(view.emitted('update:modelValue')?.at(-1)).toEqual([B])
    await box.trigger('click', { clientX: 100, clientY: 100 })
    expect(view.emitted('update:modelValue')).toHaveLength(2)
  })

  it('must not fire: a tap in the hole or past the ring chooses nothing (adversarial Б)', async () => {
    const view = donut()
    const box = view.find('.ring-box')
    // The ring of 200 px runs from 76 to 100 px off the centre: 70 px is the hole, by the figure.
    await box.trigger('click', { clientX: 170, clientY: 100 })
    // A corner of the box is past the ring.
    await box.trigger('click', { clientX: 2, clientY: 2 })
    expect(view.emitted('update:modelValue')).toBeUndefined()
    // The chosen sector is drawn wider inwards, and a tap on that band lets it go.
    const chosen = donut(A)
    await chosen.find('.ring-box').trigger('click', { clientX: 170, clientY: 100 })
    expect(chosen.emitted('update:modelValue')?.at(-1)).toEqual([null])
  })

  it('draws every sector in a token, never a literal colour', () => {
    const fills = donut()
      .findAll('.ring path')
      .map((path) => path.attributes('fill'))
    expect(fills.every((fill) => fill?.startsWith('var(--'))).toBe(true)
  })
})
