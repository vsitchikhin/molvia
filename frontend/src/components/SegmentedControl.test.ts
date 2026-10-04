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

  // The widths are the browser's to give: the e2e of «Тема» holds one line at 320 px (MOL-111).
  it('takes its widths from the words only when asked to', () => {
    const even = render()
    expect(even.classes()).not.toContain('fit')
    const fit = mount(SegmentedControl, {
      props: { modelValue: 'l', options: UNITS, legend: 'Unit', fit: true },
    })
    expect(fit.classes()).toContain('fit')
  })

  describe('inactive (Ф-6, MOL-174)', () => {
    function inactive(attachTo?: HTMLElement) {
      return mount(SegmentedControl, {
        props: { modelValue: 'l', options: UNITS, legend: 'Unit', inactive: true },
        attachTo,
      })
    }
    const checked = (view: ReturnType<typeof inactive>) =>
      view.findAll('input').map((input) => (input.element as HTMLInputElement).checked)

    it('keeps every radio in the focus order, said to be unavailable', () => {
      const view = inactive()
      expect(view.classes()).toContain('inactive')
      expect(view.attributes('disabled')).toBeUndefined()
      expect(view.findAll('input').map((input) => input.attributes('aria-disabled'))).toEqual([
        'true',
        'true',
        'true',
      ])
    })

    it('must not fire: a tap moves no choice and reports none', () => {
      const host = document.body.appendChild(document.createElement('div'))
      const view = inactive(host)
      const tap = new MouseEvent('click', { bubbles: true, cancelable: true })
      view.findAll('input')[0]?.element.dispatchEvent(tap)
      expect(tap.defaultPrevented).toBe(true)
      expect(view.emitted('update:modelValue')).toBeUndefined()
      view.unmount()
      host.remove()
    })

    it('must not fire: an arrow moves no choice', async () => {
      const view = inactive()
      const arrow = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
      view.findAll('input')[1]?.element.dispatchEvent(arrow)
      expect(arrow.defaultPrevented).toBe(true)
      // An engine that changed it anyway: the owner's choice is put back, and nothing is said.
      await view.findAll('input')[2]?.setValue(true)
      expect(checked(view)).toEqual([false, true, false])
      expect(view.emitted('update:modelValue')).toBeUndefined()
    })

    it('answers again once it is not inactive', async () => {
      const view = inactive()
      await view.setProps({ inactive: false })
      expect(view.find('input').attributes('aria-disabled')).toBeUndefined()
      await view.findAll('input')[0]?.setValue(true)
      expect(view.emitted('update:modelValue')).toEqual([['kg']])
    })

    it('draws a native disabled the same, out of the focus order', () => {
      const view = mount(SegmentedControl, {
        props: { modelValue: 'l', options: UNITS, legend: 'Unit', disabled: true },
      })
      expect(view.classes()).toContain('inactive')
      expect(view.attributes('disabled')).toBeDefined()
      expect(view.find('input').attributes('aria-disabled')).toBeUndefined()
    })
  })

  it('reads out the spoken name, not the sign', () => {
    const view = render('amd', [
      { value: 'amd', label: '֏', spoken: 'Drams' },
      { value: 'usd', label: '$', spoken: 'Dollars' },
    ])
    expect(view.findAll('[aria-hidden="true"]').map((sign) => sign.text())).toEqual(['֏', '$'])
    expect(view.findAll('.spoken').map((name) => name.text())).toEqual(['Drams', 'Dollars'])
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
