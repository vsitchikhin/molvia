import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BarChart from './BarChart.vue'
import type { ChartBar } from './BarChart.vue'
import RateLine from './RateLine.vue'

const bars: ChartBar[] = ['2026-07', '2026-08', '2026-09'].map((key, index) => ({
  key,
  label: ['июл', 'авг', 'сен'][index] ?? '',
  spoken: `${key}, ${String(index)}`,
  level: [500, 1000, 250][index] ?? 0,
  second: [1000, 900, 0][index] ?? 0,
}))

/** A chart 300 px wide from x = 0: a column of 100 px a bar. */
function chart(props: Record<string, unknown> = {}) {
  const view = mount(BarChart, {
    props: { bars, modelValue: 2, legend: 'Расходы', ...props },
    slots: { default: '<p class="shown">показание</p>' },
  })
  const area = view.find('.area').element
  area.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect
  return view
}

function pointer(type: string, x: number, init: PointerEventInit = {}) {
  return new PointerEvent(type, { clientX: x, bubbles: true, ...init })
}

describe('BarChart (MOL-74)', () => {
  it('draws each bar at its level of the tallest, and the reading above', () => {
    const view = chart()
    const fills = view.findAll('.fill').map((fill) => fill.attributes('style'))
    expect(fills).toEqual(['height: 50%;', 'height: 100%;', 'height: 25%;'])
    expect(view.find('.reading .shown').exists()).toBe(true)
  })

  it('reads every bar by its words, the chosen one checked', () => {
    const view = chart()
    const radios = view.findAll('input[type="radio"]')
    expect(radios.map((radio) => radio.attributes('aria-label'))).toEqual([
      '2026-07, 0',
      '2026-08, 1',
      '2026-09, 2',
    ])
    expect((radios[2]?.element as HTMLInputElement).checked).toBe(true)
  })

  it('chooses the bar under the finger anywhere on the chart, and follows the finger', () => {
    const view = chart()
    view.find('.area').element.dispatchEvent(pointer('pointerdown', 150, { pointerType: 'touch' }))
    expect(view.emitted('update:modelValue')?.at(-1)).toEqual([1])
    view
      .find('.area')
      .element.dispatchEvent(pointer('pointermove', 20, { pointerType: 'touch', buttons: 1 }))
    expect(view.emitted('update:modelValue')?.at(-1)).toEqual([0])
    // Past the edges: the first or the last, never outside.
    view.find('.area').element.dispatchEvent(pointer('pointerdown', 999, { pointerType: 'touch' }))
    expect(view.emitted('update:modelValue')).toHaveLength(2)
  })

  it('must not fire: a mouse passing over chooses nothing', () => {
    const view = chart()
    view
      .find('.area')
      .element.dispatchEvent(pointer('pointermove', 20, { pointerType: 'mouse', buttons: 0 }))
    expect(view.emitted('update:modelValue')).toBeUndefined()
  })

  it('a radio chosen from the keyboard chooses its bar', async () => {
    const view = chart()
    await view.findAll('input[type="radio"]')[0]?.setValue(true)
    expect(view.emitted('update:modelValue')?.at(-1)).toEqual([0])
  })

  it('pairs an outline with a fill, and draws the average as a line at its level', () => {
    const view = chart({ paired: true, average: 600 })
    expect(view.findAll('.outline').map((one) => one.attributes('style'))).toEqual([
      'height: 100%;',
      'height: 90%;',
      'height: 0%;',
    ])
    expect(view.find('.average').attributes('style')).toBe('height: 60%;')
  })

  it('stands twelve bars closer than six', () => {
    const twelve = Array.from({ length: 12 }, (_, index) => ({
      ...bars[0],
      key: String(index),
      label: String(index),
      spoken: String(index),
      level: 0,
    }))
    expect(chart().find('.chart').classes()).not.toContain('many')
    expect(chart({ bars: twelve }).find('.chart').classes()).toContain('many')
  })
})

describe('RateLine (MOL-74, Р-14)', () => {
  const points = [
    { level: 0, spoken: 'a' },
    { level: 500, spoken: 'b' },
    { level: null, spoken: 'c' },
    { level: 1000, spoken: 'd' },
  ]

  function line(modelValue = 3) {
    const view = mount(RateLine, {
      props: {
        points,
        marks: [{ week: 1, level: 200 }],
        modelValue,
        legend: 'Курс',
        first: 'x',
        last: 'y',
      },
    })
    view.find('.area').element.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect
    return view
  }

  it('breaks the line where there was no rate: a stretch and a lone dot, never a zero', () => {
    const view = line()
    expect(view.findAll('polyline')).toHaveLength(1)
    expect(view.find('polyline').attributes('points')).toBe('0,900 333.3333333333333,500')
    // The lone week after the gap, and the chosen one on it.
    expect(view.findAll('line.dot')).toHaveLength(2)
    expect(view.findAll('line.mark')).toHaveLength(1)
  })

  it('chooses the nearest week by finger and by the range, which says the week', async () => {
    const view = line()
    view
      .find('.area')
      .element.dispatchEvent(new PointerEvent('pointerdown', { clientX: 90, pointerType: 'touch' }))
    expect(view.emitted('update:modelValue')?.at(-1)).toEqual([1])
    const range = view.find('input[type="range"]')
    expect(range.attributes('aria-valuetext')).toBe('d')
    await range.setValue('2')
    expect(view.emitted('update:modelValue')?.at(-1)).toEqual([2])
  })
})
