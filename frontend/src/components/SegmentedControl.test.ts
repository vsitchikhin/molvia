import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import type { Segment } from '@/components/SegmentedControl.vue'

const UNITS: Segment[] = [
  { value: 'kg', label: 'kg' },
  { value: 'l', label: 'l' },
  { value: 'piece', label: 'pc' },
]

function render(modelValue = 'l', options = UNITS, hideLegend = false) {
  return mount(SegmentedControl, { props: { modelValue, options, legend: 'Unit', hideLegend } })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SegmentedControl', () => {
  it('is a group of radio buttons named by its legend', () => {
    const view = render()
    expect(view.element.tagName).toBe('FIELDSET')
    expect(view.get('legend').text()).toBe('Unit')
    expect(view.findAll('input[type="radio"]')).toHaveLength(3)
  })

  it('marks the chosen segment, and only it', () => {
    const view = render('l')
    const checked = view
      .findAll('input')
      .map((input) => (input.element as HTMLInputElement).checked)
    expect(checked).toEqual([false, true, false])
    expect(view.findAll('.on').map((segment) => segment.text())).toEqual(['l'])
  })

  it('reports a new choice', async () => {
    const view = render('l')
    await view.findAll('input')[0]?.setValue(true)
    expect(view.emitted('update:modelValue')).toEqual([['kg']])
  })

  // One group per control: two segmented controls on a screen must not steal each other's choice.
  it('keeps its radios in one group of their own', () => {
    const view = mount(
      defineComponent(() => () => [
        h(SegmentedControl, { modelValue: 'l', options: UNITS, legend: 'Unit' }),
        h(SegmentedControl, { modelValue: 'l', options: UNITS, legend: 'Rate' }),
      ]),
    )
    const [first, second] = view
      .findAll('fieldset')
      .map((group) => group.findAll('input').map((input) => input.attributes('name')))
    expect(new Set(first).size).toBe(1)
    expect(first?.[0]).toBeTruthy()
    expect(second?.[0]).not.toBe(first?.[0])
  })

  it('hides the legend from the eye but keeps it for a screen reader', () => {
    const legend = render('l', UNITS, true).get('legend')
    expect(legend.classes()).toContain('hidden')
    expect(legend.text()).toBe('Unit')
  })

  it('does not warn at four segments', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render('kg', [...UNITS, { value: 'g', label: 'g' }])
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns at five: that is a <select>', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render('kg', [...UNITS, { value: 'g', label: 'g' }, { value: 'ml', label: 'ml' }])
    expect(warn).toHaveBeenCalledOnce()
  })
})
