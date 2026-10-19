import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppI18n } from '@/i18n'
import UndoStrip from './UndoStrip.vue'

function render(extra: Record<string, unknown> = {}) {
  return mount(UndoStrip, {
    attachTo: document.body,
    props: {
      text: 'Удалено: барбер · 5 000 ֏',
      announcement: 'Удалено',
      action: 'Вернуть',
      ...extra,
    },
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
    const parts = [...strip.element.querySelectorAll('.text, .count, button')].map(
      (part) => part.className.split(' ')[0],
    )
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

  // MOL-189, Ф-6, owner's В-2 «а»: an exchange's «Вернуть» needs the server; offline it says why, and
  // the ten seconds wait for it — run out, they took away a removal the server still keeps.
  it('without a connection: not now, says why, and the count stands still', async () => {
    const strip = render({ waiting: true, waitingAction: 'Вернём, когда будет связь' })
    await vi.advanceTimersByTimeAsync(3_000)
    const button = strip.get('button')
    expect(button.text()).toContain('Вернём, когда будет связь')
    expect(button.attributes('aria-disabled')).toBe('true')
    expect(strip.find('.count').text()).toBe('10')
    await button.trigger('click')
    expect(strip.emitted('restore')).toBeUndefined()
    await strip.setProps({ waiting: false })
    expect(strip.get('button').text()).toContain('Вернуть')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(strip.emitted('expire')).toHaveLength(1)
  })

  // MOL-225: a «Вернуть» that waits for the server says it is at work, and the count waits with it.
  it('at work: says so, takes no second tap, and the count stands still', async () => {
    const strip = render({ busy: true, busyLabel: 'Возвращаем…' })
    await vi.advanceTimersByTimeAsync(3_000)
    expect(strip.get('button').text()).toContain('Возвращаем…')
    expect(strip.find('.count').text()).toBe('10')
    await strip.get('button').trigger('click')
    expect(strip.emitted('restore')).toBeUndefined()
  })

  // MOL-189 review №2, adversarial А1: the server did not get it, the strip stays — and its ten
  // seconds go on from where the tap stopped them, never frozen for good.
  it('a «Вернуть» that waited and came back with nothing lets the count go on', async () => {
    const strip = render({ busyLabel: 'Возвращаем…' })
    await vi.advanceTimersByTimeAsync(3_000)
    await strip.get('button').trigger('click')
    expect(strip.emitted('restore')).toHaveLength(1)
    await strip.setProps({ busy: true })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(strip.find('.count').text()).toBe('7')
    await strip.setProps({ busy: false })
    ;(document.activeElement as HTMLElement | null)?.blur()
    await vi.advanceTimersByTimeAsync(6_000)
    expect(strip.find('.count').text()).toBe('1')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(strip.emitted('expire')).toHaveLength(1)
  })

  // Adversarial А2: another write of the screen in the air — its answer makes the removal final.
  it('another write in the air: not now in its own words, no tap, and the count stands still', async () => {
    const strip = render({ inactive: true })
    await vi.advanceTimersByTimeAsync(3_000)
    const button = strip.get('button')
    expect(button.text()).toBe('Вернуть')
    expect(button.attributes('aria-disabled')).toBe('true')
    expect(strip.find('.count').text()).toBe('10')
    await button.trigger('click')
    expect(strip.emitted('restore')).toBeUndefined()
    await strip.setProps({ inactive: false })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(strip.emitted('expire')).toHaveLength(1)
  })
})
