import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppI18n } from '@/i18n'
import UndoStrip from './UndoStrip.vue'

function render() {
  return mount(UndoStrip, {
    attachTo: document.body,
    props: { text: 'Удалено: барбер · 5 000 ֏', announcement: 'Удалено', action: 'Вернуть' },
    global: { plugins: [createAppI18n('ru')] },
  })
}

describe('UndoStrip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('counts ten seconds down and then lets the removal stand', async () => {
    const strip = render()
    await vi.advanceTimersByTimeAsync(9_000)
    expect(strip.find('.count').text()).toBe('1')
    expect(strip.emitted('expire')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(strip.emitted('expire')).toHaveLength(1)
  })

  it('puts the focus on «Вернуть» — and that alone does not stop the count', async () => {
    const strip = render()
    await vi.advanceTimersByTimeAsync(0)
    expect(document.activeElement?.textContent).toContain('Вернуть')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(strip.emitted('expire')).toHaveLength(1)
  })

  it('stands still while a finger rests on it, and goes on after', async () => {
    const strip = render()
    await vi.advanceTimersByTimeAsync(3_000)
    await strip.trigger('pointerenter')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(strip.emitted('expire')).toBeUndefined()
    expect(strip.find('.count').text()).toBe('7')
    await strip.trigger('pointerleave')
    await vi.advanceTimersByTimeAsync(7_000)
    expect(strip.emitted('expire')).toHaveLength(1)
  })

  it('says what is left every second, held too — the next screen goes on from it (MOL-159, З)', async () => {
    const strip = render()
    await vi.advanceTimersByTimeAsync(3_000)
    await strip.trigger('pointerenter')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(strip.emitted('tick')?.map(([left]) => left)).toEqual([9, 8, 7, 7, 7, 7, 7, 7])
  })

  it('stands still while the person has the focus in it', async () => {
    const strip = render()
    await vi.advanceTimersByTimeAsync(0)
    await strip.trigger('focusin')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(strip.emitted('expire')).toBeUndefined()
  })

  // 157 v2 2d, 72 v2 03: the words first, the count beside the button the finger goes to.
  it('reads «words · count · Вернуть», the count kept from screen readers', () => {
    const strip = render()
    const parts = [...strip.element.children].map((part) => part.className.split(' ')[0])
    expect(parts).toEqual(['text', 'count', 'button'])
    expect(strip.get('.count').attributes('aria-hidden')).toBe('true')
  })

  // Ф-12, MOL-174: «Вернуть» is the tinted button — the handoffs' «secondary» is the kit's outlined one.
  it('draws «Вернуть» as the tinted button', () => {
    expect(render().find('button').classes()).toContain('tinted')
  })

  it('«Вернуть» takes the removal back and stops the count', async () => {
    const strip = render()
    await strip.find('button').trigger('click')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(strip.emitted('restore')).toHaveLength(1)
    expect(strip.emitted('expire')).toBeUndefined()
  })
})
