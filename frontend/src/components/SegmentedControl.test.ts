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
        ...(attachTo ? { attachTo } : {}),
      })
    }
    const checked = (view: ReturnType<typeof inactive>) =>
      view.findAll('input').map((input) => (input.element as HTMLInputElement).checked)

    it('marks every radio unavailable without taking any out of reach', () => {
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

    // Adversarial А2: the arrow takes the focus round every option, so each is heard, and checks none.
    it('walks the focus over every radio by the arrows, choosing none', () => {
      const host = document.body.appendChild(document.createElement('div'))
      const view = inactive(host)
      const radios = view.findAll('input').map((input) => input.element as HTMLInputElement)
      const press = (key: string) => {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
        document.activeElement?.dispatchEvent(event)
        return event
      }
      radios[1]?.focus()
      expect(press('ArrowRight').defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(radios[2])
      press('ArrowDown')
      expect(document.activeElement).toBe(radios[0])
      press('ArrowLeft')
      press('ArrowUp')
      expect(document.activeElement).toBe(radios[1])
      expect(checked(view)).toEqual([false, true, false])
      view.unmount()
      host.remove()
    })

    // Р2-А3: an arrow with a modifier is the browser's (Alt+← is «back») — the live group lets it by.
    it('must not fire: an arrow with Alt, Ctrl or Meta is left to the browser', () => {
      const host = document.body.appendChild(document.createElement('div'))
      const view = inactive(host)
      const radios = view.findAll('input').map((input) => input.element as HTMLInputElement)
      radios[1]?.focus()
      for (const modifier of ['altKey', 'ctrlKey', 'metaKey']) {
        const event = new KeyboardEvent('keydown', {
          key: 'ArrowRight',
          [modifier]: true,
          bubbles: true,
          cancelable: true,
        })
        radios[1]?.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
        expect(document.activeElement).toBe(radios[1])
      }
      view.unmount()
      host.remove()
    })

    it('must not fire: a change that got past it anyway is put back, and nothing is said', async () => {
      const view = inactive()
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

  // MOL-321, owner's В-1 «а»: a row its words do not fit stands its segments one under another. happy-dom
  // lays nothing out, so the row's widths are given: wider than itself unless stacked.
  describe('a row its words do not fit (MOL-321)', () => {
    let rowWidth = 100
    let resized: (() => void) | null = null
    const box = 100

    function laidOut(): void {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) {
          return this.classList.contains('track') ? box : 0
        },
      })
      Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
        configurable: true,
        get(this: HTMLElement) {
          if (!this.classList.contains('track')) return 0
          return this.classList.contains('stacked') ? box : rowWidth
        },
      })
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback: () => void) {
            resized = callback
          }
          observe(): void {
            // The test calls `resized` itself, as the browser would on a new size.
          }
          disconnect(): void {
            resized = null
          }
        },
      )
      vi.stubGlobal('requestAnimationFrame', (step: () => void) => {
        step()
        return 1
      })
    }

    afterEach(() => {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth')
      vi.unstubAllGlobals()
      resized = null
    })

    // Measured as it mounts; the class comes in the render after it, a microtask, before any paint.
    it('stands one under another when the row is wider than its place, from the first paint', async () => {
      laidOut()
      rowWidth = 220
      const view = render()
      await view.vm.$nextTick()
      expect(view.get('.track').classes()).toContain('stacked')
    })

    it('must not fire: a row that fits stays a row, at exactly its width too', async () => {
      laidOut()
      rowWidth = box
      const view = render()
      await view.vm.$nextTick()
      expect(view.get('.track').classes()).not.toContain('stacked')
    })

    it('goes back to a row once the words fit again, measured as a row', async () => {
      laidOut()
      rowWidth = 220
      const view = render()
      await view.vm.$nextTick()
      expect(view.get('.track').classes()).toContain('stacked')
      // Still too wide: measured stacked, as it stands, it would read as fitting and flip back.
      resized?.()
      await view.vm.$nextTick()
      expect(view.get('.track').classes()).toContain('stacked')
      rowWidth = box - 1
      resized?.()
      await view.vm.$nextTick()
      expect(view.get('.track').classes()).not.toContain('stacked')
      rowWidth = box + 1
      resized?.()
      await view.vm.$nextTick()
      expect(view.get('.track').classes()).toContain('stacked')
    })

    // A row, its sheet shut: a box of no width holds any word, so read, it would stand one under another.
    it('must not fire: a row not laid out — a shut sheet — keeps its last measure', async () => {
      laidOut()
      rowWidth = box
      const view = render()
      await view.vm.$nextTick()
      expect(view.get('.track').classes()).not.toContain('stacked')
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get: () => 0,
      })
      resized?.()
      await view.vm.$nextTick()
      expect(view.get('.track').classes()).not.toContain('stacked')
    })

    it('measures again when its words change', async () => {
      laidOut()
      rowWidth = box
      const view = render()
      rowWidth = 220
      await view.setProps({ options: [...UNITS.slice(0, 2), { value: 'piece', label: 'Штуки' }] })
      await view.vm.$nextTick()
      await view.vm.$nextTick()
      expect(view.get('.track').classes()).toContain('stacked')
    })

    it('keeps the radios one group and the chosen fill when stacked', async () => {
      laidOut()
      rowWidth = 220
      const view = render('l')
      await view.vm.$nextTick()
      expect(view.get('.track').classes()).toContain('stacked')
      expect(view.findAll('input[type="radio"]')).toHaveLength(3)
      expect(view.findAll('.on').map((segment) => segment.text())).toEqual(['l'])
    })
  })
})
