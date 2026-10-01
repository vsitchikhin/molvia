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
    expect(range.attributes('max')).toBe('11')
    expect(range.attributes('aria-valuetext')).toBe('12 сентября')
    await range.setValue('3')
    expect(view.emitted('update:modelValue')?.at(-1)).toEqual([3])
  })
})
