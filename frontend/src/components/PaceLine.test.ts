import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PaceLine from './PaceLine.vue'

/** Twelve days drawn of a month of thirty, on a card 290 px wide: ten pixels a day. */
function line(usual: number[] | null = Array.from({ length: 30 }, (_, index) => index * 30)) {
  const view = mount(PaceLine, {
    props: {
      days: Array.from({ length: 12 }, (_, index) => ({
        level: index * 80,
        spoken: `${String(index + 1)} сентября`,
      })),
      usual,
      length: 30,
      modelValue: 11,
      legend: 'Темп месяца',
    },
    slots: { default: '<p class="shown">показание</p>' },
  })
  const area = view.find('.area').element
  area.getBoundingClientRect = () => ({ left: 0, width: 290 }) as DOMRect
  return { view, area }
}

const touch = (type: string, x: number, y = 50) =>
  new PointerEvent(type, { clientX: x, clientY: y, pointerType: 'touch', bubbles: true })

describe('PaceLine (MOL-158)', () => {
  it('draws the month solid and the usual dashed, the reading above', () => {
    const { view } = line()
    expect(view.find('polyline.line').exists()).toBe(true)
    expect(view.find('polyline.usual').exists()).toBe(true)
    expect(view.find('.reading .shown').exists()).toBe(true)
    expect(view.findAll('.tick').map((tick) => tick.text())).toEqual(['1', '10', '20', '30'])
  })

  it('has no dashed line and no ring on it without a usual month', () => {
    const { view } = line(null)
    expect(view.find('polyline.usual').exists()).toBe(false)
    expect(view.find('.ring').exists()).toBe(false)
    expect(view.find('.dot').exists()).toBe(true)
  })

  it('a finger lifted chooses the nearest day, never past the last one drawn', () => {
    const { view, area } = line()
    area.dispatchEvent(touch('pointerdown', 50))
    area.dispatchEvent(touch('pointerup', 50))
    expect(view.emitted('update:modelValue')?.at(-1)).toEqual([5])
    // Day 28 of a month drawn to the 12th: the 12th, the one already chosen — nothing new.
    area.dispatchEvent(touch('pointerdown', 280))
    area.dispatchEvent(touch('pointerup', 280))
    expect(view.emitted('update:modelValue')).toHaveLength(1)
  })

  it('must not fire: a scroll that started on the line chooses nothing', () => {
    const { view, area } = line()
    area.dispatchEvent(touch('pointerdown', 40, 50))
    area.dispatchEvent(touch('pointermove', 42, 120))
    area.dispatchEvent(new PointerEvent('pointercancel', { pointerType: 'touch' }))
    area.dispatchEvent(touch('pointerup', 42, 120))
    expect(view.emitted('update:modelValue')).toBeUndefined()
  })

  it('the arrows move the day, and the range says the day', async () => {
    const { view } = line()
    const range = view.find('input[type="range"]')
    expect(range.attributes('aria-valuetext')).toBe('12 сентября')
    await range.setValue('3')
    expect(view.emitted('update:modelValue')?.at(-1)).toEqual([3])
  })

  // Owner's «в» on review Р2-1: the thumb alone was a target of some 16 px; the strip of 44 under the
  // axis chooses as the chart does — on lifting or sideways, never by a scroll — and leaves the thumb's
  // own drag to the range.
  describe('the strip of the slider', () => {
    function strip() {
      const { view } = line()
      const track = view.find('.track').element
      track.getBoundingClientRect = () => ({ left: 0, top: 0, width: 290, height: 44 }) as DOMRect
      return { view, track, range: view.find('input[type="range"]').element }
    }

    it('a finger lifted where it touched chooses the day under it, as on the axis', () => {
      const { view, track } = strip()
      track.dispatchEvent(touch('pointerdown', 50, 20))
      track.dispatchEvent(touch('pointerup', 50, 20))
      expect(view.emitted('update:modelValue')?.at(-1)).toEqual([5])
    })

    it('must not fire: a scroll that started on the strip chooses nothing', () => {
      const { view, track } = strip()
      track.dispatchEvent(touch('pointerdown', 50, 20))
      track.dispatchEvent(touch('pointermove', 52, 90))
      track.dispatchEvent(new PointerEvent('pointercancel', { pointerType: 'touch' }))
      track.dispatchEvent(touch('pointerup', 52, 90))
      expect(view.emitted('update:modelValue')).toBeUndefined()
    })

    it('must not fire: a press on the thumb is the range’s own drag, not the strip’s', () => {
      const { view, range } = strip()
      range.dispatchEvent(touch('pointerdown', 50, 20))
      range.dispatchEvent(touch('pointerup', 50, 20))
      expect(view.emitted('update:modelValue')).toBeUndefined()
    })
  })

  it('one day drawn — the 1st of a running month — has no slider: nothing to move to (А6)', () => {
    const view = mount(PaceLine, {
      props: {
        days: [{ level: 1000, spoken: '1 октября' }],
        usual: null,
        length: 31,
        modelValue: 0,
        legend: 'Темп месяца',
      },
    })
    expect(view.find('input[type="range"]').exists()).toBe(false)
    expect(view.find('.dot').exists()).toBe(true)
  })

  it('the slider spans the month, as the axis does; past the last day drawn it goes back to it', async () => {
    const { view } = line()
    const range = view.find<HTMLInputElement>('input[type="range"]')
    // Thirty days, as the axis: the thumb of the 12th stands under the 12th, not at the right end.
    expect(range.attributes('max')).toBe('29')
    await range.setValue('3')
    await view.setProps({ modelValue: 3 })
    // The 20th of a month drawn to the 12th: the 12th, and the thumb is put back on it.
    await range.setValue('19')
    expect(view.emitted('update:modelValue')?.at(-1)).toEqual([11])
    expect(range.element.value).toBe('11')
  })
})
